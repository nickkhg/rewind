mod error;
mod models;
mod protocol;
mod routes;
mod state;

use axum::routing::{get, post};
use axum::Router;
use state::AppState;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let state = AppState::new();

    let app = Router::new()
        .route("/api/boards", post(routes::boards::create_board))
        .route("/api/boards/{id}", get(routes::boards::get_board))
        .route("/ws/boards/{id}", get(routes::ws::ws_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = "0.0.0.0:3001";
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
