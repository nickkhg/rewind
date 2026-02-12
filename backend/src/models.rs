use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub title: String,
    pub columns: Vec<Column>,
    pub is_blurred: bool,
    pub created_at: DateTime<Utc>,
    pub facilitator_token: String,
    pub participants: Vec<Participant>,
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
    pub created_at: DateTime<Utc>,
    pub participant_count: usize,
}

impl Board {
    pub fn to_view_with_participants(&self, count: usize) -> BoardView {
        BoardView {
            id: self.id.clone(),
            title: self.title.clone(),
            columns: self.columns.clone(),
            is_blurred: self.is_blurred,
            created_at: self.created_at,
            participant_count: count,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateBoardRequest {
    pub title: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateBoardResponse {
    pub board: BoardView,
    pub facilitator_token: String,
}
