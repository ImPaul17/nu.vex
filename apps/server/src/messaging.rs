use crate::{
    auth::Auth,
    error::{self, ApiError},
    realtime::Event,
    AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Default)]
pub struct MessageRateLimiter(Mutex<HashMap<Uuid, (Instant, u32)>>);
impl MessageRateLimiter {
    pub fn check(&self, user_id: Uuid) -> Result<(), ApiError> {
        let mut entries = self.0.lock().map_err(|_| ApiError::internal())?;
        entries.retain(|_, (created, _)| created.elapsed() < Duration::from_secs(60));
        if !entries.contains_key(&user_id) && entries.len() >= 4096 {
            return Err(ApiError::rate_limited());
        }
        let entry = entries.entry(user_id).or_insert((Instant::now(), 0));
        entry.1 = entry.1.saturating_add(1);
        if entry.1 > 120 {
            return Err(ApiError::rate_limited());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Serialize)]
pub struct MessageResponse {
    message: Message,
}
#[derive(Serialize)]
pub struct HistoryResponse {
    messages: Vec<Message>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendInput {
    content: String,
    client_id: Uuid,
}
#[derive(Deserialize)]
pub struct HistoryQuery {
    before: Option<String>,
    limit: Option<u32>,
}

pub fn validate_content(content: &str) -> Result<String, ApiError> {
    let content = content.trim();
    if content.is_empty() || content.encode_utf16().count() > 4000 || content.contains('\0') {
        return Err(ApiError::validation(
            "El mensaje debe tener entre 1 y 4000 caracteres y no incluir caracteres nulos.",
        ));
    }
    Ok(content.to_owned())
}

async fn channel_member(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<Uuid, ApiError> {
    sqlx::query_scalar("SELECT c.community_id FROM channels c JOIN community_members m ON m.community_id=c.community_id WHERE c.id=$1 AND m.user_id=$2").bind(channel_id).bind(user_id).fetch_optional(pool).await?.ok_or_else(ApiError::forbidden)
}

pub async fn history(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<HistoryResponse>, ApiError> {
    let id = error::uuid(&id)?;
    channel_member(&state.pool, auth.user_id, id).await?;
    let Query(query) =
        query.map_err(|_| ApiError::validation("Los parámetros de historial no son válidos."))?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(ApiError::validation(
            "El límite de historial debe estar entre 1 y 100.",
        ));
    }
    let mut messages: Vec<Message> = if let Some(before) = query.before {
        let before = error::uuid(&before)?;
        let cursor: Option<(DateTime<Utc>, Uuid)> =
            sqlx::query_as("SELECT created_at,id FROM messages WHERE id=$1 AND channel_id=$2")
                .bind(before)
                .bind(id)
                .fetch_optional(&state.pool)
                .await?;
        let (created_at, cursor_id) = cursor.ok_or_else(ApiError::not_found)?;
        sqlx::query_as("SELECT id,channel_id,author_id,content,created_at FROM messages WHERE channel_id=$1 AND deleted_at IS NULL AND (created_at,id)<($2,$3) ORDER BY created_at DESC,id DESC LIMIT $4").bind(id).bind(created_at).bind(cursor_id).bind(i64::from(limit)).fetch_all(&state.pool).await?
    } else {
        sqlx::query_as("SELECT id,channel_id,author_id,content,created_at FROM messages WHERE channel_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $2").bind(id).bind(i64::from(limit)).fetch_all(&state.pool).await?
    };
    messages.reverse();
    Ok(Json(HistoryResponse { messages }))
}

pub async fn send(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<SendInput>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<MessageResponse>), ApiError> {
    state.message_limiter.check(auth.user_id)?;
    let id = error::uuid(&id)?;
    let input = error::json(payload)?;
    let content = validate_content(&input.content)?;
    let mut tx = state.pool.begin().await?;
    // The membership row is held until commit, ordering writes against revocation.
    let community_id:Uuid=sqlx::query_scalar("SELECT c.community_id FROM channels c JOIN community_members m ON m.community_id=c.community_id WHERE c.id=$1 AND m.user_id=$2 FOR SHARE OF m").bind(id).bind(auth.user_id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::forbidden)?;
    let inserted:Option<Message>=sqlx::query_as("INSERT INTO messages(id,channel_id,author_id,client_id,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(author_id,client_id) DO NOTHING RETURNING id,channel_id,author_id,content,created_at").bind(Uuid::new_v4()).bind(id).bind(auth.user_id).bind(input.client_id).bind(&content).fetch_optional(&mut *tx).await?;
    let created = inserted.is_some();
    let message = if let Some(message) = inserted {
        message
    } else {
        let deleted: bool = sqlx::query_scalar(
            "SELECT deleted_at IS NOT NULL FROM messages WHERE author_id=$1 AND client_id=$2",
        )
        .bind(auth.user_id)
        .bind(input.client_id)
        .fetch_one(&mut *tx)
        .await?;
        if deleted {
            return Err(ApiError::new(
                StatusCode::GONE,
                "message_deleted",
                "Este envío corresponde a un mensaje eliminado.",
            ));
        }
        let existing:Message=sqlx::query_as("SELECT id,channel_id,author_id,content,created_at FROM messages WHERE author_id=$1 AND client_id=$2").bind(auth.user_id).bind(input.client_id).fetch_one(&mut *tx).await?;
        if existing.channel_id != id || existing.content != content {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "idempotency_conflict",
                "Este identificador de envío ya se utilizó para otro mensaje.",
            ));
        }
        existing
    };
    tx.commit().await?;
    if created {
        let _ = state.events.send(Event {
            community_id,
            payload: serde_json::json!({"type":"message.created","message":message}),
            removed_user: None,
        });
    }
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(MessageResponse { message }),
    ))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: Auth,
    Path((channel_id, message_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let channel_id = error::uuid(&channel_id)?;
    let message_id = error::uuid(&message_id)?;
    let mut tx = state.pool.begin().await?;
    let community_id:Uuid=sqlx::query_scalar("SELECT c.community_id FROM channels c JOIN community_members m ON m.community_id=c.community_id WHERE c.id=$1 AND m.user_id=$2 FOR SHARE OF m").bind(channel_id).bind(auth.user_id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::forbidden)?;
    let author: Uuid =
        sqlx::query_scalar("SELECT author_id FROM messages WHERE id=$1 AND channel_id=$2")
            .bind(message_id)
            .bind(channel_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(ApiError::not_found)?;
    if author != auth.user_id {
        return Err(ApiError::forbidden());
    }
    // Erase user content while retaining the idempotency key so a network retry cannot resurrect it.
    let deleted=sqlx::query("UPDATE messages SET content='[deleted]',deleted_at=clock_timestamp() WHERE id=$1 AND channel_id=$2 AND author_id=$3 AND deleted_at IS NULL").bind(message_id).bind(channel_id).bind(auth.user_id).execute(&mut *tx).await?.rows_affected()>0;
    tx.commit().await?;
    if deleted {
        let _=state.events.send(Event{community_id,payload:serde_json::json!({"type":"message.deleted","channelId":channel_id,"messageId":message_id}),removed_user:None});
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::validate_content;
    #[test]
    fn message_rate_quota_blocks_one_sender_without_blocking_others() {
        let limiter = super::MessageRateLimiter::default();
        let user = uuid::Uuid::new_v4();
        for _ in 0..120 {
            assert!(limiter.check(user).is_ok());
        }
        assert!(limiter.check(user).is_err());
        assert!(limiter.check(uuid::Uuid::new_v4()).is_ok());
    }
    #[test]
    fn message_limits_match_browser_utf16() {
        assert_eq!(
            validate_content("  hola\n mundo  ").unwrap(),
            "hola\n mundo"
        );
        assert!(validate_content(&"a".repeat(4000)).is_ok());
        assert!(validate_content(&"a".repeat(4001)).is_err());
        assert!(validate_content(&"🌱".repeat(2000)).is_ok());
        assert!(validate_content(&"🌱".repeat(2001)).is_err());
        assert!(validate_content(" \n ").is_err());
        assert!(validate_content("bad\0text").is_err());
    }
}
