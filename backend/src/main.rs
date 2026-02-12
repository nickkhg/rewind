mod error;
mod models;
mod protocol;
mod routes;
mod state;

use axum::routing::{get, post};
use axum::Router;
use state::AppState;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let state = AppState::new();
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_default();

    let mut app = Router::new()
        .route("/api/boards", post(routes::boards::create_board))
        .route("/api/boards/{id}", get(routes::boards::get_board))
        .route("/ws/boards/{id}", get(routes::ws::ws_handler));

    // Serve frontend static files if STATIC_DIR is set (production)
    if !static_dir.is_empty() {
        let index = PathBuf::from(&static_dir).join("index.html");
        app = app.fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)));
    }

    let app = app
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
