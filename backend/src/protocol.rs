use crate::models::{BoardView, Gif};
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
        /// A GIF the writer picked with `/gif`. Absent when the card is words alone.
        #[serde(default)]
        gif: Option<Gif>,
    },
    RemoveTicket {
        ticket_id: String,
    },
    EditTicket {
        ticket_id: String,
        content: String,
        /// The GIF the card keeps after the edit. Absent takes the GIF off the card.
        #[serde(default)]
        gif: Option<Gif>,
    },
    MoveTicket {
        ticket_id: String,
        column_id: String,
    },
    AddComment {
        ticket_id: String,
        content: String,
        #[serde(default)]
        gif: Option<Gif>,
    },
    EditComment {
        comment_id: String,
        content: String,
        #[serde(default)]
        gif: Option<Gif>,
    },
    RemoveComment {
        comment_id: String,
    },
    ToggleVote {
        ticket_id: String,
    },
    ToggleBlur,
    ToggleHideVotes,
    MergeTickets {
        source_ticket_id: String,
        target_ticket_id: String,
    },
    UndoMerge,
    SplitTicket {
        ticket_id: String,
        segment_index: usize,
    },
    SetVoteLimit {
        limit: Option<i32>,
    },
    StartTimer {
        duration_secs: u32,
    },
    StopTimer,
    RequestEditor {
        name: Option<String>,
    },
    ApproveEditor {
        participant_id: String,
    },
    DeclineEditor {
        participant_id: String,
    },
    RemoveEditor {
        participant_id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    BoardState { board: BoardView },
    Authenticated { is_facilitator: bool, participant_id: String },
    Error { message: String },
}
