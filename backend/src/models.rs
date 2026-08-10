use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Column roles. Every board has one column of each role.
pub const ROLE_PREVIOUS_ACTIONS: &str = "previous_actions";
pub const ROLE_ACTIONS: &str = "actions";

/// Column names that only the two role columns can use.
pub const RESERVED_COLUMN_NAMES: [&str; 4] = [
    "actions",
    "action items",
    "action item",
    "previous actions",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub title: String,
    pub columns: Vec<Column>,
    pub is_blurred: bool,
    pub is_anonymous: bool,
    pub hide_votes: bool,
    pub created_at: DateTime<Utc>,
    pub facilitator_token: String,
    pub facilitator_id: Option<String>,
    pub participants: Vec<Participant>,
    pub vote_limit_per_column: Option<i32>,
    pub timer_end: Option<DateTime<Utc>>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub tickets: Vec<Ticket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticket {
    pub id: String,
    pub content: String,
    pub author_id: String,
    pub author_name: String,
    pub votes: HashSet<String>,
    pub created_at: DateTime<Utc>,
    pub carried_from_board_id: Option<String>,
    pub carried_from_board_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub id: String,
    pub name: String,
}

/// Public view of a board — excludes facilitator_token
#[derive(Debug, Clone, Serialize)]
pub struct BoardView {
    pub id: String,
    pub title: String,
    pub columns: Vec<Column>,
    pub is_blurred: bool,
    pub is_anonymous: bool,
    pub hide_votes: bool,
    pub created_at: DateTime<Utc>,
    pub participant_count: usize,
    pub vote_limit_per_column: Option<i32>,
    pub timer_end: Option<DateTime<Utc>>,
    pub editors: Vec<EditorView>,
    pub editor_requests: Vec<EditorRequestView>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorView {
    pub participant_id: String,
    pub participant_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorRequestView {
    pub participant_id: String,
    pub participant_name: String,
}

impl Board {
    pub fn to_view_with_participants(
        &self,
        count: usize,
        editors: Vec<EditorView>,
        editor_requests: Vec<EditorRequestView>,
    ) -> BoardView {
        BoardView {
            id: self.id.clone(),
            title: self.title.clone(),
            columns: self.columns.clone(),
            is_blurred: self.is_blurred,
            is_anonymous: self.is_anonymous,
            hide_votes: self.hide_votes,
            created_at: self.created_at,
            participant_count: count,
            vote_limit_per_column: self.vote_limit_per_column,
            timer_end: self.timer_end,
            editors,
            editor_requests,
            labels: self.labels.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MyBoardSummary {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub column_count: i64,
    pub ticket_count: i64,
    pub is_anonymous: bool,
    pub labels: Vec<String>,
}

/// A board that can supply actions to another board.
#[derive(Debug, Clone, Serialize)]
pub struct ActionSourceBoard {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub action_count: i64,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LabelCount {
    pub label: String,
    pub board_count: i64,
}

/// The result of a copy from one board to another.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
}

// --- Teams ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoardRequest {
    pub title: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub is_anonymous: bool,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// The most labels that one board can carry.
pub const MAX_LABELS_PER_BOARD: usize = 6;

/// Puts a label into the form that the database keeps: lower case, one space between words.
pub fn normalize_label(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Cleans a list of labels: normalizes each one, removes the empty and the double entries,
/// and keeps at most `MAX_LABELS_PER_BOARD`.
pub fn normalize_labels(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for label in raw {
        let label = normalize_label(label);
        if label.is_empty() || label.len() > 40 || out.contains(&label) {
            continue;
        }
        out.push(label);
        if out.len() == MAX_LABELS_PER_BOARD {
            break;
        }
    }
    out
}

#[derive(Debug, Serialize)]
pub struct CreateBoardResponse {
    pub board: BoardView,
    pub facilitator_token: String,
}
