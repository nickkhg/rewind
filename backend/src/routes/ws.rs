use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use nanoid::nanoid;
use tracing::{info, warn};

use crate::db;
use crate::models::{
    sanitize_gif, valid_rock_status, Participant, MAX_COMMENT_LENGTH,
    MAX_SCORECARD_FIELD_LENGTH, TEMPLATE_LEVEL10,
};
use crate::protocol::{ClientMessage, ServerMessage};
use crate::state::AppState;
use chrono::Utc;

pub async fn ws_handler(
    jar: CookieJar,
    ws: WebSocketUpgrade,
    Path(board_id): Path<String>,
    State(state): State<AppState>,
) -> Response {
    let facilitator_id_from_cookie = jar
        .get("facilitator_id")
        .map(|c| c.value().to_string());
    ws.on_upgrade(move |socket| {
        handle_socket(socket, board_id, state, facilitator_id_from_cookie)
    })
}

/// Sends the full board state to every client of the board. The REST handlers that change a board
/// call this too, so that all views stay in step.
pub async fn broadcast_board_state(state: &AppState, board_id: &str) {
    let board = match db::get_board(&state.db, board_id).await {
        Ok(Some(b)) => b,
        _ => return,
    };
    let count = state.participant_count(board_id).await;
    let editors = db::get_board_editors(&state.db, board_id).await.unwrap_or_default();
    let editor_requests = db::get_editor_requests(&state.db, board_id).await.unwrap_or_default();
    let view = board.to_view_with_participants(count, editors, editor_requests);
    let tx = state.get_or_create_channel(board_id).await;
    let _ = tx.send(ServerMessage::BoardState { board: view });
}

async fn handle_socket(
    socket: WebSocket,
    board_id: String,
    state: AppState,
    facilitator_id_from_cookie: Option<String>,
) {
    let (mut sender, mut receiver) = socket.split();

    // Wait for Join message first
    let (participant_id, participant_name, is_facilitator) = loop {
        match receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Join {
                        participant_name,
                        facilitator_token,
                        participant_id,
                        access_token,
                    }) => {
                        let participant_id = participant_id
                            .filter(|id| !id.is_empty())
                            .unwrap_or_else(|| nanoid!(8));

                        // Verify board exists and check facilitator auth
                        let token = match db::get_board_facilitator_token(&state.db, &board_id)
                            .await
                        {
                            Ok(Some(t)) => t,
                            Ok(None) => {
                                let _ = sender
                                    .send(Message::Text(
                                        serde_json::to_string(&ServerMessage::Error {
                                            message: "Board not found".to_string(),
                                        })
                                        .unwrap()
                                        .into(),
                                    ))
                                    .await;
                                return;
                            }
                            Err(e) => {
                                warn!("DB error during join: {e}");
                                let _ = sender
                                    .send(Message::Text(
                                        serde_json::to_string(&ServerMessage::Error {
                                            message: "Internal error".to_string(),
                                        })
                                        .unwrap()
                                        .into(),
                                    ))
                                    .await;
                                return;
                            }
                        };

                        // Dual auth: cookie-based OR token-based
                        let token_match = facilitator_token
                            .as_ref()
                            .map(|t| t == &token)
                            .unwrap_or(false);

                        let cookie_match = if let Some(ref fid) = facilitator_id_from_cookie {
                            db::get_board_facilitator_id(&state.db, &board_id)
                                .await
                                .ok()
                                .flatten()
                                .map(|board_fid| &board_fid == fid)
                                .unwrap_or(false)
                        } else {
                            false
                        };

                        let is_facilitator = token_match || cookie_match;

                        // The gate of a locked board. A reader gets in with the key that the
                        // password gave them; the facilitator needs no key. The check sits before
                        // the participant is counted, so a reader who is turned away leaves
                        // nothing of themselves on the board.
                        if !is_facilitator {
                            let locked = match db::get_board_access(&state.db, &board_id).await {
                                Ok(Some(access)) => {
                                    access.password_hash.is_some()
                                        && access_token.as_deref()
                                            != Some(access.access_token.as_str())
                                }
                                Ok(None) => false,
                                // A board whose gate cannot be read stays shut.
                                Err(e) => {
                                    warn!("DB error reading the board gate: {e}");
                                    true
                                }
                            };
                            if locked {
                                let _ = sender
                                    .send(Message::Text(
                                        serde_json::to_string(&ServerMessage::PasswordRequired)
                                            .unwrap()
                                            .into(),
                                    ))
                                    .await;
                                return;
                            }
                        }

                        // For anonymous boards, discard the participant name
                        let board_anonymous = db::get_board_anonymous(&state.db, &board_id)
                            .await
                            .unwrap_or(Some(false))
                            .unwrap_or(false);
                        let effective_name = if board_anonymous {
                            String::new()
                        } else {
                            participant_name
                        };

                        // Add participant to in-memory map
                        {
                            let mut participants = state.participants.write().await;
                            participants
                                .entry(board_id.clone())
                                .or_default()
                                .push(Participant {
                                    id: participant_id.clone(),
                                    name: effective_name.clone(),
                                });
                        }

                        // Send Authenticated
                        let auth_msg = ServerMessage::Authenticated {
                            is_facilitator,
                            participant_id: participant_id.clone(),
                        };
                        let _ = sender
                            .send(Message::Text(
                                serde_json::to_string(&auth_msg).unwrap().into(),
                            ))
                            .await;

                        // Broadcast updated state (new participant count)
                        broadcast_board_state(&state, &board_id).await;

                        break (participant_id, effective_name, is_facilitator);
                    }
                    Ok(_) => {
                        let _ = sender
                            .send(Message::Text(
                                serde_json::to_string(&ServerMessage::Error {
                                    message: "Must send Join first".to_string(),
                                })
                                .unwrap()
                                .into(),
                            ))
                            .await;
                    }
                    Err(e) => {
                        let _ = sender
                            .send(Message::Text(
                                serde_json::to_string(&ServerMessage::Error {
                                    message: format!("Invalid message: {e}"),
                                })
                                .unwrap()
                                .into(),
                            ))
                            .await;
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return,
            _ => continue,
        }
    };

    info!(participant_id, board_id, "participant joined");

    // Subscribe to broadcast channel
    let tx = state.get_or_create_channel(&board_id).await;
    let mut rx = tx.subscribe();

    // Send current board state
    {
        if let Ok(Some(board)) = db::get_board(&state.db, &board_id).await {
            let count = state.participant_count(&board_id).await;
            let editors = db::get_board_editors(&state.db, &board_id).await.unwrap_or_default();
            let editor_requests = db::get_editor_requests(&state.db, &board_id).await.unwrap_or_default();
            let mut view = board.to_view_with_participants(count, editors, editor_requests);
            view.redact_hidden_for(&participant_id, is_facilitator);
            let msg = ServerMessage::BoardState { board: view };
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
        }
    }

    // Spawn a task to forward broadcast messages to this client.
    // The channel carries the whole board, so each client takes out what its own reader may not
    // read yet before the state goes down the wire.
    let redact_for = participant_id.clone();
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            let msg = match msg {
                ServerMessage::BoardState { mut board } => {
                    board.redact_hidden_for(&redact_for, is_facilitator);
                    ServerMessage::BoardState { board }
                }
                other => other,
            };
            let text = serde_json::to_string(&msg).unwrap();
            if sender.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    let state_clone = state.clone();
    let board_id_clone = board_id.clone();
    let participant_id_clone = participant_id.clone();
    let participant_name_clone = participant_name.clone();

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let Message::Text(text) = msg else {
                continue;
            };

            let client_msg = match serde_json::from_str::<ClientMessage>(&text) {
                Ok(m) => m,
                Err(e) => {
                    warn!("Invalid message from {}: {e}", participant_id_clone);
                    continue;
                }
            };

            let should_broadcast = handle_message(
                &state_clone,
                &board_id_clone,
                &participant_id_clone,
                &participant_name_clone,
                is_facilitator,
                client_msg,
            )
            .await;

            if should_broadcast {
                broadcast_board_state(&state_clone, &board_id_clone).await;
            }
        }
    });

    // Wait for either task to finish (client disconnect)
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Remove participant on disconnect
    {
        let mut participants = state.participants.write().await;
        if let Some(list) = participants.get_mut(&board_id) {
            list.retain(|p| p.id != participant_id);
            if list.is_empty() {
                participants.remove(&board_id);
            }
        }
    }

    broadcast_board_state(&state, &board_id).await;

    info!(participant_id, board_id, "participant left");
}

/// Removes the space at the two ends of a comment. Gives None if the comment is longer than
/// the limit, or if it is empty and carries no GIF: a GIF on its own is a whole remark.
fn clean_comment(content: &str, has_gif: bool) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.chars().count() > MAX_COMMENT_LENGTH {
        return None;
    }
    if trimmed.is_empty() && !has_gif {
        return None;
    }
    Some(trimmed.to_string())
}

/// Removes the space at the two ends of one scorecard field. Gives None if it is too long.
fn clean_scorecard_field(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.chars().count() > MAX_SCORECARD_FIELD_LENGTH {
        return None;
    }
    Some(trimmed.to_string())
}

/// Tells whether this board runs a Level 10 meeting. The scorecard and the rating belong to
/// such a board alone.
async fn is_level10_board(state: &AppState, board_id: &str) -> bool {
    db::get_board_template_id(&state.db, board_id)
        .await
        .ok()
        .flatten()
        .as_deref()
        == Some(TEMPLATE_LEVEL10)
}

async fn handle_message(
    state: &AppState,
    board_id: &str,
    participant_id: &str,
    participant_name: &str,
    is_facilitator: bool,
    msg: ClientMessage,
) -> bool {
    // Check editor status for privileged actions
    let is_editor = db::is_editor(&state.db, board_id, participant_id)
        .await
        .unwrap_or(false);
    let is_privileged = is_facilitator || is_editor;

    match msg {
        ClientMessage::Join { .. } => false,

        ClientMessage::AddTicket {
            column_id,
            content,
            gif,
        } => {
            // Verify column belongs to this board
            match db::column_belongs_to_board(&state.db, &column_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }

            // The client chooses the picture, so the server checks it before it keeps it.
            let gif = gif.and_then(sanitize_gif);

            // A card is either words or a picture. Empty on both counts is nothing at all.
            if content.trim().is_empty() && gif.is_none() {
                return false;
            }

            let ticket_id = nanoid!(8);
            match db::add_ticket(
                &state.db,
                &ticket_id,
                &column_id,
                content.trim(),
                participant_id,
                participant_name,
                Utc::now(),
                gif.as_ref(),
            )
            .await
            {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to add ticket: {e}");
                    false
                }
            }
        }

        ClientMessage::RemoveTicket { ticket_id } => {
            // Check authorization: author, facilitator, or editor
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            match db::remove_ticket(&state.db, &ticket_id).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to remove ticket: {e}");
                    false
                }
            }
        }

        ClientMessage::EditTicket {
            ticket_id,
            content,
            gif,
        } => {
            // Only author can edit
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id => {}
                _ => return false,
            }

            let gif = gif.and_then(sanitize_gif);
            if content.trim().is_empty() && gif.is_none() {
                return false;
            }

            match db::edit_ticket(&state.db, &ticket_id, content.trim(), gif.as_ref()).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to edit ticket: {e}");
                    false
                }
            }
        }

        ClientMessage::MoveTicket {
            ticket_id,
            column_id,
        } => {
            // The card and the target column must both belong to this board
            match db::column_belongs_to_board(&state.db, &column_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }
            match db::get_ticket_column_id(&state.db, &ticket_id).await {
                Ok(Some(current)) => {
                    match db::column_belongs_to_board(&state.db, &current, board_id).await {
                        Ok(true) => {}
                        _ => return false,
                    }
                }
                _ => return false,
            }

            // Authorization: author, facilitator, or editor
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            match db::move_ticket(&state.db, &ticket_id, &column_id).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to move ticket: {e}");
                    false
                }
            }
        }

        ClientMessage::AddComment {
            ticket_id,
            content,
            gif,
        } => {
            // Anyone on the board can comment, but only on a card of this board
            match db::ticket_belongs_to_board(&state.db, &ticket_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }

            let gif = gif.and_then(sanitize_gif);
            let Some(content) = clean_comment(&content, gif.is_some()) else {
                return false;
            };

            let comment_id = nanoid!(8);
            match db::add_comment(
                &state.db,
                &comment_id,
                &ticket_id,
                &content,
                participant_id,
                participant_name,
                Utc::now(),
                gif.as_ref(),
            )
            .await
            {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to add comment: {e}");
                    false
                }
            }
        }

        ClientMessage::EditComment {
            comment_id,
            content,
            gif,
        } => {
            // Only the author can edit, and only on this board
            match db::get_comment_author_on_board(&state.db, &comment_id, board_id).await {
                Ok(Some(author_id)) if author_id == participant_id => {}
                _ => return false,
            }

            let gif = gif.and_then(sanitize_gif);
            let Some(content) = clean_comment(&content, gif.is_some()) else {
                return false;
            };

            match db::edit_comment(&state.db, &comment_id, &content, gif.as_ref()).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to edit comment: {e}");
                    false
                }
            }
        }

        ClientMessage::RemoveComment { comment_id } => {
            // Author, facilitator, or editor
            match db::get_comment_author_on_board(&state.db, &comment_id, board_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            match db::remove_comment(&state.db, &comment_id).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to remove comment: {e}");
                    false
                }
            }
        }

        ClientMessage::ToggleVote { ticket_id } => {
            // Check vote limit before adding a vote
            let already_voted = match db::has_vote(&state.db, &ticket_id, participant_id).await {
                Ok(v) => v,
                Err(e) => {
                    warn!("Failed to check vote: {e}");
                    return false;
                }
            };

            if !already_voted {
                // This would be an add — check the limit
                if let Ok(Some(limit)) = db::get_vote_limit(&state.db, board_id).await {
                    let column_id = match db::get_ticket_column_id(&state.db, &ticket_id).await {
                        Ok(Some(cid)) => cid,
                        _ => return false,
                    };
                    let count = match db::count_votes_in_column(&state.db, &column_id, participant_id).await {
                        Ok(c) => c,
                        Err(e) => {
                            warn!("Failed to count votes: {e}");
                            return false;
                        }
                    };
                    if count >= limit as i64 {
                        return false; // At limit, reject
                    }
                }
            }

            match db::toggle_vote(&state.db, &ticket_id, participant_id).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to toggle vote: {e}");
                    false
                }
            }
        }

        ClientMessage::ToggleBlur => {
            if !is_privileged {
                return false;
            }
            let current = match db::get_blur_state(&state.db, board_id).await {
                Ok(Some(v)) => v,
                _ => return false,
            };
            match db::set_blur(&state.db, board_id, !current).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to toggle blur: {e}");
                    false
                }
            }
        }

        ClientMessage::ToggleHideVotes => {
            if !is_privileged {
                return false;
            }
            let current = match db::get_hide_votes(&state.db, board_id).await {
                Ok(Some(v)) => v,
                _ => return false,
            };
            match db::set_hide_votes(&state.db, board_id, !current).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to toggle hide votes: {e}");
                    false
                }
            }
        }

        ClientMessage::MergeTickets {
            source_ticket_id,
            target_ticket_id,
        } => {
            // Block merges while the board is blurred to prevent leaking card contents
            match db::get_blur_state(&state.db, board_id).await {
                Ok(Some(true)) => return false,
                _ => {}
            }

            match db::merge_tickets(&state.db, &source_ticket_id, &target_ticket_id).await {
                Ok(Some(snapshot)) => {
                    let mut merges = state.last_merge.write().await;
                    merges.insert(board_id.to_string(), snapshot);
                    true
                }
                Ok(None) => false,
                Err(e) => {
                    warn!("Failed to merge tickets: {e}");
                    false
                }
            }
        }

        ClientMessage::UndoMerge => {
            let snapshot = {
                let mut merges = state.last_merge.write().await;
                merges.remove(board_id)
            };
            match snapshot {
                Some(snap) => match db::undo_merge(&state.db, &snap).await {
                    Ok(()) => true,
                    Err(e) => {
                        warn!("Failed to undo merge: {e}");
                        false
                    }
                },
                None => false,
            }
        }

        ClientMessage::SplitTicket {
            ticket_id,
            segment_index,
        } => {
            // Auth: author, facilitator, or editor
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            let new_ticket_id = nanoid!(8);
            match db::split_ticket(
                &state.db,
                &ticket_id,
                segment_index,
                &new_ticket_id,
                participant_id,
                participant_name,
            )
            .await
            {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to split ticket: {e}");
                    false
                }
            }
        }

        ClientMessage::SetVoteLimit { limit } => {
            if !is_privileged {
                return false;
            }
            // Validate: must be >= 1 or None
            if let Some(l) = limit {
                if l < 1 {
                    return false;
                }
            }
            match db::set_vote_limit(&state.db, board_id, limit).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to set vote limit: {e}");
                    false
                }
            }
        }

        ClientMessage::StartTimer { duration_secs } => {
            if !is_privileged {
                return false;
            }
            if !(1..=3600).contains(&duration_secs) {
                return false;
            }
            let end = Utc::now() + chrono::Duration::seconds(duration_secs as i64);
            match db::set_timer_end(&state.db, board_id, Some(end)).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to start timer: {e}");
                    false
                }
            }
        }

        ClientMessage::StopTimer => {
            if !is_privileged {
                return false;
            }
            match db::set_timer_end(&state.db, board_id, None).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to stop timer: {e}");
                    false
                }
            }
        }

        ClientMessage::SetTicketDone { ticket_id, done } => {
            // Only an action can be finished. A board keeps its two action columns, so this check
            // also keeps one board out of the cards of another.
            match db::ticket_in_action_column(&state.db, &ticket_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }

            // Author, facilitator, or editor, as with a move and with the rock status.
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            let done_at = if done { Some(Utc::now()) } else { None };
            match db::set_ticket_done(&state.db, &ticket_id, done_at).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to set the done mark: {e}");
                    false
                }
            }
        }

        ClientMessage::SetRockStatus { ticket_id, status } => {
            if let Some(ref status) = status {
                if !valid_rock_status(status) {
                    return false;
                }
            }

            // Only a card in the Rocks column of this board carries a mark. A board with no such
            // column — every board that is not a Level 10 board — refuses the message here.
            match db::ticket_in_rocks_column(&state.db, &ticket_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }

            // Author, facilitator, or editor, as with a move
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_privileged => {}
                _ => return false,
            }

            match db::set_rock_status(&state.db, &ticket_id, status.as_deref()).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to set rock status: {e}");
                    false
                }
            }
        }

        ClientMessage::RateMeeting { rating } => {
            // Anyone in the meeting rates it, as anyone votes.
            if !(1..=10).contains(&rating) {
                return false;
            }
            if !is_level10_board(state, board_id).await {
                return false;
            }
            match db::upsert_meeting_rating(&state.db, board_id, participant_id, rating).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to rate meeting: {e}");
                    false
                }
            }
        }

        ClientMessage::AddScorecardMetric { name, goal } => {
            if !is_privileged || !is_level10_board(state, board_id).await {
                return false;
            }
            let (Some(name), Some(goal)) =
                (clean_scorecard_field(&name), clean_scorecard_field(&goal))
            else {
                return false;
            };
            // A line with no name says nothing. The goal may wait.
            if name.is_empty() {
                return false;
            }

            let metric_id = nanoid!(8);
            match db::add_scorecard_metric(&state.db, &metric_id, board_id, &name, &goal).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to add scorecard metric: {e}");
                    false
                }
            }
        }

        ClientMessage::UpdateScorecardMetric {
            metric_id,
            name,
            goal,
            actual,
            on_track,
        } => {
            if !is_privileged || !is_level10_board(state, board_id).await {
                return false;
            }
            let (Some(name), Some(goal), Some(actual)) = (
                clean_scorecard_field(&name),
                clean_scorecard_field(&goal),
                clean_scorecard_field(&actual),
            ) else {
                return false;
            };
            if name.is_empty() {
                return false;
            }

            // The board is part of the WHERE, so a line of another board does not answer.
            match db::update_scorecard_metric(
                &state.db,
                &metric_id,
                board_id,
                &name,
                &goal,
                &actual,
                on_track,
            )
            .await
            {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to update scorecard metric: {e}");
                    false
                }
            }
        }

        ClientMessage::RemoveScorecardMetric { metric_id } => {
            if !is_privileged || !is_level10_board(state, board_id).await {
                return false;
            }
            match db::remove_scorecard_metric(&state.db, &metric_id, board_id).await {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to remove scorecard metric: {e}");
                    false
                }
            }
        }

        ClientMessage::RequestEditor { name } => {
            // Can't request if already facilitator or editor
            if is_facilitator || is_editor {
                return false;
            }
            // For anonymous boards, a name must be provided
            let request_name = if let Some(n) = name {
                if n.trim().is_empty() {
                    return false;
                }
                n.trim().to_string()
            } else if participant_name.is_empty() {
                // Anonymous board with no name provided
                return false;
            } else {
                participant_name.to_string()
            };

            match db::create_editor_request(&state.db, board_id, participant_id, &request_name).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to create editor request: {e}");
                    false
                }
            }
        }

        ClientMessage::ApproveEditor { participant_id: target_id } => {
            // Only facilitator can approve
            if !is_facilitator {
                return false;
            }
            match db::approve_editor(&state.db, board_id, &target_id).await {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to approve editor: {e}");
                    false
                }
            }
        }

        ClientMessage::DeclineEditor { participant_id: target_id } => {
            // Only facilitator can decline
            if !is_facilitator {
                return false;
            }
            match db::decline_editor(&state.db, board_id, &target_id).await {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to decline editor: {e}");
                    false
                }
            }
        }

        ClientMessage::RemoveEditor { participant_id: target_id } => {
            // Only facilitator can remove editors
            if !is_facilitator {
                return false;
            }
            match db::remove_editor(&state.db, board_id, &target_id).await {
                Ok(true) => true,
                Ok(false) => false,
                Err(e) => {
                    warn!("Failed to remove editor: {e}");
                    false
                }
            }
        }
    }
}
