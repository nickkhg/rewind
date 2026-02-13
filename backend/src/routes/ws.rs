use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use nanoid::nanoid;
use tracing::{info, warn};

use crate::db;
use crate::models::Participant;
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

async fn broadcast_board_state(state: &AppState, board_id: &str) {
    let board = match db::get_board(&state.db, board_id).await {
        Ok(Some(b)) => b,
        _ => return,
    };
    let count = state.participant_count(board_id).await;
    let view = board.to_view_with_participants(count);
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
            let msg = ServerMessage::BoardState {
                board: board.to_view_with_participants(count),
            };
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
        }
    }

    // Spawn a task to forward broadcast messages to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
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

async fn handle_message(
    state: &AppState,
    board_id: &str,
    participant_id: &str,
    participant_name: &str,
    is_facilitator: bool,
    msg: ClientMessage,
) -> bool {
    match msg {
        ClientMessage::Join { .. } => false,

        ClientMessage::AddTicket { column_id, content } => {
            // Verify column belongs to this board
            match db::column_belongs_to_board(&state.db, &column_id, board_id).await {
                Ok(true) => {}
                _ => return false,
            }

            let ticket_id = nanoid!(8);
            match db::add_ticket(
                &state.db,
                &ticket_id,
                &column_id,
                &content,
                participant_id,
                participant_name,
                Utc::now(),
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
            // Check authorization: author or facilitator
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_facilitator => {}
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

        ClientMessage::EditTicket { ticket_id, content } => {
            // Only author can edit
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id => {}
                _ => return false,
            }

            match db::edit_ticket(&state.db, &ticket_id, &content).await {
                Ok(()) => true,
                Err(e) => {
                    warn!("Failed to edit ticket: {e}");
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
            if !is_facilitator {
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
            if !is_facilitator {
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
            // Auth: author or facilitator
            match db::get_ticket_author(&state.db, &ticket_id).await {
                Ok(Some(author_id)) if author_id == participant_id || is_facilitator => {}
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
            if !is_facilitator {
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
            if !is_facilitator {
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
            if !is_facilitator {
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
    }
}
