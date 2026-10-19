use crate::{auth::Auth, error::ApiError, AppState};
use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Serialize, Clone, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub name: String,
    pub handle: String,
    pub initials: String,
    pub color: String,
    pub role: String,
    pub status: String,
    pub bio: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

pub fn initials(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .flat_map(char::to_uppercase)
        .collect()
}

pub async fn get_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<User, ApiError> {
    let mut user: User = sqlx::query_as("SELECT id, display_name AS name, handle, '' AS initials, color, CASE WHEN EXISTS (SELECT 1 FROM communities WHERE owner_id = users.id) THEN 'owner' ELSE 'member' END AS role, 'online' AS status, bio, email FROM users WHERE id = $1")
        .bind(user_id).fetch_optional(pool).await?.ok_or_else(ApiError::unauthorized)?;
    user.initials = initials(&user.name);
    Ok(user)
}

#[derive(Serialize)]
pub struct UserResponse {
    pub user: User,
}

pub async fn me(State(state): State<AppState>, auth: Auth) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(UserResponse {
        user: get_user(&state.pool, auth.user_id).await?,
    }))
}
