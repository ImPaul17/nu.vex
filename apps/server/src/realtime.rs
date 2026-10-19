use crate::{
    auth::{self, Auth},
    communities,
    error::ApiError,
    AppState,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::HeaderMap,
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone)]
pub struct Event {
    pub community_id: Uuid,
    pub payload: serde_json::Value,
    pub removed_user: Option<Uuid>,
}
impl Event {
    pub fn workspace(community_id: Uuid, removed_user: Option<Uuid>) -> Self {
        Self {
            community_id,
            payload: serde_json::json!({"type":"workspace.updated"}),
            removed_user,
        }
    }
}
pub struct WsTicket {
    pub auth: Auth,
    pub created: Instant,
}

#[derive(Default)]
pub struct Connections(Mutex<HashMap<Uuid, usize>>);
struct ConnectionLease {
    registry: Arc<Connections>,
    user_id: Uuid,
}
impl Connections {
    fn acquire(self: &Arc<Self>, user_id: Uuid) -> Result<ConnectionLease, ApiError> {
        let mut active = self.0.lock().map_err(|_| ApiError::internal())?;
        if active.values().sum::<usize>() >= 256 || active.get(&user_id).copied().unwrap_or(0) >= 8
        {
            return Err(ApiError::rate_limited());
        }
        *active.entry(user_id).or_default() += 1;
        Ok(ConnectionLease {
            registry: self.clone(),
            user_id,
        })
    }
}
impl Drop for ConnectionLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.registry.0.lock() {
            if let Some(count) = active.get_mut(&self.user_id) {
                *count -= 1;
                if *count == 0 {
                    active.remove(&self.user_id);
                }
            }
        }
    }
}
#[derive(Serialize)]
pub struct TicketResponse {
    ticket: String,
}
#[derive(Deserialize)]
pub struct EventQuery {
    ticket: Option<String>,
}

pub async fn ticket(
    State(state): State<AppState>,
    auth: Auth,
) -> Result<Json<TicketResponse>, ApiError> {
    let mut tickets = state.tickets.lock().map_err(|_| ApiError::internal())?;
    tickets.retain(|_, ticket| ticket.created.elapsed() < Duration::from_secs(30));
    if tickets.len() >= 2048
        || tickets
            .values()
            .filter(|ticket| ticket.auth.user_id == auth.user_id)
            .count()
            >= 8
    {
        return Err(ApiError::rate_limited());
    }
    let ticket = auth::random_token(32);
    tickets.insert(
        auth::token_hash(&ticket),
        WsTicket {
            auth,
            created: Instant::now(),
        },
    );
    Ok(Json(TicketResponse { ticket }))
}

pub async fn events(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Result<Query<EventQuery>, axum::extract::rejection::QueryRejection>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    crate::check_origin(&state, &headers)?;
    let Query(query) =
        query.map_err(|_| ApiError::validation("La solicitud de eventos no es válida."))?;
    let auth = if let Some(ticket) = query.ticket {
        if ticket.len() != 64 || !ticket.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ApiError::unauthorized());
        }
        let ticket = state
            .tickets
            .lock()
            .map_err(|_| ApiError::internal())?
            .remove(&auth::token_hash(&ticket))
            .ok_or_else(ApiError::unauthorized)?;
        if ticket.created.elapsed() >= Duration::from_secs(30) {
            return Err(ApiError::unauthorized());
        }
        ticket.auth
    } else {
        auth::authenticate(&state, &headers).await?
    };
    if !auth::session_active(&state, &auth).await? {
        return Err(ApiError::unauthorized());
    }
    let lease = state.connections.acquire(auth.user_id)?;
    let receiver = state.events.subscribe();
    Ok(ws
        .max_frame_size(2048)
        .max_message_size(2048)
        .on_upgrade(move |socket| async move {
            let _lease = lease;
            handle(socket, state, auth, receiver).await;
        }))
}

async fn send(socket: &mut WebSocket, payload: serde_json::Value) -> bool {
    send_frame(socket, Message::Text(payload.to_string().into())).await
}

async fn send_frame(socket: &mut WebSocket, frame: Message) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_secs(5), socket.send(frame)).await,
        Ok(Ok(()))
    )
}

async fn handle(
    mut socket: WebSocket,
    state: AppState,
    auth: Auth,
    mut receiver: tokio::sync::broadcast::Receiver<Event>,
) {
    if !send(&mut socket, serde_json::json!({"type":"ready"})).await {
        return;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    loop {
        tokio::select! {
            event=receiver.recv()=>{
                let event=match event{
                    Ok(event)=>event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>{let _=send(&mut socket,serde_json::json!({"type":"resync.required"})).await;break;},
                    Err(_)=>break,
                };
                if !matches!(auth::session_active(&state,&auth).await,Ok(true)){break;}
                // Revoked members receive only a data-free instruction to reload their own workspace.
                if event.removed_user==Some(auth.user_id){
                    if !send(&mut socket,serde_json::json!({"type":"workspace.updated"})).await{break;}
                    continue;
                }
                // Query current membership for every event. A connection is never a permission cache.
                match communities::require_member(&state.pool,auth.user_id,event.community_id).await{
                    Ok(())=>if !send(&mut socket,event.payload).await{break;},
                    Err(error) if error.status==axum::http::StatusCode::FORBIDDEN=>{},
                    Err(_)=>break,
                }
            },
            incoming=socket.recv()=>match incoming{
                Some(Ok(Message::Ping(bytes)))=>{if !send_frame(&mut socket,Message::Pong(bytes)).await{break;}},
                Some(Ok(Message::Pong(_)))=>{},
                // This stream has no mutation protocol. All writes use authenticated REST.
                _=>break,
            },
            _=heartbeat.tick()=>{
                if !matches!(auth::session_active(&state,&auth).await,Ok(true)){break;}
                if !send_frame(&mut socket,Message::Ping(Vec::new().into())).await{break;}
            }
        }
    }
    let _ = send_frame(&mut socket, Message::Close(None)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_quota_is_per_account_and_released_on_drop() {
        let registry = Arc::new(Connections::default());
        let user = Uuid::new_v4();
        let mut leases: Vec<_> = (0..8).map(|_| registry.acquire(user).unwrap()).collect();
        assert!(registry.acquire(user).is_err());
        assert!(registry.acquire(Uuid::new_v4()).is_ok());
        leases.pop();
        assert!(registry.acquire(user).is_ok());
        drop(leases);
        assert!(registry.0.lock().unwrap().is_empty());
    }
    #[test]
    fn global_connection_quota_bounds_distinct_accounts() {
        let registry = Arc::new(Connections::default());
        let leases: Vec<_> = (0..256)
            .map(|_| registry.acquire(Uuid::new_v4()).unwrap())
            .collect();
        assert!(registry.acquire(Uuid::new_v4()).is_err());
        drop(leases);
        assert!(registry.acquire(Uuid::new_v4()).is_ok());
    }
}
