mod db;
mod error;
mod models;
mod protocol;
mod routes;
mod state;

use axum::routing::{get, post, put};
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use std::path::PathBuf;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    sqlx::migrate!()
        .run(&db)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("database connected and migrations applied");

    let admin_token_hash = std::env::var("ADMIN_TOKEN_HASH").ok();
    if admin_token_hash.is_some() {
        tracing::info!("admin interface enabled");
    }

    let state = AppState::new(db, admin_token_hash);
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_default();

    let mut app = Router::new()
        .route("/api/templates", get(routes::boards::list_templates))
        .route("/api/boards", post(routes::boards::create_board))
        .route("/api/boards/{id}", get(routes::boards::get_board))
        .route("/api/my-boards", get(routes::boards::my_boards))
        .route("/ws/boards/{id}", get(routes::ws::ws_handler))
        .route("/api/admin/verify", post(routes::admin::verify_token))
        .route("/api/admin/stats", get(routes::admin::global_stats))
        .route("/api/admin/boards", get(routes::admin::list_boards))
        .route(
            "/api/admin/boards/{id}",
            get(routes::admin::get_board_detail).delete(routes::admin::delete_board),
        )
        .route(
            "/api/admin/templates",
            get(routes::admin::list_templates).post(routes::admin::create_template),
        )
        .route(
            "/api/admin/templates/{id}",
            put(routes::admin::update_template).delete(routes::admin::delete_template),
        );

    // Serve frontend static files if STATIC_DIR is set (production)
    if !static_dir.is_empty() {
        let index = PathBuf::from(&static_dir).join("index.html");
        app = app.fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)));
    }

    let app = app
        .layer(
            CorsLayer::permissive()
                .allow_origin(AllowOrigin::mirror_request())
                .allow_credentials(true),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
