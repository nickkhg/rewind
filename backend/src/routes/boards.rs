use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use time::Duration;

use crate::db;
use crate::db::CopyOutcome;
use crate::error::AppError;
use crate::models::{
    normalize_labels, read_password, ActionSourceBoard, BoardAccessView, CreateBoardRequest,
    CreateBoardResponse, ImportResult, LabelCount, MyBoardSummary, PasswordResponse, Template,
    UnlockResponse, RESERVED_COLUMN_NAMES, ROLE_ACTIONS, ROLE_PREVIOUS_ACTIONS, ROLE_ROCKS,
    TEMPLATE_LEVEL10,
};
use crate::password;
use crate::state::AppState;
use chrono::Utc;
use nanoid::nanoid;
use uuid::Uuid;

/// The largest number of source boards that one list request returns.
const ACTION_SOURCE_LIMIT: i64 = 50;

/// The header that carries the key a reader got for the password of a locked board.
/// A GET has no body to put it in, and a cookie for each board would not survive the Tauri app.
pub const ACCESS_TOKEN_HEADER: &str = "x-board-access";

/// Reads the key out of the request headers.
fn access_token_from(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(ACCESS_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

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
    let access_token = nanoid!(32);
    let created_at = Utc::now();
    let labels = normalize_labels(&req.labels);

    // A board that asks for a password keeps the hash of it. A board that asks for none keeps
    // NULL, and the key below is never read.
    let password = read_password(req.password.as_deref()).map_err(AppError::BadRequest)?;
    let password_hash = match password {
        Some(password) => Some(password::hash(password).await?),
        None => None,
    };

    // The board keeps the template as a format tag. An id that names no template is dropped,
    // so that a made-up value cannot turn a feature on.
    let template = match req.template_id.as_deref() {
        Some(id) => db::get_template(&state.db, id).await?,
        None => None,
    };
    let template_id = template.as_ref().map(|t| t.id.clone());
    let is_level10 = template_id.as_deref() == Some(TEMPLATE_LEVEL10);

    // The template says how the board opens. A custom board opens blurred, as a retro does.
    let is_blurred = template.as_ref().map(|t| t.default_blurred).unwrap_or(true);

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
        password_hash.as_deref(),
        &access_token,
        is_blurred,
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
            access_token,
        }),
    ))
}

pub async fn get_board(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(board_id): Path<String>,
) -> Result<Json<crate::models::BoardView>, AppError> {
    // The gate comes before the board. This route would otherwise hand the whole of a locked
    // board to anyone who asks for it by id.
    authorize_read(&state, &jar, &board_id, access_token_from(&headers)).await?;

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

// --- The password of a board ---

/// What a person may learn about a board before the gate opens: the name of it, whether it is
/// locked for them, and whether it will ask for their name.
///
/// The title goes out even while the board is locked. Whoever asks already holds the link, and a
/// gate that cannot name what it guards leaves the reader unsure they are in the right meeting.
/// Nothing that is on the board comes with it.
pub async fn board_access(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(board_id): Path<String>,
) -> Result<Json<BoardAccessView>, AppError> {
    let access = db::get_board_access(&state.db, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;

    let is_locked = match access.password_hash {
        None => false,
        Some(_) => {
            !holds_key(
                &state,
                &jar,
                &board_id,
                access_token_from(&headers),
                &access.access_token,
            )
            .await?
        }
    };

    Ok(Json(BoardAccessView {
        id: board_id,
        title: access.title,
        is_locked,
        is_anonymous: access.is_anonymous,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UnlockRequest {
    pub password: String,
}

/// Takes the password of a board and gives back the key to it.
///
/// The Argon2 check is the only guard on how fast this route can be tried, and it is a good one:
/// each attempt costs the server the same tens of milliseconds it costs the caller.
pub async fn unlock_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(req): Json<UnlockRequest>,
) -> Result<Json<UnlockResponse>, AppError> {
    let access = db::get_board_access(&state.db, &board_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Board not found".to_string()))?;

    let Some(hash) = access.password_hash else {
        return Err(AppError::BadRequest(
            "This board has no password".to_string(),
        ));
    };

    // Trimmed the same way it was trimmed when it was set, so that a paste with a space at the
    // end opens the board it was meant to open.
    let password = req.password.trim().to_string();
    if password.is_empty() || !password::verify(password, hash).await? {
        return Err(AppError::Unauthorized("The password is wrong".to_string()));
    }

    Ok(Json(UnlockResponse {
        access_token: access.access_token,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SetPasswordRequest {
    /// The new word. Absent, or empty, takes the lock off the board.
    #[serde(default)]
    pub password: Option<String>,
    #[serde(flatten)]
    pub auth: BoardAuth,
}

/// Puts a password on a board, changes it, or takes it off. The facilitator alone.
///
/// Every write makes a new key, so a change of password shuts the board on the readers who hold
/// the old one: the next time they open the board they are asked again. The sockets that are
/// already joined stay joined, because a change of password mid-meeting is meant to keep the next
/// reader out and not to throw the room out.
pub async fn set_password(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(board_id): Path<String>,
    Json(req): Json<SetPasswordRequest>,
) -> Result<Json<PasswordResponse>, AppError> {
    authorize_facilitator(&state, &jar, &board_id, &req.auth).await?;

    let password = read_password(req.password.as_deref()).map_err(AppError::BadRequest)?;
    let hash = match password {
        Some(password) => Some(password::hash(password).await?),
        None => None,
    };

    let access_token = nanoid!(32);
    if !db::set_board_password(&state.db, &board_id, hash.as_deref(), &access_token).await? {
        return Err(AppError::NotFound("Board not found".to_string()));
    }

    // The board now says whether it is locked, so the open clients have to hear it.
    crate::routes::ws::broadcast_board_state(&state, &board_id).await;

    Ok(Json(PasswordResponse {
        has_password: hash.is_some(),
        access_token,
    }))
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
    /// Which column the cards come from, and which one they land in. Absent means the carry-over
    /// this route was written for: the Actions of the source board into Previous Actions here.
    #[serde(default)]
    pub source_column_id: Option<String>,
    #[serde(default)]
    pub target_column_id: Option<String>,
    /// The key to the source board, when that board asks for a password. A caller who is the
    /// facilitator or an editor of it needs none.
    #[serde(default)]
    pub source_access_token: Option<String>,
    #[serde(flatten)]
    pub auth: BoardAuth,
}

/// Copies cards from a column of another board into a column of this one.
pub async fn import_actions(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(board_id): Path<String>,
    Json(req): Json<ImportActionsRequest>,
) -> Result<Json<ImportResult>, AppError> {
    if req.source_board_id == board_id {
        return Err(AppError::BadRequest(
            "A board cannot copy from itself".to_string(),
        ));
    }

    authorize(&state, &jar, &board_id, &req.auth).await?;

    // The gate of the source board stands in the way of the copy as well. The actions of a locked
    // board would otherwise reach a board that anyone can open, which takes the lock off them.
    // Being the facilitator of the target board says nothing about the source.
    authorize_read(
        &state,
        &jar,
        &req.source_board_id,
        req.source_access_token.as_deref(),
    )
    .await
    .map_err(|e| match e {
        AppError::Unauthorized(_) => {
            AppError::Unauthorized("That board asks for its own password".to_string())
        }
        other => other,
    })?;

    let outcome = db::copy_cards(
        &state.db,
        &req.source_board_id,
        req.source_column_id.as_deref(),
        &board_id,
        req.target_column_id.as_deref(),
    )
    .await?;

    let result = match outcome {
        CopyOutcome::Copied(result) => result,
        CopyOutcome::NoSourceColumn => {
            return Err(AppError::NotFound(
                "That board has no such column any more".to_string(),
            ))
        }
        CopyOutcome::NoTargetColumn => {
            return Err(AppError::NotFound(
                "This board has no such column any more".to_string(),
            ))
        }
    };

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

/// Lets through the facilitator alone — the token they were given, or the cookie of the person who
/// made the board. An editor may write on a board; the lock on it belongs to whoever called the
/// meeting.
async fn authorize_facilitator(
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
    let is_facilitator = db::is_board_privileged(
        &state.db,
        board_id,
        auth.facilitator_token.as_deref(),
        facilitator_id_cookie.as_deref(),
        None,
    )
    .await?;

    if is_facilitator {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "Only the facilitator can do this".to_string(),
        ))
    }
}

/// Lets a reader see the whole of a board. An open board is open to anyone who holds the link; a
/// locked one opens to the key it gave out, and to the facilitator and the editors, who were let
/// in already.
async fn authorize_read(
    state: &AppState,
    jar: &CookieJar,
    board_id: &str,
    access_token: Option<&str>,
) -> Result<(), AppError> {
    let Some(access) = db::get_board_access(&state.db, board_id).await? else {
        return Err(AppError::NotFound("Board not found".to_string()));
    };

    if access.password_hash.is_none() {
        return Ok(());
    }

    if holds_key(state, jar, board_id, access_token, &access.access_token).await? {
        Ok(())
    } else {
        Err(AppError::Unauthorized(
            "This board asks for a password".to_string(),
        ))
    }
}

/// Whether the caller holds the key of a locked board, or stands above the gate.
async fn holds_key(
    state: &AppState,
    jar: &CookieJar,
    board_id: &str,
    presented: Option<&str>,
    board_token: &str,
) -> Result<bool, AppError> {
    if presented == Some(board_token) {
        return Ok(true);
    }

    let facilitator_id_cookie = jar.get("facilitator_id").map(|c| c.value());
    Ok(db::is_board_privileged(&state.db, board_id, None, facilitator_id_cookie, None).await?)
}
