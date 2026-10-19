use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}
#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
}

impl ApiError {
    pub const fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }
    pub const fn validation(message: &'static str) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "validation_error", message)
    }
    pub const fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "Inicia sesión para continuar.",
        )
    }
    pub const fn forbidden() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "No tienes permiso para esta acción.",
        )
    }
    pub const fn not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "No se encontró este recurso.",
        )
    }
    pub const fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "No se pudo completar la solicitud.",
        )
    }
    pub const fn rate_limited() -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Demasiados intentos. Vuelve a intentarlo más tarde.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

pub fn normalize_response(response: Response) -> Response {
    let status = response.status();
    let json = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if (!status.is_client_error() && !status.is_server_error()) || json {
        return response;
    }
    let allow = response.headers().get(axum::http::header::ALLOW).cloned();
    let mut normalized = ApiError::new(
        status,
        "request_error",
        "La solicitud no es válida para este endpoint.",
    )
    .into_response();
    if let Some(allow) = allow {
        normalized
            .headers_mut()
            .insert(axum::http::header::ALLOW, allow);
    }
    normalized
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        // Never return SQL, database connection details or values to an HTTP client.
        tracing::error!(kind = "database", error = %error, "Database operation failed");
        Self::internal()
    }
}

pub fn json<T>(
    payload: Result<Json<T>, axum::extract::rejection::JsonRejection>,
) -> Result<T, ApiError> {
    payload.map(|Json(value)| value).map_err(|_| {
        ApiError::validation("El cuerpo debe ser JSON válido y respetar el formato del endpoint.")
    })
}

pub fn uuid(value: &str) -> Result<uuid::Uuid, ApiError> {
    uuid::Uuid::parse_str(value)
        .map_err(|_| ApiError::validation("El identificador debe ser un UUID válido."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn framework_errors_preserve_status_and_allow_with_json_envelope() {
        let response = (
            StatusCode::METHOD_NOT_ALLOWED,
            [(axum::http::header::ALLOW, "POST")],
            "Method not allowed",
        )
            .into_response();
        let response = normalize_response(response);
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers()[axum::http::header::ALLOW], "POST");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error"]["code"], "request_error");
    }
}
