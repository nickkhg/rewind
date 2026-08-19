mod auth;
mod db;
mod error;
mod models;
mod password;
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
use http::header::{AUTHORIZATION, ACCEPT, CONTENT_TYPE};
use http::{HeaderName, Method};
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

    // The key comes from a Kubernetes secret. An empty value counts as no key at all, because
    // the chart writes an empty string when the operator leaves the value out.
    let giphy_api_key = std::env::var("GIPHY_API_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    if giphy_api_key.is_some() {
        tracing::info!("GIPHY enabled");
    } else {
        tracing::info!("no GIPHY key set — GIF controls are off");
    }

    // The three values of the Entra app registration, or nothing at all. Nothing leaves the server
    // open to whoever holds a board link, as it has always been.
    let entra = auth::EntraAuth::from_env();
    if entra.is_none() {
        tracing::info!("no Entra app registration set — the server asks nobody to sign in");
    }

    let state = AppState::new(db, admin_token_hash, giphy_api_key, entra);
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_default();

    let mut app = Router::new()
        .route("/api/health", get(routes::config::health))
        .route("/api/auth/login", get(auth::login))
        .route("/api/auth/callback", get(auth::callback))
        .route("/api/auth/logout", get(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/config", get(routes::config::get_config))
        .route("/api/templates", get(routes::boards::list_templates))
        .route("/api/boards", post(routes::boards::create_board))
        .route("/api/boards/{id}", get(routes::boards::get_board))
        .route(
            "/api/boards/{id}/access",
            get(routes::boards::board_access),
        )
        .route("/api/boards/{id}/unlock", post(routes::boards::unlock_board))
        .route(
            "/api/boards/{id}/password",
            put(routes::boards::set_password),
        )
        .route(
            "/api/boards/{id}/action-sources",
            get(routes::boards::list_action_sources),
        )
        .route(
            "/api/boards/{id}/actions/import",
            post(routes::boards::import_actions),
        )
        .route("/api/boards/{id}/title", put(routes::boards::set_title))
        .route("/api/boards/{id}/labels", put(routes::boards::set_labels))
        .route("/api/labels", get(routes::boards::list_labels))
        .route("/api/my-boards", get(routes::boards::my_boards))
        .route("/api/teams", get(routes::boards::list_teams))
        .route("/ws/boards/{id}", get(routes::ws::ws_handler))
        .route("/api/admin/verify", post(routes::admin::verify_token))
        .route("/api/admin/stats", get(routes::admin::global_stats))
        .route("/api/admin/restart", post(routes::admin::restart_service))
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
        )
        // The one route that reaches back to the boards already made from a template.
        .route(
            "/api/admin/templates/{id}/apply",
            post(routes::admin::apply_template),
        )
        .route(
            "/api/admin/teams",
            get(routes::admin::list_teams).post(routes::admin::create_team),
        )
        .route(
            "/api/admin/teams/{id}",
            put(routes::admin::update_team).delete(routes::admin::delete_team),
        );

    // Serve frontend static files if STATIC_DIR is set (production)
    if !static_dir.is_empty() {
        let index = PathBuf::from(&static_dir).join("index.html");
        app = app.fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)));
    }

    let app = app
        // The gate goes on last of the three, so that it sits inside the CORS layer: a preflight is
        // answered before anyone is asked to sign in, and a 401 still carries the CORS headers that
        // let the desktop app read the reason. It wraps the static files as well, so a browser that
        // asks for a page while signed out is sent to Entra before it is sent the bundle.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::gate,
        ))
        .layer(
            CorsLayer::new()
                // The last one carries the key to a locked board, which a GET has no body for.
                .allow_headers([
                    AUTHORIZATION,
                    ACCEPT,
                    CONTENT_TYPE,
                    HeaderName::from_static(routes::boards::ACCESS_TOKEN_HEADER),
                ])
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
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
