use crate::models::{Gif, Participant};
use crate::protocol::ServerMessage;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub type BoardChannel = broadcast::Sender<ServerMessage>;

#[derive(Debug, Clone)]
pub struct MergeSnapshot {
    pub source_id: String,
    pub source_column_id: String,
    pub source_content: String,
    pub source_author_id: String,
    pub source_author_name: String,
    pub source_created_at: DateTime<Utc>,
    pub source_votes: Vec<String>,
    pub source_carried_from_board_id: Option<String>,
    pub source_carried_from_board_title: Option<String>,
    /// The comments that moved to the target card with the merge. An undo sends them back.
    pub source_comment_ids: Vec<String>,
    /// The GIF of the source card. A merge onto a card with no GIF hands this over,
    /// so the undo has to know where it came from.
    pub source_gif: Option<Gif>,
    /// The rock status of the source card. A merge keeps the mark of the target,
    /// so this one only comes back with the undo.
    pub source_rock_status: Option<String>,
    /// When the source action was closed, for the same reason as the rock status above.
    pub source_done_at: Option<DateTime<Utc>>,
    pub target_id: String,
    pub target_original_content: String,
    pub target_original_gif: Option<Gif>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub participants: Arc<RwLock<HashMap<String, Vec<Participant>>>>,
    pub channels: Arc<RwLock<HashMap<String, BoardChannel>>>,
    pub admin_token_hash: Option<String>,
    pub last_merge: Arc<RwLock<HashMap<String, MergeSnapshot>>>,
    /// The GIPHY key from the Kubernetes secret. None leaves the GIF controls out of the frontend.
    pub giphy_api_key: Option<String>,
}

impl AppState {
    pub fn new(
        db: PgPool,
        admin_token_hash: Option<String>,
        giphy_api_key: Option<String>,
    ) -> Self {
        Self {
            db,
            participants: Arc::new(RwLock::new(HashMap::new())),
            channels: Arc::new(RwLock::new(HashMap::new())),
            admin_token_hash,
            last_merge: Arc::new(RwLock::new(HashMap::new())),
            giphy_api_key,
        }
    }

    pub async fn get_or_create_channel(&self, board_id: &str) -> BoardChannel {
        let channels = self.channels.read().await;
        if let Some(tx) = channels.get(board_id) {
            return tx.clone();
        }
        drop(channels);

        let mut channels = self.channels.write().await;
        // Double-check after acquiring write lock
        if let Some(tx) = channels.get(board_id) {
            return tx.clone();
        }
        let (tx, _) = broadcast::channel(64);
        channels.insert(board_id.to_string(), tx.clone());
        tx
    }

    pub async fn participant_count(&self, board_id: &str) -> usize {
        let participants = self.participants.read().await;
        participants.get(board_id).map(|v| v.len()).unwrap_or(0)
    }
}
