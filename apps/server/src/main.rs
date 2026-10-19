mod account;
mod auth;
mod communities;
mod config;
mod error;
mod messaging;
mod realtime;
mod request_security;

use crate::{config::Config, error::ApiError};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{broadcast, Semaphore};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    pool: PgPool,
    config: Arc<Config>,
    events: broadcast::Sender<realtime::Event>,
    rate_limiter: Arc<auth::RateLimiter>,
    password_workers: Arc<Semaphore>,
    dummy_password_hash: Arc<str>,
    tickets: Arc<Mutex<HashMap<String, realtime::WsTicket>>>,
    connections: Arc<realtime::Connections>,
    message_limiter: Arc<messaging::MessageRateLimiter>,
}

pub fn check_origin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    match request_security::origin(&state.config.allowed_origin, headers)? {
        request_security::RequestOrigin::Browser => Ok(()),
        request_security::RequestOrigin::Absent => Err(request_security::origin_error()),
    }
}

async fn security(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let rejected = if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        request_security::unsafe_request(
            &state.config.allowed_origin,
            request.uri().path(),
            request.headers(),
        )
        .err()
    } else if request.headers().contains_key(header::ORIGIN) {
        check_origin(&state, request.headers()).err()
    } else {
        None
    };
    let response = match rejected {
        Some(error) => axum::response::IntoResponse::into_response(error),
        None => next.run(request).await,
    };
    let mut response = error::normalize_response(response);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

async fn instance(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"name":state.config.instance_name,"version":env!("CARGO_PKG_VERSION"),"registrationOpen":state.config.registration_open,"authMethods":["password"]}),
    )
}
async fn live() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"ok"}))
}
async fn ready(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.pool),
    )
    .await;
    if !matches!(result, Ok(Ok(1))) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "not_ready",
            "La base de datos no está disponible.",
        ));
    }
    Ok(Json(serde_json::json!({"status":"ready"})))
}
async fn not_found() -> ApiError {
    ApiError::not_found()
}

fn router(state: AppState) -> Result<Router, Box<dyn std::error::Error>> {
    let cors = CorsLayer::new()
        .allow_origin(state.config.allowed_origin.parse::<HeaderValue>()?)
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);
    let api = Router::new()
        .route("/instance", get(instance))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/me", get(account::me))
        .route("/auth/logout", post(auth::logout))
        .route("/bootstrap", get(communities::bootstrap))
        .route("/communities", post(communities::create_community))
        .route(
            "/communities/{id}/channels",
            post(communities::create_channel),
        )
        .route(
            "/communities/{id}/invites",
            post(communities::create_invite),
        )
        .route(
            "/communities/{id}/members/{user_id}",
            delete(communities::remove_member),
        )
        .route("/invites/{code}/join", post(communities::join_invite))
        .route(
            "/channels/{id}/messages",
            get(messaging::history).post(messaging::send),
        )
        .route(
            "/channels/{channel_id}/messages/{message_id}",
            delete(messaging::delete),
        )
        .route("/events/ticket", post(realtime::ticket))
        .route("/events", get(realtime::events))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .layer(cors);
    Ok(Router::new()
        .nest("/api/v1", api)
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .fallback(not_found)
        .with_state(state))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nuvex_server=info".into()),
        )
        .init();
    let config = Config::from_env().map_err(std::io::Error::other)?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;
    let migrate_only = std::env::args().skip(1).any(|arg| arg == "--migrate");
    if migrate_only || config.migrate_on_start {
        sqlx::migrate!("./migrations").run(&pool).await?;
        tracing::info!("Database migrations applied");
    }
    if migrate_only {
        return Ok(());
    }
    let password = auth::random_token(32);
    let dummy_password_hash = tokio::task::spawn_blocking(move || auth::hash_password(&password))
        .await?
        .map_err(|_| std::io::Error::other("Could not initialize password verifier"))?;
    let (events, _) = broadcast::channel(256);
    let bind = config.bind;
    let state = AppState {
        pool,
        config: Arc::new(config),
        events,
        rate_limiter: Arc::new(auth::RateLimiter::default()),
        password_workers: Arc::new(Semaphore::new(4)),
        dummy_password_hash: dummy_password_hash.into(),
        tickets: Arc::new(Mutex::new(HashMap::new())),
        connections: Arc::new(realtime::Connections::default()),
        message_limiter: Arc::new(messaging::MessageRateLimiter::default()),
    };
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(address=%bind,"nu.vex server listening");
    axum::serve(
        listener,
        router(state)?.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("Shutdown requested");
}
