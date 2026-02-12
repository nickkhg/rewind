use axum::extract::{Path, State};
use axum::Json;

use crate::db;
use crate::error::AppError;
use crate::models::{CreateBoardRequest, CreateBoardResponse};
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
    let created_at = Utc::now();

    let columns: Vec<(String, String)> = req
        .columns
        .into_iter()
        .map(|name| (nanoid!(8), name))
        .collect();

    let board = db::create_board(
        &state.db,
        &board_id,
        &req.title,
        &facilitator_token,
        &columns,
        created_at,
    )
    .await?;

    let view = board.to_view_with_participants(0);

    Ok(Json(CreateBoardResponse {
        board: view,
        facilitator_token,
    }))
}

pub async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<crate::models::BoardView>, AppError> {
    let board = db::get_board(&state.db, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;

    let count = state.participant_count(&board_id).await;
    Ok(Json(board.to_view_with_participants(count)))
}
