use axum::extract::State;
use axum::Json;

use crate::models::ClientConfig;
use crate::state::AppState;

/// Hands the frontend the settings it cannot know on its own.
///
/// The GIPHY key arrives in the pod from a Kubernetes secret, so it is not in the built frontend
/// bundle and it does not sit in the repository. The browser has to hold the key to reach GIPHY,
/// which is how the GIPHY web SDK works, so this route is the way it gets there. A deployment
/// with no key set gets `null`, and the frontend then leaves the GIF controls out.
pub async fn get_config(State(state): State<AppState>) -> Json<ClientConfig> {
    Json(ClientConfig {
        giphy_api_key: state.giphy_api_key.clone(),
        // Read at compile time from `backend/Cargo.toml`, which the release bumps.
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
