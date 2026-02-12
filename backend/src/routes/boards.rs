use axum::extract::{Path, State};
use axum::Json;

use crate::error::AppError;
use crate::models::{Board, Column, CreateBoardRequest, CreateBoardResponse};
use crate::state::AppState;
use chrono::Utc;
use nanoid::nanoid;

pub async fn create_board(
    State(state): State<AppState>,
    Json(req): Json<CreateBoardRequest>,
) -> Result<Json<CreateBoardResponse>, AppError> {
    if req.title.trim().is_empty() {
        return Err(AppError::BadRequest("Title is required".to_string()));
    }
    if req.columns.is_empty() {
        return Err(AppError::BadRequest(
            "At least one column is required".to_string(),
        ));
    }

    let board_id = nanoid!(10);
    let facilitator_token = nanoid!(32);

    let columns = req
        .columns
        .into_iter()
        .map(|name| Column {
            id: nanoid!(8),
            name,
            tickets: Vec::new(),
        })
        .collect();

    let board = Board {
        id: board_id.clone(),
        title: req.title,
        columns,
        is_blurred: true,
        created_at: Utc::now(),
        facilitator_token: facilitator_token.clone(),
        participants: Vec::new(),
    };

    let view = board.to_view();
    state.boards.write().await.insert(board_id, board);

    Ok(Json(CreateBoardResponse {
        board: view,
        facilitator_token,
    }))
}

pub async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<crate::models::BoardView>, AppError> {
    let boards = state.boards.read().await;
    let board = boards
        .get(&board_id)
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;
    Ok(Json(board.to_view()))
}
