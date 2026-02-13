use crate::models::BoardView;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    Join {
        participant_name: String,
        facilitator_token: Option<String>,
        participant_id: Option<String>,
    },
    AddTicket {
        column_id: String,
        content: String,
    },
    RemoveTicket {
        ticket_id: String,
    },
    EditTicket {
        ticket_id: String,
        content: String,
    },
    ToggleVote {
        ticket_id: String,
    },
    ToggleBlur,
    MergeTickets {
        source_ticket_id: String,
        target_ticket_id: String,
    },
    UndoMerge,
    SplitTicket {
        ticket_id: String,
        segment_index: usize,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    BoardState { board: BoardView },
    Authenticated { is_facilitator: bool, participant_id: String },
    Error { message: String },
}
