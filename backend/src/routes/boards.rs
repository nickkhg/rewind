use axum::extract::{Path, State};
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use time::Duration;

use crate::db;
use crate::error::AppError;
use crate::models::{CreateBoardRequest, CreateBoardResponse, MyBoardSummary, Template};
use crate::state::AppState;
use chrono::Utc;
use nanoid::nanoid;
use uuid::Uuid;

pub async fn create_board(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<CreateBoardRequest>,
) -> Result<(CookieJar, Json<CreateBoardResponse>), AppError> {
    if req.title.trim().is_empty() {
        return Err(AppError::BadRequest("Title is required".to_string()));
    }
    if req.columns.is_empty() {
        return Err(AppError::BadRequest(
            "At least one column is required".to_string(),
        ));
    }

    let facilitator_id = jar
        .get("facilitator_id")
        .map(|c| c.value().to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

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
        &facilitator_id,
        &columns,
        created_at,
        req.is_anonymous,
    )
    .await?;

    let view = board.to_view_with_participants(0);

    let cookie = Cookie::build(("facilitator_id", facilitator_id))
        .path("/")
        .http_only(true)
        .same_site(SameSite::None)
        .secure(true)
        .max_age(Duration::days(365));
    let jar = jar.add(cookie);

    Ok((
        jar,
        Json(CreateBoardResponse {
            board: view,
            facilitator_token,
        }),
    ))
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

pub async fn list_templates(
    State(state): State<AppState>,
) -> Result<Json<Vec<Template>>, AppError> {
    let templates = db::list_templates(&state.db).await?;
    Ok(Json(templates))
}

pub async fn my_boards(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<MyBoardSummary>>, AppError> {
    let facilitator_id = match jar.get("facilitator_id") {
        Some(c) => c.value().to_string(),
        None => return Ok(Json(Vec::new())),
    };

    let boards = db::get_boards_by_facilitator_id(&state.db, &facilitator_id).await?;
    Ok(Json(boards))
}
