use crate::{
    account::{get_user, User},
    error::{self, ApiError},
    AppState,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{ConnectInfo, FromRequestParts, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

const SESSION_SECONDS: u64 = 7 * 24 * 60 * 60;
const AUTH_WINDOW: Duration = Duration::from_secs(15 * 60);
const AUTH_ATTEMPTS: u32 = 30;
const MAX_RATE_KEYS: usize = 4096;

pub struct RateLimiter(Mutex<HashMap<IpAddr, (Instant, u32)>>);

pub fn client_ip(
    peer: IpAddr,
    headers: &HeaderMap,
    trusted: &[ipnet::IpNet],
) -> Result<IpAddr, ApiError> {
    let peer = match peer {
        IpAddr::V6(value) => value.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(peer),
        _ => peer,
    };
    if !trusted.iter().any(|network| network.contains(&peer)) {
        return Ok(peer);
    }
    let values = headers.get_all("x-real-ip");
    let mut values = values.iter();
    let Some(value) = values.next() else {
        return Ok(peer);
    };
    if values.next().is_some() {
        return Err(ApiError::validation(
            "La cabecera de cliente del proxy no es válida.",
        ));
    }
    value
        .to_str()
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| ApiError::validation("La cabecera de cliente del proxy no es válida."))
}
impl Default for RateLimiter {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}
impl RateLimiter {
    pub fn check(&self, ip: IpAddr) -> Result<(), ApiError> {
        let mut entries = self.0.lock().map_err(|_| ApiError::internal())?;
        entries.retain(|_, (created, _)| created.elapsed() < AUTH_WINDOW);
        if !entries.contains_key(&ip) && entries.len() >= MAX_RATE_KEYS {
            return Err(ApiError::rate_limited());
        }
        let entry = entries.entry(ip).or_insert((Instant::now(), 0));
        entry.1 = entry.1.saturating_add(1);
        if entry.1 > AUTH_ATTEMPTS {
            return Err(ApiError::rate_limited());
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct Auth {
    pub user_id: Uuid,
    pub session_hash: String,
    pub provenance: Provenance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provenance {
    Cookie,
    Bearer,
}

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        authenticate(state, &parts.headers).await
    }
}

pub fn random_token(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}
pub fn token_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub fn read_credentials(headers: &HeaderMap) -> Result<(String, Provenance), ApiError> {
    let mut authorization = headers.get_all(header::AUTHORIZATION).iter();
    let (token, provenance) = if let Some(header) = authorization.next() {
        if authorization.next().is_some() {
            return Err(ApiError::unauthorized());
        }
        (
            header
                .to_str()
                .ok()
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::to_owned),
            Provenance::Bearer,
        )
    } else {
        let mut cookies = headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok())
            .flat_map(|cookie| cookie.split(';'))
            .filter_map(|cookie| cookie.trim().strip_prefix("nuvex_session="))
            .map(str::to_owned);
        let token = cookies.next();
        if cookies.next().is_some() {
            return Err(ApiError::unauthorized());
        }
        (token, Provenance::Cookie)
    };
    let token = token.ok_or_else(ApiError::unauthorized)?;
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError::unauthorized());
    }
    Ok((token, provenance))
}

pub async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Auth, ApiError> {
    let (token, provenance) = read_credentials(headers)?;
    let session_hash = token_hash(&token);
    let user_id = sqlx::query_scalar(
        "SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    )
    .bind(&session_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    Ok(Auth {
        user_id,
        session_hash,
        provenance,
    })
}

pub async fn session_active(state: &AppState, auth: &Auth) -> Result<bool, ApiError> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now())")
        .bind(&auth.session_hash).bind(auth.user_id).fetch_one(&state.pool).await?)
}

pub fn validate_password(value: &str) -> Result<(), ApiError> {
    if !(12..=128).contains(&value.chars().count()) || value.len() > 512 {
        return Err(ApiError::validation(
            "La contraseña debe tener entre 12 y 128 caracteres.",
        ));
    }
    Ok(())
}
pub fn validate_email(value: &str) -> Result<String, ApiError> {
    let email = value.trim().to_ascii_lowercase();
    let parts: Vec<_> = email.split('@').collect();
    if !email.is_ascii()
        || email.len() > 254
        || email
            .bytes()
            .any(|c| c.is_ascii_whitespace() || c.is_ascii_control())
        || parts.len() != 2
        || parts[0].is_empty()
        || parts[0].len() > 64
        || !parts[1].contains('.')
        || parts[1].starts_with('.')
        || parts[1].ends_with('.')
    {
        return Err(ApiError::validation(
            "Escribe una dirección de correo válida.",
        ));
    }
    Ok(email)
}
pub fn validate_name(value: &str) -> Result<String, ApiError> {
    let name = value.trim();
    if !(1..=48).contains(&name.chars().count()) || name.chars().any(char::is_control) {
        return Err(ApiError::validation(
            "El nombre debe tener entre 1 y 48 caracteres, sin caracteres de control.",
        ));
    }
    Ok(name.to_owned())
}
fn validate_handle(value: &str) -> Result<String, ApiError> {
    let handle = value.trim().to_ascii_lowercase();
    if !(3..=32).contains(&handle.len())
        || !handle
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
    {
        return Err(ApiError::validation(
            "El identificador admite entre 3 y 32 letras ASCII, números y guiones bajos.",
        ));
    }
    Ok(handle)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    #[default]
    Cookie,
    Bearer,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterInput {
    email: String,
    password: String,
    display_name: String,
    handle: String,
    #[serde(default)]
    transport: Transport,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginInput {
    email: String,
    password: String,
    #[serde(default)]
    transport: Transport,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    user: User,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_token: Option<String>,
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::internal())
}

fn auth_response(
    state: &AppState,
    user: User,
    token: String,
    transport: Transport,
    status: StatusCode,
) -> Result<Response, ApiError> {
    let is_bearer = matches!(transport, Transport::Bearer);
    let cookie = format!(
        "nuvex_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_SECONDS}{}",
        if state.config.insecure_dev {
            ""
        } else {
            "; Secure"
        }
    );
    let mut response = (
        status,
        Json(AuthResponse {
            user,
            access_token: if is_bearer { Some(token) } else { None },
        }),
    )
        .into_response();
    if !is_bearer {
        response.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).map_err(|_| ApiError::internal())?,
        );
    }
    Ok(response)
}

pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    payload: Result<Json<RegisterInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    state.rate_limiter.check(client_ip(
        peer.ip(),
        &headers,
        &state.config.trusted_proxies,
    )?)?;
    if !state.config.registration_open {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "registration_closed",
            "El registro está cerrado en esta instancia.",
        ));
    }
    let input = error::json(payload)?;
    crate::request_security::login_transport(
        &state.config.allowed_origin,
        &headers,
        &input.transport,
    )?;
    let email = validate_email(&input.email)?;
    let handle = validate_handle(&input.handle)?;
    let name = validate_name(&input.display_name)?;
    validate_password(&input.password)?;
    let permit = state
        .password_workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::rate_limited())?;
    let password_hash = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        hash_password(&input.password)
    })
    .await
    .map_err(|_| ApiError::internal())??;
    let id = Uuid::new_v4();
    let token = random_token(32);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO users (id,email,handle,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(id)
    .bind(email)
    .bind(handle)
    .bind(name)
    .bind(password_hash)
    .execute(&mut *tx)
    .await;
    if let Err(error) = inserted {
        if error
            .as_database_error()
            .is_some_and(|error| error.is_unique_violation())
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "duplicate_email_or_handle",
                "El correo o identificador ya están registrados.",
            ));
        }
        return Err(error.into());
    }
    sqlx::query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    )
    .bind(token_hash(&token))
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    auth_response(
        &state,
        get_user(&state.pool, id).await?,
        token,
        input.transport,
        StatusCode::CREATED,
    )
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    payload: Result<Json<LoginInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    state.rate_limiter.check(client_ip(
        peer.ip(),
        &headers,
        &state.config.trusted_proxies,
    )?)?;
    let input = error::json(payload)?;
    crate::request_security::login_transport(
        &state.config.allowed_origin,
        &headers,
        &input.transport,
    )?;
    let email = validate_email(&input.email)?;
    validate_password(&input.password)?;
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id,password_hash FROM users WHERE email=$1")
            .bind(email)
            .fetch_optional(&state.pool)
            .await?;
    let (user_id, encoded) = row
        .map(|(id, encoded)| (Some(id), encoded))
        .unwrap_or((None, state.dummy_password_hash.to_string()));
    let permit = state
        .password_workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::rate_limited())?;
    let verified = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        PasswordHash::new(&encoded).ok().is_some_and(|hash| {
            Argon2::default()
                .verify_password(input.password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .map_err(|_| ApiError::internal())?;
    if !verified || user_id.is_none() {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "El correo o la contraseña no son correctos.",
        ));
    }
    let user_id = user_id.ok_or_else(ApiError::unauthorized)?;
    let token = random_token(32);
    let mut tx = state.pool.begin().await?;
    // Concurrent logins for one account must observe one shared session inventory.
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1 AND expires_at<=now()")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    // Keep a finite session inventory per account, preserving the newest 19 before inserting.
    sqlx::query("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET 19)").bind(user_id).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    )
    .bind(token_hash(&token))
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    auth_response(
        &state,
        get_user(&state.pool, user_id).await?,
        token,
        input.transport,
        StatusCode::OK,
    )
}

pub async fn logout(State(state): State<AppState>, auth: Auth) -> Result<Response, ApiError> {
    sqlx::query("DELETE FROM sessions WHERE token_hash=$1")
        .bind(&auth.session_hash)
        .execute(&state.pool)
        .await?;
    crate::voice::remove_session(&state, &auth.session_hash, "logout").await;
    state
        .tickets
        .lock()
        .map_err(|_| ApiError::internal())?
        .retain(|_, ticket| ticket.auth.session_hash != auth.session_hash);
    let mut response = StatusCode::NO_CONTENT.into_response();
    if auth.provenance == Provenance::Cookie {
        response.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&format!(
                "nuvex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{}",
                if state.config.insecure_dev {
                    ""
                } else {
                    "; Secure"
                }
            ))
            .map_err(|_| ApiError::internal())?,
        );
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn forwarded_client_ip_requires_a_trusted_peer_and_one_valid_header() {
        let peer: IpAddr = "127.0.0.1".parse().unwrap();
        let trusted = crate::config::parse_trusted_proxies("127.0.0.1/32").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.42"));
        assert_eq!(client_ip(peer, &headers, &[]).unwrap(), peer);
        assert_eq!(
            client_ip(peer, &headers, &trusted).unwrap(),
            "198.51.100.42".parse::<IpAddr>().unwrap()
        );
        headers.insert(
            "x-real-ip",
            HeaderValue::from_static("198.51.100.42, 203.0.113.1"),
        );
        assert!(client_ip(peer, &headers, &trusted).is_err());
        headers.clear();
        headers.insert("x-forwarded-for", HeaderValue::from_static("198.51.100.42"));
        assert_eq!(client_ip(peer, &headers, &trusted).unwrap(), peer);
        headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.42"));
        headers.append("x-real-ip", HeaderValue::from_static("203.0.113.1"));
        assert!(client_ip(peer, &headers, &trusted).is_err());
    }
    #[test]
    fn passwords_have_strict_bounds() {
        assert!(validate_password(&"a".repeat(12)).is_ok());
        assert!(validate_password(&"a".repeat(128)).is_ok());
        assert!(validate_password(&"a".repeat(11)).is_err());
        assert!(validate_password(&"a".repeat(129)).is_err());
    }
    #[test]
    fn account_fields_are_validated_and_normalized() {
        assert_eq!(
            validate_email(" PABLO@example.org ").unwrap(),
            "pablo@example.org"
        );
        for value in [
            "invalid",
            "x@",
            "@example.org",
            "x@y@z.org",
            "x@domain",
            "a b@example.org",
        ] {
            assert!(validate_email(value).is_err());
        }
        assert_eq!(validate_handle(" Pablo_1 ").unwrap(), "pablo_1");
        assert!(validate_handle("owner<script>").is_err());
        assert!(validate_name("\n").is_err());
    }
    #[test]
    fn token_storage_is_hashed_and_tokens_are_distinct() {
        let first = random_token(32);
        let second = random_token(32);
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
        assert_ne!(first, token_hash(&first));
        assert_eq!(token_hash(&first).len(), 64);
    }
    #[test]
    fn rate_limit_is_enforced() {
        let limiter = RateLimiter::default();
        for _ in 0..AUTH_ATTEMPTS {
            assert!(limiter.check(IpAddr::from([127, 0, 0, 1])).is_ok());
        }
        assert!(limiter.check(IpAddr::from([127, 0, 0, 1])).is_err());
    }
    #[test]
    fn duplicate_cookies_and_malformed_bearers_are_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!(
                "nuvex_session={}; nuvex_session={}",
                "a".repeat(64),
                "b".repeat(64)
            ))
            .unwrap(),
        );
        assert!(read_credentials(&headers).is_err());
        headers.clear();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer invalid"),
        );
        assert!(read_credentials(&headers).is_err());
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", "a".repeat(64))).unwrap(),
        );
        assert_eq!(read_credentials(&headers).unwrap().1, Provenance::Bearer);
        headers.append(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", "b".repeat(64))).unwrap(),
        );
        assert!(read_credentials(&headers).is_err());
    }
}
