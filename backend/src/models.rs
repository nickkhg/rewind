use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub name: String,
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
}

impl Board {
    pub fn to_view_with_participants(&self, count: usize) -> BoardView {
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
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoardRequest {
    pub title: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub is_anonymous: bool,
}

#[derive(Debug, Serialize)]
pub struct CreateBoardResponse {
    pub board: BoardView,
    pub facilitator_token: String,
}
