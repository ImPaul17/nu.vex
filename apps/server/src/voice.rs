//! Voz efímera: señalización autenticada; el audio viaja entre clientes WebRTC.
use crate::{
    auth::{self, Auth},
    error::{self, ApiError},
    realtime::Event,
    AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const MAX_PARTICIPANTS: usize = 8;
const MAX_GLOBAL_PARTICIPANTS: usize = 256;
const TTL: Duration = Duration::from_secs(45);
const RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(untagged)]
pub enum IceUrls {
    One(String),
    Many(Vec<String>),
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IceServer {
    urls: IceUrls,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_type: Option<String>,
}

fn valid_ice_url(value: &str) -> bool {
    if value.len() > 512
        || !value.is_ascii()
        || value
            .bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
    {
        return false;
    }
    let Some((scheme, authority)) = value.split_once(':') else {
        return false;
    };
    if !matches!(scheme, "stun" | "stuns" | "turn" | "turns") {
        return false;
    }
    let (authority, query) = authority
        .split_once('?')
        .map_or((authority, None), |(a, q)| (a, Some(q)));
    if query.is_some_and(|q| {
        !matches!(scheme, "turn" | "turns") || !matches!(q, "transport=udp" | "transport=tcp")
    }) || authority.contains(['/', '@', '#', '\\'])
    {
        return false;
    }
    let (host, port) = if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return false;
        };
        if authority[1..end].parse::<std::net::Ipv6Addr>().is_err() {
            return false;
        }
        let suffix = &authority[end + 1..];
        if suffix.is_empty() {
            (&authority[..=end], None)
        } else if let Some(port) = suffix.strip_prefix(':') {
            (&authority[..=end], Some(port))
        } else {
            return false;
        }
    } else {
        let (host, port) = authority
            .split_once(':')
            .map_or((authority, None), |(h, p)| (h, Some(p)));
        if host.is_empty()
            || host.len() > 253
            || !host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
        {
            return false;
        }
        (host, port)
    };
    !host.is_empty() && port.is_none_or(|port| port.parse::<u16>().is_ok_and(|number| number > 0))
}

pub fn parse_ice_servers(json: Option<&str>) -> Result<Vec<IceServer>, String> {
    let json = json.map(str::trim).filter(|value| !value.is_empty());
    let Some(json) = json else {
        return Ok(vec![IceServer {
            urls: IceUrls::One("stun:stun.cloudflare.com:3478".into()),
            username: None,
            credential: None,
            credential_type: None,
        }]);
    };
    let invalid = || {
        "NUVEX_VOICE_ICE_SERVERS debe contener JSON válido con hasta ocho servidores STUN/TURN y campos admitidos; no se muestra su contenido.".to_owned()
    };
    if json.len() > 16_384 {
        return Err(invalid());
    }
    let servers: Vec<IceServer> = serde_json::from_str(json).map_err(|_| invalid())?;
    if servers.len() > 8 {
        return Err(invalid());
    }
    let mut total_urls = 0;
    for server in &servers {
        let urls: Vec<&str> = match &server.urls {
            IceUrls::One(url) => vec![url],
            IceUrls::Many(urls) => urls.iter().map(String::as_str).collect(),
        };
        total_urls += urls.len();
        let valid_field = |value: &Option<String>, max: usize| {
            value
                .as_ref()
                .is_none_or(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        };
        if urls.is_empty()
            || urls.len() > 8
            || total_urls > 32
            || !urls.iter().all(|u| valid_ice_url(u))
            || !valid_field(&server.username, 256)
            || !valid_field(&server.credential, 1024)
            || server
                .credential_type
                .as_deref()
                .is_some_and(|v| v != "password")
            || server.username.is_some() != server.credential.is_some()
            || (urls
                .iter()
                .any(|url| url.starts_with("turn:") || url.starts_with("turns:"))
                && server.credential.is_none())
        {
            return Err(invalid());
        }
    }
    Ok(servers)
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    id: Uuid,
    user_id: Uuid,
    display_name: String,
    muted: bool,
    deafened: bool,
}

#[derive(Clone)]
struct Counter {
    started: Instant,
    count: u32,
}
impl Counter {
    fn charge(&mut self, now: Instant, max: u32) -> Result<(), ApiError> {
        if now.saturating_duration_since(self.started) >= RATE_WINDOW {
            self.started = now;
            self.count = 0;
        }
        if self.count >= max {
            return Err(ApiError::rate_limited());
        }
        self.count += 1;
        Ok(())
    }
}
fn charge(counter: &mut Option<Counter>, now: Instant, max: u32) -> Result<(), ApiError> {
    counter
        .get_or_insert(Counter {
            started: now,
            count: 0,
        })
        .charge(now, max)
}

// No implementa Serialize: los hashes de sesión nunca forman parte del contrato público.
#[derive(Clone)]
struct Entry {
    public: Participant,
    channel_id: Uuid,
    community_id: Uuid,
    session_hash: String,
    last_seen: Instant,
    signals: Counter,
}

#[derive(Default)]
pub struct Registry {
    entries: HashMap<Uuid, Entry>,
    roster_revision: AtomicU64,
    requests: HashMap<Uuid, Counter>,
    global_requests: Option<Counter>,
    global_signals: Option<Counter>,
    global_controls: Option<Counter>,
}

fn ended() -> ApiError {
    ApiError::new(
        StatusCode::GONE,
        "voice_ended",
        "La llamada ha terminado. Vuelve a entrar al canal de voz.",
    )
}
impl Registry {
    fn request(&mut self, user: Uuid, now: Instant) -> Result<(), ApiError> {
        self.requests
            .retain(|_, counter| now.saturating_duration_since(counter.started) < RATE_WINDOW);
        if !self.requests.contains_key(&user) && self.requests.len() >= 4096 {
            return Err(ApiError::rate_limited());
        }
        charge(&mut self.global_requests, now, 8192)?;
        self.requests
            .entry(user)
            .or_insert(Counter {
                started: now,
                count: 0,
            })
            .charge(now, 600)
    }
    fn roster(&self, channel: Uuid) -> Vec<Participant> {
        let mut participants: Vec<_> = self
            .entries
            .values()
            .filter(|entry| entry.channel_id == channel)
            .map(|entry| entry.public.clone())
            .collect();
        participants.sort_by_key(|p| p.id);
        participants
    }
    fn owned(&self, auth: &Auth, channel: Uuid, participant: Uuid) -> Result<&Entry, ApiError> {
        let entry = self.entries.get(&participant).ok_or_else(ended)?;
        if entry.public.user_id != auth.user_id
            || entry.session_hash != auth.session_hash
            || entry.channel_id != channel
        {
            return Err(ApiError::forbidden());
        }
        Ok(entry)
    }
    fn join(
        &mut self,
        auth: &Auth,
        channel: Uuid,
        community: Uuid,
        name: String,
        now: Instant,
    ) -> Result<(Participant, Option<Entry>), ApiError> {
        let previous = self
            .entries
            .values()
            .find(|entry| entry.public.user_id == auth.user_id)
            .cloned();
        if let Some(existing) = &previous {
            if existing.session_hash != auth.session_hash {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "voice_already_joined",
                    "Esta cuenta ya está en una llamada. Sal de ella antes de entrar en otra.",
                ));
            }
        }
        let replacing = usize::from(previous.is_some());
        let replacing_here = usize::from(
            previous
                .as_ref()
                .is_some_and(|entry| entry.channel_id == channel),
        );
        if self.entries.len() - replacing >= MAX_GLOBAL_PARTICIPANTS
            || self.roster(channel).len() - replacing_here >= MAX_PARTICIPANTS
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "voice_full",
                "No hay plazas disponibles en esta llamada de voz.",
            ));
        }
        charge(&mut self.global_controls, now, 2048)?;
        if let Some(previous) = &previous {
            self.entries.remove(&previous.public.id);
        }
        let public = Participant {
            id: Uuid::new_v4(),
            user_id: auth.user_id,
            display_name: name,
            muted: false,
            deafened: false,
        };
        self.entries.insert(
            public.id,
            Entry {
                public: public.clone(),
                channel_id: channel,
                community_id: community,
                session_hash: auth.session_hash.clone(),
                last_seen: now,
                signals: Counter {
                    started: now,
                    count: 0,
                },
            },
        );
        Ok((public, previous))
    }
    fn set_state(
        &mut self,
        auth: &Auth,
        channel: Uuid,
        id: Uuid,
        muted: bool,
        deafened: bool,
        now: Instant,
    ) -> Result<bool, ApiError> {
        let entry = self.owned(auth, channel, id)?;
        let muted = muted || deafened;
        if entry.public.muted == muted && entry.public.deafened == deafened {
            return Ok(false);
        }
        charge(&mut self.global_controls, now, 2048)?;
        let entry = self.entries.get_mut(&id).ok_or_else(ended)?;
        entry.public.muted = muted;
        entry.public.deafened = deafened;
        Ok(true)
    }
    fn heartbeat(
        &mut self,
        auth: &Auth,
        channel: Uuid,
        id: Uuid,
        now: Instant,
    ) -> Result<(), ApiError> {
        self.owned(auth, channel, id)?;
        self.entries.get_mut(&id).ok_or_else(ended)?.last_seen = now;
        Ok(())
    }
    fn leave(&mut self, auth: &Auth, channel: Uuid, id: Uuid) -> Result<Vec<Entry>, ApiError> {
        if !self.entries.contains_key(&id) {
            return Ok(Vec::new());
        }
        self.owned(auth, channel, id)?;
        Ok(self.remove_where(|entry| entry.public.id == id))
    }
    fn signal_target(
        &mut self,
        auth: &Auth,
        channel: Uuid,
        from: Uuid,
        target: Uuid,
        now: Instant,
    ) -> Result<Entry, ApiError> {
        self.owned(auth, channel, from)?;
        if from == target {
            return Err(ApiError::validation(
                "La señal debe dirigirse a otra persona de la misma llamada.",
            ));
        }
        let recipient = self
            .entries
            .get(&target)
            .filter(|entry| entry.channel_id == channel)
            .cloned()
            .ok_or_else(ApiError::not_found)?;
        charge(&mut self.global_signals, now, 4096)?;
        self.entries
            .get_mut(&from)
            .ok_or_else(ended)?
            .signals
            .charge(now, 240)?;
        Ok(recipient)
    }
    fn remove_where(&mut self, predicate: impl Fn(&Entry) -> bool) -> Vec<Entry> {
        let ids: Vec<_> = self
            .entries
            .values()
            .filter(|entry| predicate(entry))
            .map(|entry| entry.public.id)
            .collect();
        ids.into_iter()
            .filter_map(|id| self.entries.remove(&id))
            .collect()
    }
    fn expired(&mut self, now: Instant) -> Vec<Entry> {
        self.remove_where(|entry| now.saturating_duration_since(entry.last_seen) >= TTL)
    }
}

fn participants_event(state: &AppState, registry: &Registry, channel: Uuid, community: Uuid) {
    // All callers hold the registry mutex: publication and its snapshot are ordered together.
    let revision = registry.roster_revision.fetch_add(1, Ordering::Relaxed) + 1;
    let _ = state.events.send(Event { community_id: community, payload: serde_json::json!({"type":"voice.participants","channelId":channel,"participants":registry.roster(channel),"revision":revision}), removed_user: None, recipient_session: None });
}
fn removed_events(
    state: &AppState,
    registry: &Registry,
    removed: Vec<Entry>,
    reason: &'static str,
) {
    let mut channels = HashMap::new();
    for entry in removed {
        channels.insert(entry.channel_id, entry.community_id);
        let _ = state.events.send(Event { community_id: entry.community_id, payload: serde_json::json!({"type":"voice.ended","channelId":entry.channel_id,"participantId":entry.public.id,"reason":reason}), removed_user: Some(entry.public.user_id), recipient_session: Some(entry.session_hash) });
    }
    for (channel, community) in channels {
        participants_event(state, registry, channel, community);
    }
}
fn expire(state: &AppState, registry: &mut Registry, now: Instant) {
    let expired = registry.expired(now);
    removed_events(state, registry, expired, "expired");
}

struct Permission {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    community: Uuid,
    display_name: String,
}
async fn authorize(state: &AppState, auth: &Auth, channel: Uuid) -> Result<Permission, ApiError> {
    let mut transaction = state.pool.begin().await?;
    let session: Option<String> = sqlx::query_scalar("SELECT token_hash FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR SHARE")
        .bind(&auth.session_hash).bind(auth.user_id).fetch_optional(&mut *transaction).await?;
    if session.is_none() {
        return Err(ApiError::unauthorized());
    }
    let allowed: Option<(Uuid,String,String)> = sqlx::query_as("SELECT c.community_id,c.kind,u.display_name FROM channels c JOIN community_members m ON m.community_id=c.community_id JOIN users u ON u.id=m.user_id WHERE c.id=$1 AND m.user_id=$2 FOR SHARE OF m")
        .bind(channel).bind(auth.user_id).fetch_optional(&mut *transaction).await?;
    let (community, kind, display_name) = allowed.ok_or_else(ApiError::forbidden)?;
    if kind != "voice" {
        return Err(ApiError::validation("Este canal no es un canal de voz."));
    }
    Ok(Permission {
        transaction,
        community,
        display_name,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JoinInput {}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinResponse {
    channel_id: Uuid,
    revision: u64,
    participant: Participant,
    participants: Vec<Participant>,
    ice_servers: Vec<IceServer>,
    max_participants: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParticipantInput {
    participant_id: Uuid,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateInput {
    participant_id: Uuid,
    muted: bool,
    deafened: bool,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    #[serde(default)]
    candidate: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sdp_mid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sdp_m_line_index: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username_fragment: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Signal {
    Offer { sdp: String },
    Answer { sdp: String },
    Candidate { candidate: Option<Candidate> },
}
impl Signal {
    fn validate(&self) -> Result<(), ApiError> {
        let valid = match self {
            Self::Offer { sdp } | Self::Answer { sdp } => {
                !sdp.is_empty() && sdp.len() <= 16_384 && !sdp.contains('\0')
            }
            Self::Candidate { candidate: None } => true,
            Self::Candidate {
                candidate: Some(candidate),
            } => {
                candidate.candidate.len() <= 4096
                    && !candidate.candidate.chars().any(char::is_control)
                    && [&candidate.sdp_mid, &candidate.username_fragment]
                        .iter()
                        .all(|field| {
                            field
                                .as_ref()
                                .is_none_or(|s| s.len() <= 256 && !s.chars().any(char::is_control))
                        })
            }
        };
        if !valid {
            return Err(ApiError::validation(
                "La señal de voz no es válida o supera el tamaño permitido.",
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignalInput {
    participant_id: Uuid,
    target_id: Uuid,
    signal: Signal,
}

pub async fn join(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<JoinInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<JoinResponse>, ApiError> {
    let _ = error::json(payload)?;
    let channel = error::uuid(&id)?;
    let permission = authorize(&state, &auth, channel).await?;
    let response = {
        let now = Instant::now();
        let mut registry = state.voice.lock().await;
        expire(&state, &mut registry, now);
        registry.request(auth.user_id, now)?;
        let (participant, previous) = registry.join(
            &auth,
            channel,
            permission.community,
            permission.display_name,
            now,
        )?;
        let previous_channel = previous.as_ref().map(|entry| entry.channel_id);
        if let Some(previous) = previous {
            removed_events(&state, &registry, vec![previous], "replaced");
        }
        if previous_channel != Some(channel) {
            participants_event(&state, &registry, channel, permission.community);
        }
        JoinResponse {
            channel_id: channel,
            revision: registry.roster_revision.load(Ordering::Relaxed),
            participant,
            participants: registry.roster(channel),
            ice_servers: state.config.voice_ice_servers.clone(),
            max_participants: MAX_PARTICIPANTS,
        }
    };
    permission.transaction.commit().await?;
    Ok(Json(response))
}

pub async fn set_state(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<StateInput>, axum::extract::rejection::JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let input = error::json(payload)?;
    let channel = error::uuid(&id)?;
    let permission = authorize(&state, &auth, channel).await?;
    {
        let now = Instant::now();
        let mut registry = state.voice.lock().await;
        expire(&state, &mut registry, now);
        registry.request(auth.user_id, now)?;
        if registry.set_state(
            &auth,
            channel,
            input.participant_id,
            input.muted,
            input.deafened,
            now,
        )? {
            participants_event(&state, &registry, channel, permission.community);
        }
    }
    permission.transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn heartbeat(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<ParticipantInput>, axum::extract::rejection::JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let input = error::json(payload)?;
    let channel = error::uuid(&id)?;
    let permission = authorize(&state, &auth, channel).await?;
    {
        let now = Instant::now();
        let mut registry = state.voice.lock().await;
        expire(&state, &mut registry, now);
        registry.request(auth.user_id, now)?;
        registry.heartbeat(&auth, channel, input.participant_id, now)?;
    }
    permission.transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<ParticipantInput>, axum::extract::rejection::JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let input = error::json(payload)?;
    let channel = error::uuid(&id)?;
    let permission = authorize(&state, &auth, channel).await?;
    {
        let now = Instant::now();
        let mut registry = state.voice.lock().await;
        expire(&state, &mut registry, now);
        registry.request(auth.user_id, now)?;
        let removed = registry.leave(&auth, channel, input.participant_id)?;
        removed_events(&state, &registry, removed, "left");
    }
    permission.transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn signal(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    payload: Result<Json<SignalInput>, axum::extract::rejection::JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let input = error::json(payload)?;
    input.signal.validate()?;
    let channel = error::uuid(&id)?;
    let permission = authorize(&state, &auth, channel).await?;
    let target = {
        let now = Instant::now();
        let mut registry = state.voice.lock().await;
        expire(&state, &mut registry, now);
        registry.request(auth.user_id, now)?;
        registry.signal_target(&auth, channel, input.participant_id, input.target_id, now)?
    };
    let target_auth = Auth {
        user_id: target.public.user_id,
        session_hash: target.session_hash.clone(),
        provenance: auth::Provenance::Bearer,
    };
    let target_permission = authorize(&state, &target_auth, channel).await?;
    {
        let registry = state.voice.lock().await;
        registry.owned(&auth, channel, input.participant_id)?;
        registry.owned(&target_auth, channel, input.target_id)?;
        let _ = state.events.send(Event { community_id: permission.community, payload: serde_json::json!({"type":"voice.signal","channelId":channel,"fromId":input.participant_id,"targetId":input.target_id,"signal":input.signal}), removed_user: None, recipient_session: Some(target.session_hash) });
    }
    target_permission.transaction.commit().await?;
    permission.transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_session(state: &AppState, session: &str, reason: &'static str) {
    let mut registry = state.voice.lock().await;
    let removed = registry.remove_where(|entry| entry.session_hash == session);
    removed_events(state, &registry, removed, reason);
}
pub async fn remove_member(state: &AppState, user: Uuid, community: Uuid) {
    let mut registry = state.voice.lock().await;
    let removed = registry
        .remove_where(|entry| entry.public.user_id == user && entry.community_id == community);
    removed_events(state, &registry, removed, "membership_revoked");
}

pub async fn sweep(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        interval.tick().await;
        let entries: Vec<Entry> = {
            let mut registry = state.voice.lock().await;
            expire(&state, &mut registry, Instant::now());
            registry.entries.values().cloned().collect()
        };
        if entries.is_empty() {
            continue;
        }
        let ids: Vec<_> = entries.iter().map(|e| e.public.id).collect();
        let sessions: Vec<_> = entries.iter().map(|e| e.session_hash.clone()).collect();
        let users: Vec<_> = entries.iter().map(|e| e.public.user_id).collect();
        let channels: Vec<_> = entries.iter().map(|e| e.channel_id).collect();
        let communities: Vec<_> = entries.iter().map(|e| e.community_id).collect();
        let current: Result<Vec<Uuid>,sqlx::Error> = sqlx::query_scalar("SELECT v.id FROM unnest($1::uuid[],$2::text[],$3::uuid[],$4::uuid[],$5::uuid[]) AS v(id,session_hash,user_id,channel_id,community_id) JOIN sessions s ON s.token_hash=v.session_hash AND s.user_id=v.user_id JOIN community_members m ON m.user_id=v.user_id AND m.community_id=v.community_id JOIN channels c ON c.id=v.channel_id AND c.community_id=v.community_id AND c.kind='voice' WHERE s.expires_at>now()")
            .bind(&ids).bind(&sessions).bind(&users).bind(&channels).bind(&communities).fetch_all(&state.pool).await;
        let (valid, reason) = match current {
            Ok(ids) => (
                ids.into_iter().collect::<HashSet<_>>(),
                "permission_revoked",
            ),
            Err(_) => (HashSet::new(), "authorization_unavailable"),
        };
        let snapshot_ids: HashSet<_> = ids.into_iter().collect();
        let mut registry = state.voice.lock().await;
        let removed = registry.remove_where(|entry| {
            snapshot_ids.contains(&entry.public.id) && !valid.contains(&entry.public.id)
        });
        removed_events(&state, &registry, removed, reason);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn identity(marker: char) -> Auth {
        Auth {
            user_id: Uuid::new_v4(),
            session_hash: marker.to_string().repeat(64),
            provenance: auth::Provenance::Bearer,
        }
    }
    fn add(
        registry: &mut Registry,
        auth: &Auth,
        channel: Uuid,
        community: Uuid,
        now: Instant,
    ) -> Participant {
        registry
            .join(
                auth,
                channel,
                community,
                "Participante sintético".into(),
                now,
            )
            .unwrap()
            .0
    }

    #[test]
    fn rejoining_rotates_the_lease_and_a_late_leave_cannot_remove_the_new_call() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let auth = identity('a');
        let channel = Uuid::new_v4();
        let community = Uuid::new_v4();
        let first = add(&mut registry, &auth, channel, community, now);
        let (second, replaced) = registry
            .join(&auth, channel, community, "Nuevo intento".into(), now)
            .unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(replaced.unwrap().public.id, first.id);
        assert_eq!(registry.roster(channel), vec![second.clone()]);
        assert!(registry.leave(&auth, channel, first.id).unwrap().is_empty());
        assert_eq!(registry.roster(channel), vec![second]);
        let other_session = Auth {
            session_hash: "b".repeat(64),
            ..auth.clone()
        };
        assert_eq!(
            registry
                .join(
                    &other_session,
                    channel,
                    community,
                    "Otra pestaña".into(),
                    now
                )
                .err()
                .unwrap()
                .status,
            StatusCode::CONFLICT
        );
        let other_channel = Uuid::new_v4();
        let (third, previous) = registry
            .join(&auth, other_channel, community, "Otro canal".into(), now)
            .unwrap();
        assert!(previous.is_some());
        assert!(registry.roster(channel).is_empty());
        assert_eq!(registry.roster(other_channel), vec![third]);
    }

    #[test]
    fn participant_ids_do_not_authorize_another_user_session_or_channel() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let alice = identity('a');
        let bob = identity('b');
        let channel = Uuid::new_v4();
        let own = add(&mut registry, &alice, channel, Uuid::new_v4(), now);
        let other_session = Auth {
            session_hash: "c".repeat(64),
            ..alice.clone()
        };
        for attacker in [&bob, &other_session] {
            assert_eq!(
                registry
                    .set_state(attacker, channel, own.id, true, false, now)
                    .err()
                    .unwrap()
                    .status,
                StatusCode::FORBIDDEN
            );
            assert_eq!(
                registry
                    .heartbeat(attacker, channel, own.id, now + Duration::from_secs(20))
                    .err()
                    .unwrap()
                    .status,
                StatusCode::FORBIDDEN
            );
            assert_eq!(
                registry
                    .leave(attacker, channel, own.id)
                    .err()
                    .unwrap()
                    .status,
                StatusCode::FORBIDDEN
            );
        }
        assert_eq!(
            registry
                .heartbeat(&alice, Uuid::new_v4(), own.id, now)
                .err()
                .unwrap()
                .status,
            StatusCode::FORBIDDEN
        );
        assert_eq!(registry.entries[&own.id].last_seen, now);
        assert_eq!(registry.roster(channel), vec![own]);
    }

    #[test]
    fn expiry_is_bounded_and_only_the_owner_can_extend_a_lease() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let auth = identity('a');
        let channel = Uuid::new_v4();
        let participant = add(&mut registry, &auth, channel, Uuid::new_v4(), now);
        assert!(registry.expired(now + Duration::from_secs(44)).is_empty());
        registry
            .heartbeat(
                &auth,
                channel,
                participant.id,
                now + Duration::from_secs(10),
            )
            .unwrap();
        assert!(registry.expired(now + Duration::from_secs(54)).is_empty());
        assert_eq!(registry.expired(now + Duration::from_secs(55)).len(), 1);
        assert!(registry.roster(channel).is_empty());
        assert_eq!(
            registry
                .heartbeat(
                    &auth,
                    channel,
                    participant.id,
                    now + Duration::from_secs(56)
                )
                .err()
                .unwrap()
                .status,
            StatusCode::GONE
        );
    }

    #[test]
    fn room_and_global_quotas_do_not_evict_existing_calls() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let community = Uuid::new_v4();
        for _ in 0..MAX_GLOBAL_PARTICIPANTS / MAX_PARTICIPANTS {
            let channel = Uuid::new_v4();
            for _ in 0..MAX_PARTICIPANTS {
                add(&mut registry, &identity('a'), channel, community, now);
            }
            assert_eq!(
                registry
                    .join(&identity('b'), channel, community, "Sin plaza".into(), now)
                    .err()
                    .unwrap()
                    .code,
                "voice_full"
            );
        }
        assert_eq!(registry.entries.len(), MAX_GLOBAL_PARTICIPANTS);
        assert_eq!(
            registry
                .join(
                    &identity('c'),
                    Uuid::new_v4(),
                    community,
                    "Límite global".into(),
                    now
                )
                .err()
                .unwrap()
                .code,
            "voice_full"
        );
    }

    #[test]
    fn signals_are_limited_to_live_peers_in_the_same_channel_and_to_one_sender_quota() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let alice = identity('a');
        let bob = identity('b');
        let channel = Uuid::new_v4();
        let community = Uuid::new_v4();
        let a = add(&mut registry, &alice, channel, community, now);
        let b = add(&mut registry, &bob, channel, community, now);
        let outsider = add(
            &mut registry,
            &identity('c'),
            Uuid::new_v4(),
            community,
            now,
        );
        assert!(registry
            .signal_target(&alice, channel, a.id, outsider.id, now)
            .is_err());
        assert!(registry
            .signal_target(&alice, channel, a.id, a.id, now)
            .is_err());
        assert!(registry
            .signal_target(&bob, channel, a.id, b.id, now)
            .is_err());
        for _ in 0..240 {
            assert_eq!(
                registry
                    .signal_target(&alice, channel, a.id, b.id, now)
                    .unwrap()
                    .session_hash,
                bob.session_hash
            );
        }
        assert_eq!(
            registry
                .signal_target(&alice, channel, a.id, b.id, now)
                .err()
                .unwrap()
                .status,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert!(registry
            .signal_target(&bob, channel, b.id, a.id, now)
            .is_ok());
        let mut counter = Counter {
            started: now,
            count: 240,
        };
        assert!(counter.charge(now + RATE_WINDOW, 240).is_ok());
    }

    #[test]
    fn ice_configuration_is_bounded_inert_and_never_echoes_credentials_in_errors() {
        assert_eq!(
            parse_ice_servers(Some("")).unwrap(),
            parse_ice_servers(None).unwrap()
        );
        assert_eq!(
            parse_ice_servers(Some(" \n\t ")).unwrap(),
            parse_ice_servers(None).unwrap()
        );
        assert_eq!(
            serde_json::to_value(parse_ice_servers(None).unwrap()).unwrap(),
            serde_json::json!([{"urls":"stun:stun.cloudflare.com:3478"}])
        );
        assert!(parse_ice_servers(Some("[]")).unwrap().is_empty());
        assert!(parse_ice_servers(Some(r#"[{"urls":["turn:turn.example.test:3478?transport=udp","turns:[2001:db8::1]:5349?transport=tcp"],"username":"usuario","credential":"clave-sintetica","credentialType":"password"}]"#)).is_ok());
        for json in [
            r#"[{"urls":"https://example.test"}]"#,
            r#"[{"urls":"stun:usuario:clave@example.test"}]"#,
            r#"[{"urls":"stun:example.test/path"}]"#,
            r#"[{"urls":"stun:example.test:0"}]"#,
            r#"[{"urls":"turn:example.test:3478"}]"#,
            r#"[{"urls":[],"credential":"clave-sintetica"}]"#,
            r#"[{"urls":"stun:example.test","script":"clave-sintetica"}]"#,
        ] {
            let error = parse_ice_servers(Some(json)).err().unwrap();
            assert!(!error.contains("clave-sintetica"));
        }
        let oversized = format!("[{{\"urls\":\"stun:{}\"}}]", "a".repeat(16384));
        assert!(parse_ice_servers(Some(&oversized)).is_err());
        let too_many = serde_json::json!((0..9)
            .map(|_| serde_json::json!({"urls":"stun:example.test"}))
            .collect::<Vec<_>>())
        .to_string();
        assert!(parse_ice_servers(Some(&too_many)).is_err());
    }

    #[test]
    fn sdp_and_candidate_bodies_accept_browser_fields_without_unbounded_or_extra_data() {
        let browser: Signal = serde_json::from_value(serde_json::json!({"type":"candidate","candidate":{"candidate":"candidate:1 1 UDP 1 192.0.2.1 12345 typ host","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"fragment"}})).unwrap();
        assert!(browser.validate().is_ok());
        assert!(Signal::Candidate { candidate: None }.validate().is_ok());
        assert!(Signal::Offer {
            sdp: "a".repeat(16384)
        }
        .validate()
        .is_ok());
        assert!(Signal::Offer {
            sdp: "a".repeat(16385)
        }
        .validate()
        .is_err());
        assert!(Signal::Answer {
            sdp: "v=0\0".into()
        }
        .validate()
        .is_err());
        assert!(serde_json::from_value::<Signal>(
            serde_json::json!({"type":"candidate","candidate":{"candidate":"", "extra":"no"}})
        )
        .is_err());
        assert!(serde_json::from_value::<Signal>(
            serde_json::json!({"type":"offer","sdp":"v=0", "candidate":null})
        )
        .is_err());
    }

    fn state_without_database_connections() -> AppState {
        let (events, _) = tokio::sync::broadcast::channel(16);
        AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgresql://127.0.0.1:1/nuvex_voice_unit")
                .unwrap(),
            config: Arc::new(crate::config::Config {
                database_url: String::new(),
                bind: "127.0.0.1:1".parse().unwrap(),
                allowed_origin: "http://127.0.0.1:5173".into(),
                insecure_dev: true,
                registration_open: false,
                migrate_on_start: false,
                instance_name: "Prueba de voz".into(),
                trusted_proxies: vec![],
                voice_ice_servers: parse_ice_servers(None).unwrap(),
            }),
            events,
            rate_limiter: Arc::new(auth::RateLimiter::default()),
            password_workers: Arc::new(tokio::sync::Semaphore::new(1)),
            dummy_password_hash: "unused".into(),
            tickets: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(crate::realtime::Connections::default()),
            message_limiter: Arc::new(crate::messaging::MessageRateLimiter::default()),
            voice: Arc::new(tokio::sync::Mutex::new(Registry::default())),
        }
    }

    #[tokio::test]
    async fn roster_revisions_order_delayed_prejoin_events_before_the_join_snapshot() {
        let state = state_without_database_connections();
        let alice = identity('a');
        let bob = identity('b');
        let channel = Uuid::new_v4();
        let community = Uuid::new_v4();
        let mut events = state.events.subscribe();
        let mut registry = state.voice.lock().await;
        add(&mut registry, &alice, channel, community, Instant::now());
        participants_event(&state, &registry, channel, community);
        let delayed_prejoin = events.try_recv().unwrap().payload;
        let bob_participant = add(&mut registry, &bob, channel, community, Instant::now());
        participants_event(&state, &registry, channel, community);
        let joined = events.try_recv().unwrap().payload;
        let response = serde_json::to_value(JoinResponse {
            channel_id: channel,
            revision: registry.roster_revision.load(Ordering::Relaxed),
            participant: bob_participant,
            participants: registry.roster(channel),
            ice_servers: vec![],
            max_participants: MAX_PARTICIPANTS,
        })
        .unwrap();
        assert_eq!(delayed_prejoin["revision"], 1);
        assert_eq!(joined["revision"], 2);
        assert_eq!(response["revision"], joined["revision"]);
        assert_eq!(response["participants"], joined["participants"]);
        assert!(
            delayed_prejoin["revision"].as_u64().unwrap() < response["revision"].as_u64().unwrap()
        );
        assert_eq!(delayed_prejoin["participants"].as_array().unwrap().len(), 1);
        assert_eq!(response["participants"].as_array().unwrap().len(), 2);
        let removed = registry
            .leave(
                &bob,
                channel,
                response["participant"]["id"]
                    .as_str()
                    .unwrap()
                    .parse()
                    .unwrap(),
            )
            .unwrap();
        removed_events(&state, &registry, removed, "left");
        assert_eq!(events.try_recv().unwrap().payload["type"], "voice.ended");
        assert_eq!(events.try_recv().unwrap().payload["revision"], 3);
    }

    #[tokio::test]
    async fn revocation_controls_target_only_the_owning_session_and_publish_a_complete_roster() {
        let state = state_without_database_connections();
        let alice = identity('a');
        let bob = identity('b');
        let channel = Uuid::new_v4();
        let community = Uuid::new_v4();
        let (a, b) = {
            let mut registry = state.voice.lock().await;
            let a = add(&mut registry, &alice, channel, community, Instant::now());
            let b = add(&mut registry, &bob, channel, community, Instant::now());
            (a, b)
        };
        let mut events = state.events.subscribe();
        remove_session(&state, &"c".repeat(64), "logout").await;
        remove_member(&state, alice.user_id, Uuid::new_v4()).await;
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        assert_eq!(state.voice.lock().await.entries.len(), 2);
        remove_member(&state, alice.user_id, community).await;
        let ended = events.try_recv().unwrap();
        assert!(ended.intended_for(&alice.session_hash));
        assert!(!ended.intended_for(&bob.session_hash));
        assert_eq!(ended.payload["participantId"], serde_json::json!(a.id));
        assert_eq!(ended.payload["reason"], "membership_revoked");
        assert!(!ended.payload.to_string().contains(&alice.session_hash));
        let roster = events.try_recv().unwrap();
        assert_eq!(roster.payload["participants"], serde_json::json!([b]));
        assert!(roster.intended_for(&bob.session_hash));
        remove_session(&state, &bob.session_hash, "logout").await;
        assert!(state.voice.lock().await.entries.is_empty());
        assert_eq!(events.try_recv().unwrap().payload["reason"], "logout");
    }
}
