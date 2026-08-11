use axum::extract::State;
use axum::{Extension, Json};
use serde::Serialize;

use crate::auth::{AuthConfig, Identity};
use crate::models::ClientConfig;
use crate::state::AppState;

/// Hands the frontend the settings it cannot know on its own.
///
/// The GIPHY key arrives in the pod from a Kubernetes secret, so it is not in the built frontend
/// bundle and it does not sit in the repository. The browser has to hold the key to reach GIPHY,
/// which is how the GIPHY web SDK works, so this route is the way it gets there. A deployment
/// with no key set gets `null`, and the frontend then leaves the GIF controls out.
///
/// The signed-in user rides along, because every reader of this route has come through the gate
/// already and the answer is the one request the frontend makes at startup either way. `auth.user`
/// is what puts a name in the join field, so nobody types their own.
pub async fn get_config(
    State(state): State<AppState>,
    identity: Option<Extension<Identity>>,
) -> Json<ClientConfig> {
    Json(ClientConfig {
        giphy_api_key: state.giphy_api_key.clone(),
        // Read at compile time from `backend/Cargo.toml`, which the release bumps.
        version: env!("CARGO_PKG_VERSION").to_string(),
        auth: AuthConfig {
            enabled: state.entra.is_some(),
            user: identity.map(|Extension(identity)| identity),
        },
    })
}

#[derive(Debug, Serialize)]
pub struct Health {
    pub status: &'static str,
    /// Whether this server asks for a work account. The desktop app reads it to say why it cannot
    /// open this server, since it has no way to run a browser sign-in.
    pub auth_required: bool,
}

/// Says the server is up, to anyone, signed in or not.
///
/// The Kubernetes probes read this rather than a real route: behind an Entra deployment every other
/// route answers 401, and a probe that reads a 401 as "unhealthy" would restart the pod for ever.
pub async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        auth_required: state.entra.is_some(),
    })
}
