use crate::models::Board;
use crate::protocol::ServerMessage;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub type BoardChannel = broadcast::Sender<ServerMessage>;

#[derive(Clone)]
pub struct AppState {
    pub boards: Arc<RwLock<HashMap<String, Board>>>,
    pub channels: Arc<RwLock<HashMap<String, BoardChannel>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            boards: Arc::new(RwLock::new(HashMap::new())),
            channels: Arc::new(RwLock::new(HashMap::new())),
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
}
