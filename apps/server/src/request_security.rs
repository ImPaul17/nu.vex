use crate::{auth, error::ApiError};
use axum::http::{header, HeaderMap, StatusCode};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestOrigin {
    Browser,
    Absent,
}

pub fn origin_error() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "origin_not_allowed",
        "El origen de esta solicitud no está autorizado.",
    )
}

pub fn origin(allowed: &str, headers: &HeaderMap) -> Result<RequestOrigin, ApiError> {
    let mut origins = headers.get_all(header::ORIGIN).iter();
    let Some(value) = origins.next() else {
        return Ok(RequestOrigin::Absent);
    };
    // An opaque, empty, malformed or duplicated Origin is never an absent Origin.
    if origins.next().is_some() || value.to_str().ok() != Some(allowed) {
        return Err(origin_error());
    }
    Ok(RequestOrigin::Browser)
}

pub fn without_cookies(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers.contains_key(header::COOKIE) {
        return Err(origin_error());
    }
    Ok(())
}

pub fn originless_bearer(headers: &HeaderMap) -> Result<(), ApiError> {
    without_cookies(headers)?;
    if auth::read_credentials(headers)?.1 != auth::Provenance::Bearer {
        return Err(origin_error());
    }
    Ok(())
}

pub fn unsafe_request(allowed: &str, path: &str, headers: &HeaderMap) -> Result<(), ApiError> {
    if origin(allowed, headers)? == RequestOrigin::Browser {
        return Ok(());
    }
    without_cookies(headers)?;
    if matches!(
        path,
        "/auth/register" | "/auth/login" | "/api/v1/auth/register" | "/api/v1/auth/login"
    ) {
        // The auth handler must additionally validate JSON and explicit bearer transport
        // before looking up credentials, hashing passwords or creating a session.
        return Ok(());
    }
    // Authentication and permissions remain mandatory in each endpoint's Auth extractor.
    originless_bearer(headers)
}

pub fn login_transport(
    allowed: &str,
    headers: &HeaderMap,
    transport: &auth::Transport,
) -> Result<(), ApiError> {
    if origin(allowed, headers)? == RequestOrigin::Absent {
        without_cookies(headers)?;
        if !matches!(transport, auth::Transport::Bearer) {
            return Err(origin_error());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const ALLOWED: &str = "https://chat.example.test";

    #[test]
    fn only_a_truly_absent_origin_can_use_native_transport() {
        let mut headers = HeaderMap::new();
        assert_eq!(origin(ALLOWED, &headers).unwrap(), RequestOrigin::Absent);
        headers.insert(header::ORIGIN, HeaderValue::from_static(ALLOWED));
        assert_eq!(origin(ALLOWED, &headers).unwrap(), RequestOrigin::Browser);
        headers.append(header::ORIGIN, HeaderValue::from_static(ALLOWED));
        assert!(origin(ALLOWED, &headers).is_err());
        for value in [
            "",
            "null",
            "https://other.example.test",
            "https://chat.example.test, https://chat.example.test",
        ] {
            headers.insert(header::ORIGIN, HeaderValue::from_str(value).unwrap());
            assert!(origin(ALLOWED, &headers).is_err());
        }
        headers.insert(header::ORIGIN, HeaderValue::from_bytes(&[0xff]).unwrap());
        assert!(origin(ALLOWED, &headers).is_err());
    }

    #[test]
    fn native_mutations_never_accept_ambient_cookies_or_missing_bearers() {
        let mut headers = HeaderMap::new();
        assert!(unsafe_request(ALLOWED, "/communities", &headers).is_err());
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", "a".repeat(64))).unwrap(),
        );
        assert!(unsafe_request(ALLOWED, "/communities", &headers).is_ok());
        headers.insert(header::COOKIE, HeaderValue::from_static(""));
        assert!(unsafe_request(ALLOWED, "/communities", &headers).is_err());
        assert!(unsafe_request(ALLOWED, "/auth/login", &headers).is_err());
    }

    #[test]
    fn native_auth_requires_explicit_bearer_transport() {
        let headers = HeaderMap::new();
        assert!(unsafe_request(ALLOWED, "/auth/login", &headers).is_ok());
        assert!(login_transport(ALLOWED, &headers, &auth::Transport::Cookie).is_err());
        assert!(login_transport(ALLOWED, &headers, &auth::Transport::Bearer).is_ok());
    }
}
