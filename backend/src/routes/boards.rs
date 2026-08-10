use axum::extract::{Path, Query, State};
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use time::Duration;

use crate::db;
use crate::error::AppError;
use crate::models::{
    normalize_labels, ActionSourceBoard, CreateBoardRequest, CreateBoardResponse, ImportResult,
    LabelCount, MyBoardSummary, Template, RESERVED_COLUMN_NAMES, ROLE_ACTIONS,
    ROLE_PREVIOUS_ACTIONS, ROLE_ROCKS, TEMPLATE_LEVEL10,
};
use crate::state::AppState;
use chrono::Utc;
use nanoid::nanoid;
use uuid::Uuid;

/// The largest number of source boards that one list request returns.
const ACTION_SOURCE_LIMIT: i64 = 50;

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
    let labels = normalize_labels(&req.labels);

    // The board keeps the template as a format tag. An id that names no template is dropped,
    // so that a made-up value cannot turn a feature on.
    let template_id = match req.template_id.as_deref() {
        Some(id) if db::template_exists(&state.db, id).await? => Some(id.to_string()),
        _ => None,
    };
    let is_level10 = template_id.as_deref() == Some(TEMPLATE_LEVEL10);

    // Every board starts with Previous Actions and ends with Actions. A column that the caller
    // asks for with one of those names would only repeat them.
    let mut columns: Vec<(String, String, Option<&str>)> = vec![(
        nanoid!(8),
        "Previous Actions".to_string(),
        Some(ROLE_PREVIOUS_ACTIONS),
    )];
    // On a Level 10 board the Rocks column takes a role, which is what lets a card in it carry a
    // rock status. Only the first such column gets it: one column of each role to a board.
    let mut rocks_taken = false;
    columns.extend(
        req.columns
            .into_iter()
            .filter(|name| !RESERVED_COLUMN_NAMES.contains(&name.trim().to_lowercase().as_str()))
            .map(|name| {
                let role = if is_level10 && !rocks_taken && name.trim().to_lowercase() == "rocks" {
                    rocks_taken = true;
                    Some(ROLE_ROCKS)
                } else {
                    None
                };
                (nanoid!(8), name, role)
            }),
    );
    columns.push((nanoid!(8), "Actions".to_string(), Some(ROLE_ACTIONS)));

    let board = db::create_board(
        &state.db,
        &board_id,
        &req.title,
        &facilitator_token,
        &facilitator_id,
        &columns,
        created_at,
        req.is_anonymous,
        &labels,
        template_id.as_deref(),
    )
    .await?;

    let view = board.to_view_with_participants(0, Vec::new(), Vec::new());

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
    jar: CookieJar,
    Path(board_id): Path<String>,
) -> Result<Json<crate::models::BoardView>, AppError> {
    let board = db::get_board(&state.db, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;

    let count = state.participant_count(&board_id).await;
    let editors = db::get_board_editors(&state.db, &board_id).await.unwrap_or_default();
    let editor_requests = db::get_editor_requests(&state.db, &board_id).await.unwrap_or_default();
    let mut view = board.to_view_with_participants(count, editors, editor_requests);

    // This route names no participant, so it can hold no cards of its own. Only the facilitator
    // reads a blurred board here; for everyone else the words stay on the server.
    let facilitator_id = jar.get("facilitator_id").map(|c| c.value());
    let is_facilitator =
        db::is_board_privileged(&state.db, &board_id, None, facilitator_id, None).await?;
    view.redact_hidden_for("", is_facilitator);

    Ok(Json(view))
}

pub async fn list_templates(
    State(state): State<AppState>,
) -> Result<Json<Vec<Template>>, AppError> {
    let templates = db::list_templates(&state.db).await?;
    Ok(Json(templates))
}

pub async fn list_teams(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::models::Team>>, AppError> {
    let teams = db::list_teams(&state.db).await?;
    Ok(Json(teams))
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

// --- Actions carry-over ---

#[derive(Debug, Deserialize)]
pub struct ActionSourceQuery {
    #[serde(default)]
    pub q: String,
    /// Labels that a board must carry, separated by commas. An empty value matches every board.
    #[serde(default)]
    pub labels: String,
}

/// Lists the boards that can supply actions to this board.
pub async fn list_action_sources(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(query): Query<ActionSourceQuery>,
) -> Result<Json<Vec<ActionSourceBoard>>, AppError> {
    let labels: Vec<String> = query
        .labels
        .split(',')
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty())
        .collect();

    let boards = db::list_action_sources(
        &state.db,
        &board_id,
        query.q.trim(),
        &labels,
        ACTION_SOURCE_LIMIT,
    )
    .await?;
    Ok(Json(boards))
}

/// The caller states who they are. The WebSocket handler trusts the same values.
#[derive(Debug, Deserialize)]
pub struct BoardAuth {
    #[serde(default)]
    pub facilitator_token: Option<String>,
    #[serde(default)]
    pub participant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportActionsRequest {
    pub source_board_id: String,
    #[serde(flatten)]
    pub auth: BoardAuth,
}

/// Copies the actions of another board into the Previous Actions column of this board.
pub async fn import_actions(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(board_id): Path<String>,
    Json(req): Json<ImportActionsRequest>,
) -> Result<Json<ImportResult>, AppError> {
    if req.source_board_id == board_id {
        return Err(AppError::BadRequest(
            "A board cannot copy its own actions".to_string(),
        ));
    }

    authorize(&state, &jar, &board_id, &req.auth).await?;

    let result = db::copy_actions(&state.db, &req.source_board_id, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("That board has no actions to copy".to_string()))?;

    crate::routes::ws::broadcast_board_state(&state, &board_id).await;

    Ok(Json(result))
}

// --- Labels ---

pub async fn list_labels(
    State(state): State<AppState>,
) -> Result<Json<Vec<LabelCount>>, AppError> {
    let labels = db::list_labels(&state.db).await?;
    Ok(Json(labels))
}

#[derive(Debug, Deserialize)]
pub struct SetLabelsRequest {
    pub labels: Vec<String>,
    #[serde(flatten)]
    pub auth: BoardAuth,
}

/// Replaces the labels of a board.
pub async fn set_labels(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(board_id): Path<String>,
    Json(req): Json<SetLabelsRequest>,
) -> Result<Json<Vec<String>>, AppError> {
    authorize(&state, &jar, &board_id, &req.auth).await?;

    let labels = normalize_labels(&req.labels);
    db::set_board_labels(&state.db, &board_id, &labels).await?;

    crate::routes::ws::broadcast_board_state(&state, &board_id).await;

    Ok(Json(labels))
}

/// Lets through the facilitator and the editors of the board.
async fn authorize(
    state: &AppState,
    jar: &CookieJar,
    board_id: &str,
    auth: &BoardAuth,
) -> Result<(), AppError> {
    if db::get_board_facilitator_token(&state.db, board_id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound("Board not found".to_string()));
    }

    let facilitator_id_cookie = jar.get("facilitator_id").map(|c| c.value().to_string());
    let privileged = db::is_board_privileged(
        &state.db,
        board_id,
        auth.facilitator_token.as_deref(),
        facilitator_id_cookie.as_deref(),
        auth.participant_id.as_deref(),
    )
    .await?;

    if privileged {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "Only the facilitator and the editors can do this".to_string(),
        ))
    }
}
