use argon2::password_hash::PasswordHash;
use argon2::{Argon2, PasswordVerifier};
use axum::extract::{Path, State};
use axum::http::request::Parts;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::AppError;
use crate::state::AppState;

// --- Auth extractor ---

pub struct AdminAuth;

impl axum::extract::FromRequestParts<AppState> for AdminAuth {
    type Rejection = AppError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        async move {
            let hash = state
                .admin_token_hash
                .as_ref()
                .ok_or_else(|| AppError::NotFound("Admin interface not enabled".to_string()))?;

            let auth_header = parts
                .headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| {
                    AppError::Unauthorized("Missing Authorization header".to_string())
                })?;

            let token = auth_header
                .strip_prefix("Bearer ")
                .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".to_string()))?;

            let parsed_hash = PasswordHash::new(hash)
                .map_err(|_| AppError::Internal("Invalid stored hash".to_string()))?;

            Argon2::default()
                .verify_password(token.as_bytes(), &parsed_hash)
                .map_err(|_| AppError::Unauthorized("Invalid admin token".to_string()))?;

            Ok(AdminAuth)
        }
    }
}

// --- Response types ---

#[derive(Serialize)]
pub struct GlobalStats {
    pub board_count: i64,
    pub ticket_count: i64,
    pub vote_count: i64,
    pub online_participants: usize,
}

#[derive(Serialize)]
pub struct AdminBoardSummary {
    pub id: String,
    pub title: String,
    pub is_blurred: bool,
    pub created_at: DateTime<Utc>,
    pub column_count: i64,
    pub ticket_count: i64,
    pub vote_count: i64,
    pub online_participants: usize,
}

#[derive(Serialize)]
pub struct AdminBoardDetail {
    pub id: String,
    pub title: String,
    pub is_blurred: bool,
    pub created_at: DateTime<Utc>,
    pub facilitator_token: String,
    pub columns: Vec<AdminColumnDetail>,
    pub online_participants: usize,
}

#[derive(Serialize)]
pub struct AdminColumnDetail {
    pub id: String,
    pub name: String,
    pub ticket_count: usize,
}

// --- Handlers ---

pub async fn verify_token(_auth: AdminAuth) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

pub async fn global_stats(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> Result<Json<GlobalStats>, AppError> {
    let stats = db::admin_global_stats(&state.db).await?;

    let participants = state.participants.read().await;
    let online: usize = participants.values().map(|v| v.len()).sum();

    Ok(Json(GlobalStats {
        board_count: stats.board_count,
        ticket_count: stats.ticket_count,
        vote_count: stats.vote_count,
        online_participants: online,
    }))
}

pub async fn list_boards(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> Result<Json<Vec<AdminBoardSummary>>, AppError> {
    let rows = db::admin_list_boards(&state.db).await?;
    let participants = state.participants.read().await;

    let boards = rows
        .into_iter()
        .map(|r| AdminBoardSummary {
            online_participants: participants.get(&r.id).map(|v| v.len()).unwrap_or(0),
            id: r.id,
            title: r.title,
            is_blurred: r.is_blurred,
            created_at: r.created_at,
            column_count: r.column_count,
            ticket_count: r.ticket_count,
            vote_count: r.vote_count,
        })
        .collect();

    Ok(Json(boards))
}

pub async fn get_board_detail(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<AdminBoardDetail>, AppError> {
    let board = db::get_board(&state.db, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;

    let online = state.participant_count(&board_id).await;

    let columns = board
        .columns
        .iter()
        .map(|c| AdminColumnDetail {
            id: c.id.clone(),
            name: c.name.clone(),
            ticket_count: c.tickets.len(),
        })
        .collect();

    Ok(Json(AdminBoardDetail {
        id: board.id,
        title: board.title,
        is_blurred: board.is_blurred,
        created_at: board.created_at,
        facilitator_token: board.facilitator_token,
        columns,
        online_participants: online,
    }))
}

// --- Template management ---

pub async fn list_templates(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::models::Template>>, AppError> {
    let templates = db::list_templates(&state.db).await?;
    Ok(Json(templates))
}

#[derive(Deserialize)]
pub struct CreateTemplateRequest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub position: i32,
}

pub async fn create_template(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Json(req): Json<CreateTemplateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.id.trim().is_empty() || req.name.trim().is_empty() {
        return Err(AppError::BadRequest("ID and name are required".to_string()));
    }
    if req.columns.is_empty() {
        return Err(AppError::BadRequest(
            "At least one column is required".to_string(),
        ));
    }
    db::create_template(
        &state.db,
        &req.id,
        &req.name,
        &req.description,
        &req.columns,
        req.position,
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct UpdateTemplateRequest {
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub position: i32,
}

pub async fn update_template(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(template_id): Path<String>,
    Json(req): Json<UpdateTemplateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("Name is required".to_string()));
    }
    if req.columns.is_empty() {
        return Err(AppError::BadRequest(
            "At least one column is required".to_string(),
        ));
    }
    let updated = db::update_template(
        &state.db,
        &template_id,
        &req.name,
        &req.description,
        &req.columns,
        req.position,
    )
    .await?;
    if !updated {
        return Err(AppError::NotFound("Template not found".to_string()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_template(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(template_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deleted = db::delete_template(&state.db, &template_id).await?;
    if !deleted {
        return Err(AppError::NotFound("Template not found".to_string()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_board(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deleted = db::admin_delete_board(&state.db, &board_id).await?;
    if !deleted {
        return Err(AppError::NotFound("Board not found".to_string()));
    }

    // Clean up in-memory state
    {
        let mut participants = state.participants.write().await;
        participants.remove(&board_id);
    }
    {
        let mut channels = state.channels.write().await;
        channels.remove(&board_id);
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
