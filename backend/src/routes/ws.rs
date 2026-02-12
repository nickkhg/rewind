use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use nanoid::nanoid;
use tracing::{info, warn};

use crate::models::{Participant, Ticket};
use crate::protocol::{ClientMessage, ServerMessage};
use crate::state::AppState;
use chrono::Utc;
use std::collections::HashSet;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(board_id): Path<String>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, board_id, state))
}

async fn handle_socket(socket: WebSocket, board_id: String, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Wait for Join message first
    let (participant_id, is_facilitator) = loop {
        match receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Join {
                        participant_name,
                        facilitator_token,
                    }) => {
                        let participant_id = nanoid!(8);
                        let mut boards = state.boards.write().await;
                        let Some(board) = boards.get_mut(&board_id) else {
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
                        };

                        let is_facilitator = facilitator_token
                            .as_ref()
                            .map(|t| t == &board.facilitator_token)
                            .unwrap_or(false);

                        board.participants.push(Participant {
                            id: participant_id.clone(),
                            name: participant_name,
                        });

                        let board_view = board.to_view();
                        drop(boards);

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
                        let tx = state.get_or_create_channel(&board_id).await;
                        let state_msg = ServerMessage::BoardState { board: board_view };
                        let _ = tx.send(state_msg);

                        break (participant_id, is_facilitator);
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
        let boards = state.boards.read().await;
        if let Some(board) = boards.get(&board_id) {
            let msg = ServerMessage::BoardState {
                board: board.to_view(),
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
    let tx_clone = tx.clone();

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

            let broadcast_state = handle_message(
                &state_clone,
                &board_id_clone,
                &participant_id_clone,
                is_facilitator,
                client_msg,
            )
            .await;

            if broadcast_state {
                let boards = state_clone.boards.read().await;
                if let Some(board) = boards.get(&board_id_clone) {
                    let msg = ServerMessage::BoardState {
                        board: board.to_view(),
                    };
                    let _ = tx_clone.send(msg);
                }
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
        let mut boards = state.boards.write().await;
        if let Some(board) = boards.get_mut(&board_id) {
            board.participants.retain(|p| p.id != participant_id);
            let view = board.to_view();
            drop(boards);
            let msg = ServerMessage::BoardState { board: view };
            let _ = tx.send(msg);
        }
    }

    info!(participant_id, board_id, "participant left");
}

async fn handle_message(
    state: &AppState,
    board_id: &str,
    participant_id: &str,
    is_facilitator: bool,
    msg: ClientMessage,
) -> bool {
    let mut boards = state.boards.write().await;
    let Some(board) = boards.get_mut(board_id) else {
        return false;
    };

    match msg {
        ClientMessage::Join { .. } => false,

        ClientMessage::AddTicket { column_id, content } => {
            let author_name = board
                .participants
                .iter()
                .find(|p| p.id == participant_id)
                .map(|p| p.name.clone())
                .unwrap_or_default();

            if let Some(col) = board.columns.iter_mut().find(|c| c.id == column_id) {
                col.tickets.push(Ticket {
                    id: nanoid!(8),
                    content,
                    author_id: participant_id.to_string(),
                    author_name,
                    votes: HashSet::new(),
                    created_at: Utc::now(),
                });
                true
            } else {
                false
            }
        }

        ClientMessage::RemoveTicket { ticket_id } => {
            for col in &mut board.columns {
                let before = col.tickets.len();
                col.tickets.retain(|t| {
                    if t.id == ticket_id {
                        // Author or facilitator can remove
                        t.author_id != participant_id && !is_facilitator
                    } else {
                        true
                    }
                });
                if col.tickets.len() != before {
                    return true;
                }
            }
            false
        }

        ClientMessage::EditTicket { ticket_id, content } => {
            for col in &mut board.columns {
                if let Some(ticket) = col.tickets.iter_mut().find(|t| t.id == ticket_id) {
                    if ticket.author_id == participant_id {
                        ticket.content = content;
                        return true;
                    }
                    return false;
                }
            }
            false
        }

        ClientMessage::ToggleVote { ticket_id } => {
            for col in &mut board.columns {
                if let Some(ticket) = col.tickets.iter_mut().find(|t| t.id == ticket_id) {
                    if ticket.votes.contains(participant_id) {
                        ticket.votes.remove(participant_id);
                    } else {
                        ticket.votes.insert(participant_id.to_string());
                    }
                    return true;
                }
            }
            false
        }

        ClientMessage::ToggleBlur => {
            if is_facilitator {
                board.is_blurred = !board.is_blurred;
                true
            } else {
                false
            }
        }
    }
}
