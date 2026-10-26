use crate::{
    account::{self, User},
    auth::{self, Auth},
    error::{self, ApiError},
    AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub community_id: Uuid,
    pub name: String,
    pub kind: String,
    pub category: String,
    pub description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Community {
    pub id: Uuid,
    pub name: String,
    pub initials: String,
    pub color: String,
    pub description: String,
    pub channels: Vec<Channel>,
}

#[derive(FromRow)]
struct CommunityRow {
    id: Uuid,
    name: String,
    color: String,
    description: String,
}
impl CommunityRow {
    fn with_channels(self, channels: Vec<Channel>) -> Community {
        Community {
            id: self.id,
            initials: account::initials(&self.name),
            name: self.name,
            color: self.color,
            description: self.description,
            channels,
        }
    }
}

pub async fn require_member(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    community_id: Uuid,
) -> Result<(), ApiError> {
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2)",
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if !member {
        return Err(ApiError::forbidden());
    }
    Ok(())
}

pub async fn require_owner(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    community_id: Uuid,
) -> Result<(), ApiError> {
    let owner: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM communities WHERE id=$1 AND owner_id=$2)")
            .bind(community_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    if !owner {
        return Err(ApiError::forbidden());
    }
    Ok(())
}

async fn load_community(
    pool: &sqlx::PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Community, ApiError> {
    require_member(pool, user_id, id).await?;
    let row: CommunityRow =
        sqlx::query_as("SELECT id,name,color,description FROM communities WHERE id=$1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(ApiError::not_found)?;
    let channels = sqlx::query_as("SELECT id,community_id,name,kind,category,description FROM channels WHERE community_id=$1 ORDER BY created_at,id").bind(id).fetch_all(pool).await?;
    Ok(row.with_channels(channels))
}

#[derive(Serialize)]
pub struct Bootstrap {
    user: User,
    communities: Vec<Community>,
    members: Vec<User>,
}

pub async fn bootstrap(
    State(state): State<AppState>,
    auth: Auth,
) -> Result<Json<Bootstrap>, ApiError> {
    let user = account::get_user(&state.pool, auth.user_id).await?;
    let rows: Vec<CommunityRow> = sqlx::query_as("SELECT c.id,c.name,c.color,c.description FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at,c.id").bind(auth.user_id).fetch_all(&state.pool).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let channels: Vec<Channel> = sqlx::query_as("SELECT id,community_id,name,kind,category,description FROM channels WHERE community_id=ANY($1) ORDER BY created_at,id").bind(&ids).fetch_all(&state.pool).await?;
    let communities = rows
        .into_iter()
        .map(|row| {
            let id = row.id;
            row.with_channels(
                channels
                    .iter()
                    .filter(|channel| channel.community_id == id)
                    .cloned()
                    .collect(),
            )
        })
        .collect();
    let mut members: Vec<User> = sqlx::query_as("SELECT u.id,u.display_name AS name,u.handle,'' AS initials,u.color,CASE WHEN EXISTS (SELECT 1 FROM communities c WHERE c.owner_id=u.id AND c.id=ANY($2)) THEN 'owner' ELSE 'member' END AS role,CASE WHEN u.id=$1 THEN 'online' ELSE 'offline' END AS status,u.bio,NULL::text AS email FROM users u WHERE u.id=$1 OR EXISTS (SELECT 1 FROM community_members m WHERE m.user_id=u.id AND m.community_id=ANY($2)) ORDER BY u.display_name,u.id").bind(auth.user_id).bind(&ids).fetch_all(&state.pool).await?;
    for member in &mut members {
        member.initials = account::initials(&member.name);
    }
    Ok(Json(Bootstrap {
        user,
        communities,
        members,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameInput {
    name: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChannelInput {
    name: String,
    #[serde(default)]
    kind: ChannelKind,
}
#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    #[default]
    Text,
    Voice,
}
impl ChannelKind {
    fn value(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Voice => "voice",
        }
    }
    fn category(self) -> &'static str {
        match self {
            Self::Text => "COMUNIDAD",
            Self::Voice => "VOZ",
        }
    }
}
#[derive(Serialize)]
pub struct CommunityResponse {
    community: Community,
}
#[derive(Serialize)]
pub struct ChannelResponse {
    channel: Channel,
}
#[derive(Serialize)]
pub struct InviteResponse {
    code: String,
}

pub async fn create_community(
    State(state): State<AppState>,
    auth: Auth,
    payload: Result<Json<NameInput>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<CommunityResponse>), ApiError> {
    let name = auth::validate_name(&error::json(payload)?.name)?;
    let mut tx = state.pool.begin().await?;
    // Serialize per-account creation before enforcing the finite community inventory.
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM communities WHERE owner_id=$1")
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 100 {
        return Err(ApiError::validation(
            "Puedes crear hasta 100 comunidades por cuenta en este MVP.",
        ));
    }
    let id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO communities(id,name,owner_id,description) VALUES($1,$2,$3,'Una comunidad independiente en nu.vex.')").bind(id).bind(name).bind(auth.user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO community_members(community_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO channels(id,community_id,name,description) VALUES($1,$2,'general','Todo empieza con una conversación.')").bind(channel_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(CommunityResponse {
            community: load_community(&state.pool, id, auth.user_id).await?,
        }),
    ))
}

pub fn channel_name(value: &str) -> Result<String, ApiError> {
    let name = value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    if !(1..=40).contains(&name.chars().count())
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::validation(
            "El canal admite entre 1 y 40 letras, números, guiones y guiones bajos.",
        ));
    }
    Ok(name)
}

pub async fn create_channel(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<ChannelInput>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<ChannelResponse>), ApiError> {
    let id = error::uuid(&id)?;
    let input = error::json(payload)?;
    let name = channel_name(&input.name)?;
    require_owner(&state.pool, auth.user_id, id).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM communities WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM channels WHERE community_id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 200 {
        return Err(ApiError::validation(
            "La comunidad admite hasta 200 canales en este MVP.",
        ));
    }
    let inserted=sqlx::query_as("INSERT INTO channels(id,community_id,name,kind,category) VALUES($1,$2,$3,$4,$5) RETURNING id,community_id,name,kind,category,description").bind(Uuid::new_v4()).bind(id).bind(name).bind(input.kind.value()).bind(input.kind.category()).fetch_one(&mut *tx).await;
    let channel = match inserted {
        Ok(channel) => channel,
        Err(error)
            if error
                .as_database_error()
                .is_some_and(|error| error.is_unique_violation()) =>
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "duplicate_channel",
                "Ya existe un canal con ese nombre.",
            ))
        }
        Err(error) => return Err(error.into()),
    };
    tx.commit().await?;
    let _ = state
        .events
        .send(crate::realtime::Event::workspace(id, None));
    Ok((StatusCode::CREATED, Json(ChannelResponse { channel })))
}

pub async fn create_invite(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<InviteResponse>), ApiError> {
    let id = error::uuid(&id)?;
    require_owner(&state.pool, auth.user_id, id).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM communities WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM invites WHERE community_id=$1 AND expires_at<=now()")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM invites WHERE community_id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 20 {
        return Err(ApiError::rate_limited());
    }
    let code = auth::random_token(16);
    sqlx::query("INSERT INTO invites(code_hash,community_id,created_by,expires_at) VALUES($1,$2,$3,now()+interval '7 days')").bind(auth::token_hash(&code)).bind(id).bind(auth.user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(InviteResponse { code })))
}

pub async fn join_invite(
    State(state): State<AppState>,
    auth: Auth,
    Path(code): Path<String>,
) -> Result<Json<CommunityResponse>, ApiError> {
    if code.len() != 32 || !code.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::validation(
            "El código de invitación no es válido.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "SELECT community_id FROM invites WHERE code_hash=$1 AND expires_at>now() FOR SHARE",
    )
    .bind(auth::token_hash(&code))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let joined=sqlx::query("INSERT INTO community_members(community_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING").bind(id).bind(auth.user_id).execute(&mut *tx).await?.rows_affected()>0;
    tx.commit().await?;
    if joined {
        let _ = state
            .events
            .send(crate::realtime::Event::workspace(id, None));
    }
    Ok(Json(CommunityResponse {
        community: load_community(&state.pool, id, auth.user_id).await?,
    }))
}

pub async fn remove_member(
    State(state): State<AppState>,
    auth: Auth,
    Path((community_id, user_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let community_id = error::uuid(&community_id)?;
    let user_id = error::uuid(&user_id)?;
    require_owner(&state.pool, auth.user_id, community_id).await?;
    if user_id == auth.user_id {
        return Err(ApiError::validation(
            "El propietario no puede eliminarse de su comunidad.",
        ));
    }
    let removed = sqlx::query("DELETE FROM community_members WHERE community_id=$1 AND user_id=$2")
        .bind(community_id)
        .bind(user_id)
        .execute(&state.pool)
        .await?
        .rows_affected()
        > 0;
    if removed {
        crate::voice::remove_member(&state, user_id, community_id).await;
        let _ = state.events.send(crate::realtime::Event::workspace(
            community_id,
            Some(user_id),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::channel_name;
    #[test]
    fn channel_names_are_bounded_and_plain_text() {
        assert_eq!(channel_name(" Ideas y Café ").unwrap(), "ideas-y-café");
        for name in ["", " ", "<script>", "hello.world"] {
            assert!(channel_name(name).is_err());
        }
        assert!(channel_name(&"a".repeat(41)).is_err());
    }
}
