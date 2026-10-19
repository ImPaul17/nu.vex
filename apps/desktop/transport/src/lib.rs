mod policy;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{Notify, Semaphore};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_REQUEST: usize = 32 * 1024;
const MAX_RESPONSE: usize = 4 * 1024 * 1024;
const MAX_FRAME: usize = 64_000;
const MAX_UNACKNOWLEDGED: u64 = 64;

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransportError {
    pub status: u16,
    pub code: &'static str,
    pub message: &'static str,
}
impl TransportError {
    fn invalid(message: &'static str) -> Self {
        Self {
            status: 400,
            code: "invalid_native_request",
            message,
        }
    }
    fn stale() -> Self {
        Self {
            status: 409,
            code: "stale_session",
            message: "La conexión nativa ha cambiado.",
        }
    }
    fn network() -> Self {
        Self {
            status: 0,
            code: "unreachable",
            message: "No se puede conectar de forma segura con la instancia.",
        }
    }
    fn response() -> Self {
        Self {
            status: 502,
            code: "invalid_response",
            message: "La instancia ha devuelto una respuesta no válida o demasiado grande.",
        }
    }
}

#[derive(Serialize)]
pub struct Connection {
    pub handle: String,
}
#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub payload: Value,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub stream_id: String,
    pub seq: u64,
    pub r#type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub stream_id: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum StreamCommand {
    Ack { seq: u64 },
    Close,
}
pub type EventSink = Arc<dyn Fn(StreamEvent) -> Result<(), ()> + Send + Sync>;

struct StreamControl {
    cancel: CancellationToken,
    acknowledged: AtomicU64,
    sent: AtomicU64,
    changed: Notify,
}
struct Selection {
    handle: String,
    origin: Url,
    epoch: u64,
    token: Option<Zeroizing<String>>,
    authenticating: bool,
    cancel: CancellationToken,
    requests: CancellationToken,
    stream: Option<(String, Arc<StreamControl>)>,
}
#[derive(Default)]
struct State {
    order: u64,
    selected: Option<Selection>,
}
struct Snapshot {
    handle: String,
    origin: Url,
    epoch: u64,
    token: Option<Zeroizing<String>>,
    cancel: CancellationToken,
}

pub struct Transport {
    state: Mutex<State>,
    client: reqwest::Client,
    requests: Arc<Semaphore>,
    allow_loopback: bool,
}

impl Transport {
    pub fn new(allow_loopback: bool) -> Result<Self, TransportError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .user_agent("nu.vex-native/0.2")
            .build()
            .map_err(|_| TransportError::network())?;
        Ok(Self {
            state: Mutex::new(State::default()),
            client,
            requests: Arc::new(Semaphore::new(8)),
            allow_loopback,
        })
    }

    pub fn connect(&self, origin: &str, order: u64) -> Result<Connection, TransportError> {
        let origin = policy::origin(origin, self.allow_loopback)?;
        let mut state = self.state.lock().map_err(|_| TransportError::stale())?;
        if order == 0 || order <= state.order {
            return Err(TransportError::stale());
        }
        if let Some(previous) = state.selected.take() {
            previous.cancel.cancel();
        }
        state.order = order;
        let handle = Uuid::new_v4().to_string();
        let cancel = CancellationToken::new();
        state.selected = Some(Selection {
            handle: handle.clone(),
            origin,
            epoch: 0,
            token: None,
            authenticating: false,
            requests: cancel.child_token(),
            cancel,
            stream: None,
        });
        Ok(Connection { handle })
    }

    /// A real document reload must not silently restore the old Rust credential.
    pub fn reset(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(previous) = state.selected.take() {
                previous.cancel.cancel();
            }
            state.order = 0;
        }
    }
    pub fn dispose(&self, handle: &str) {
        if let Ok(mut state) = self.state.lock() {
            if state
                .selected
                .as_ref()
                .is_some_and(|selected| selected.handle == handle)
            {
                if let Some(previous) = state.selected.take() {
                    previous.cancel.cancel();
                }
            }
        }
    }
    fn snapshot(&self, handle: &str, authenticating: bool) -> Result<Snapshot, TransportError> {
        let mut state = self.state.lock().map_err(|_| TransportError::stale())?;
        let selected = state
            .selected
            .as_mut()
            .filter(|selected| selected.handle == handle)
            .ok_or_else(TransportError::stale)?;
        if selected.authenticating && !authenticating {
            return Err(TransportError {
                status: 409,
                code: "auth_in_progress",
                message: "Espera a que termine el inicio de sesión.",
            });
        }
        if authenticating {
            selected.requests.cancel();
            selected.requests = selected.cancel.child_token();
            selected.epoch += 1;
            selected.token = None;
            selected.authenticating = true;
            if let Some((_, stream)) = selected.stream.take() {
                stream.cancel.cancel();
            }
        }
        Ok(Snapshot {
            handle: handle.into(),
            origin: selected.origin.clone(),
            epoch: selected.epoch,
            token: if authenticating {
                None
            } else {
                selected.token.clone()
            },
            cancel: selected.requests.child_token(),
        })
    }
    fn current(&self, snapshot: &Snapshot) -> bool {
        !snapshot.cancel.is_cancelled()
            && self.state.lock().is_ok_and(|state| {
                state.selected.as_ref().is_some_and(|selected| {
                    selected.handle == snapshot.handle && selected.epoch == snapshot.epoch
                })
            })
    }
    fn failed_auth(&self, snapshot: &Snapshot) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(selected) = state.selected.as_mut().filter(|selected| {
                selected.handle == snapshot.handle && selected.epoch == snapshot.epoch
            }) {
                selected.authenticating = false;
                selected.token = None;
            }
        }
    }
    fn finish(
        &self,
        snapshot: &Snapshot,
        response: &mut ApiResponse,
        kind: policy::Kind,
    ) -> Result<(), TransportError> {
        let mut state = self.state.lock().map_err(|_| TransportError::stale())?;
        let selected = state
            .selected
            .as_mut()
            .filter(|selected| {
                selected.handle == snapshot.handle && selected.epoch == snapshot.epoch
            })
            .ok_or_else(TransportError::stale)?;
        if snapshot.cancel.is_cancelled() {
            return Err(TransportError::stale());
        }
        if kind == policy::Kind::Auth {
            selected.authenticating = false;
            // Never send the authentication response's credential to the WebView.
            let token = response
                .payload
                .as_object_mut()
                .and_then(|object| object.remove("accessToken"));
            if (200..300).contains(&response.status) {
                let token = token
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .filter(|token| {
                        token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
                    })
                    .ok_or_else(TransportError::response)?;
                let user = response
                    .payload
                    .get("user")
                    .filter(|user| user.is_object())
                    .cloned()
                    .ok_or_else(TransportError::response)?;
                selected.token = Some(Zeroizing::new(token));
                selected.epoch += 1;
                selected.requests.cancel();
                selected.requests = selected.cancel.child_token();
                response.payload = json!({"user": user});
            }
        } else if response.status == 401
            || (kind == policy::Kind::Logout && (200..300).contains(&response.status))
        {
            selected.token = None;
            selected.epoch += 1;
            selected.requests.cancel();
            selected.requests = selected.cancel.child_token();
            if let Some((_, stream)) = selected.stream.take() {
                stream.cancel.cancel();
            }
        }
        Ok(())
    }

    async fn http(
        &self,
        snapshot: &Snapshot,
        path: &str,
        method: &str,
        body: Option<Value>,
    ) -> Result<ApiResponse, TransportError> {
        let _permit = self
            .requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| TransportError {
                status: 429,
                code: "native_busy",
                message: "Hay demasiadas solicitudes pendientes.",
            })?;
        let (path, query) = path
            .split_once('?')
            .map_or((path, None), |(path, query)| (path, Some(query)));
        let mut url = snapshot.origin.clone();
        url.set_path(&format!("/api/v1{path}"));
        url.set_query(query);
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| TransportError::invalid("El método de la solicitud no es válido."))?;
        let mut request = self
            .client
            .request(method, url)
            .header(reqwest::header::ACCEPT, "application/json");
        if let Some(token) = &snapshot.token {
            let mut header =
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token.as_str()))
                    .map_err(|_| TransportError::stale())?;
            header.set_sensitive(true);
            request = request.header(reqwest::header::AUTHORIZATION, header);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let operation = async {
            let mut response = request
                .send()
                .await
                .map_err(|_| TransportError::network())?;
            let status = response.status().as_u16();
            // Redirects are never followed, including redirects to another instance.
            if (300..400).contains(&status) {
                return Err(TransportError::response());
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_RESPONSE as u64)
            {
                return Err(TransportError::response());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| TransportError::network())?
            {
                if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
                    return Err(TransportError::response());
                }
                bytes.extend_from_slice(&chunk);
            }
            let payload = if status == 204 {
                json!({})
            } else {
                serde_json::from_slice(&bytes).map_err(|_| TransportError::response())?
            };
            if !payload.is_object() {
                return Err(TransportError::response());
            }
            Ok(ApiResponse { status, payload })
        };
        tokio::select! { biased; _ = snapshot.cancel.cancelled() => Err(TransportError::stale()), result = operation => result }
    }

    pub async fn request(
        &self,
        handle: &str,
        path: &str,
        method: Option<&str>,
        body: Option<&str>,
    ) -> Result<ApiResponse, TransportError> {
        let method = method.unwrap_or("GET");
        let route = policy::route(path, method, body)?;
        let snapshot = self.snapshot(handle, route.kind == policy::Kind::Auth)?;
        let mut response = match self.http(&snapshot, path, method, route.body).await {
            Ok(response) => response,
            Err(error) => {
                if route.kind == policy::Kind::Auth {
                    self.failed_auth(&snapshot);
                }
                return Err(error);
            }
        };
        self.finish(&snapshot, &mut response, route.kind)?;
        Ok(response)
    }

    pub fn control(
        &self,
        handle: &str,
        stream_id: &str,
        command: StreamCommand,
    ) -> Result<(), TransportError> {
        let state = self.state.lock().map_err(|_| TransportError::stale())?;
        let control = state
            .selected
            .as_ref()
            .filter(|selected| selected.handle == handle)
            .and_then(|selected| selected.stream.as_ref())
            .filter(|(id, _)| id == stream_id)
            .map(|(_, control)| control)
            .ok_or_else(TransportError::stale)?;
        match command {
            StreamCommand::Close => control.cancel.cancel(),
            StreamCommand::Ack { seq } => {
                if seq > control.sent.load(Ordering::Acquire) {
                    return Err(TransportError::invalid(
                        "La confirmación de eventos no es válida.",
                    ));
                }
                control.acknowledged.fetch_max(seq, Ordering::AcqRel);
                control.changed.notify_one();
            }
        }
        Ok(())
    }

    pub async fn events(
        self: &Arc<Self>,
        handle: &str,
        sink: EventSink,
    ) -> Result<Subscription, TransportError> {
        let snapshot = self.snapshot(handle, false)?;
        if snapshot.token.is_none() {
            return Err(TransportError {
                status: 401,
                code: "unauthorized",
                message: "Inicia sesión para recibir eventos.",
            });
        }
        let mut ticket = self.http(&snapshot, "/events/ticket", "POST", None).await?;
        self.finish(&snapshot, &mut ticket, policy::Kind::Protected)?;
        if ticket.status != 200 {
            return Err(TransportError {
                status: ticket.status,
                code: "events_unavailable",
                message: "No se ha podido abrir la conexión de eventos.",
            });
        }
        let ticket = ticket
            .payload
            .get("ticket")
            .and_then(Value::as_str)
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(TransportError::response)?;
        let mut url = snapshot.origin.clone();
        url.set_scheme(if snapshot.origin.scheme() == "https" {
            "wss"
        } else {
            "ws"
        })
        .map_err(|_| {
            TransportError::invalid("El origen de la conexión de eventos no es válido.")
        })?;
        url.set_path("/api/v1/events");
        url.query_pairs_mut().append_pair("ticket", ticket);
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_FRAME))
            .max_frame_size(Some(MAX_FRAME));
        let opened = tokio::time::timeout(
            Duration::from_secs(10),
            connect_async_with_config(url.as_str(), Some(config), false),
        );
        let (socket, _) = tokio::select! { biased; _ = snapshot.cancel.cancelled() => return Err(TransportError::stale()), value = opened => value.map_err(|_| TransportError::network())?.map_err(|_| TransportError::network())? };
        if !self.current(&snapshot) {
            return Err(TransportError::stale());
        }
        let stream_id = Uuid::new_v4().to_string();
        let control = Arc::new(StreamControl {
            cancel: snapshot.cancel.child_token(),
            acknowledged: AtomicU64::new(0),
            sent: AtomicU64::new(0),
            changed: Notify::new(),
        });
        {
            let mut state = self.state.lock().map_err(|_| TransportError::stale())?;
            let selected = state
                .selected
                .as_mut()
                .filter(|selected| {
                    selected.handle == snapshot.handle && selected.epoch == snapshot.epoch
                })
                .ok_or_else(TransportError::stale)?;
            if let Some((_, old)) = selected
                .stream
                .replace((stream_id.clone(), control.clone()))
            {
                old.cancel.cancel();
            }
        }
        let transport = self.clone();
        let id = stream_id.clone();
        tokio::spawn(async move {
            transport.stream(snapshot, id, control, socket, sink).await;
        });
        Ok(Subscription { stream_id })
    }

    async fn stream(
        &self,
        snapshot: Snapshot,
        id: String,
        control: Arc<StreamControl>,
        mut socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        sink: EventSink,
    ) {
        let emit = |kind, data| {
            // Serialize private delivery with auth/selection changes. Renderer
            // epoch guards also discard callbacks already queued before a change.
            let state = self.state.lock().map_err(|_| ())?;
            if kind != "close"
                && (snapshot.cancel.is_cancelled()
                    || !state.selected.as_ref().is_some_and(|selected| {
                        selected.handle == snapshot.handle && selected.epoch == snapshot.epoch
                    }))
            {
                return Err(());
            }
            let seq = control.sent.fetch_add(1, Ordering::AcqRel) + 1;
            sink(StreamEvent {
                stream_id: id.clone(),
                seq,
                r#type: kind,
                data,
            })
        };
        if emit("open", None).is_err() {
            return;
        }
        loop {
            if !self.current(&snapshot) || control.cancel.is_cancelled() {
                break;
            }
            if control
                .sent
                .load(Ordering::Acquire)
                .saturating_sub(control.acknowledged.load(Ordering::Acquire))
                >= MAX_UNACKNOWLEDGED
            {
                let acknowledged = tokio::select! { _ = control.cancel.cancelled() => false, value = tokio::time::timeout(Duration::from_secs(5), control.changed.notified()) => value.is_ok() };
                if !acknowledged {
                    break;
                }
                continue;
            }
            let incoming = tokio::select! { biased; _ = control.cancel.cancelled() => break, incoming = socket.next() => incoming };
            if !self.current(&snapshot) {
                break;
            }
            match incoming {
                Some(Ok(Message::Text(text))) if text.len() <= MAX_FRAME => {
                    if serde_json::from_str::<Value>(&text).is_err() {
                        let _ = emit("error", None);
                        break;
                    }
                    if emit("message", Some(text.to_string())).is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Ping(value))) => {
                    if !matches!(
                        tokio::time::timeout(
                            Duration::from_secs(5),
                            socket.send(Message::Pong(value))
                        )
                        .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                _ => {
                    let _ = emit("error", None);
                    break;
                }
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
        // A stale session never delivers old private payloads. A terminal close
        // carries no content and lets the renderer release its old callback.
        let _ = emit("close", None);
        if let Ok(mut state) = self.state.lock() {
            if let Some(selected) = state
                .selected
                .as_mut()
                .filter(|selected| selected.handle == snapshot.handle)
            {
                if selected
                    .stream
                    .as_ref()
                    .is_some_and(|(stream_id, _)| stream_id == &id)
                {
                    selected.stream = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn connected() -> (Transport, String) {
        let transport = Transport::new(true).unwrap();
        let handle = transport.connect("https://chat.example", 1).unwrap().handle;
        (transport, handle)
    }
    fn signed_in(transport: &Transport, handle: &str, token: &str) {
        let snapshot = transport.snapshot(handle, true).unwrap();
        let mut response = ApiResponse {
            status: 200,
            payload: json!({"user":{"id":"test-user"},"accessToken":token,"ignored":"field"}),
        };
        transport
            .finish(&snapshot, &mut response, policy::Kind::Auth)
            .unwrap();
        assert_eq!(response.payload, json!({"user":{"id":"test-user"}}));
    }
    #[test]
    fn selection_order_old_dispose_and_reload_do_not_cross_sessions() {
        let (transport, first) = connected();
        let old = transport.snapshot(&first, false).unwrap();
        let second = transport
            .connect("https://other.example", 2)
            .unwrap()
            .handle;
        assert!(!transport.current(&old));
        transport.dispose(&first);
        assert!(transport.snapshot(&second, false).is_ok());
        assert!(transport.connect("https://old.example", 1).is_err());
        transport.reset();
        assert!(transport.snapshot(&second, false).is_err());
        assert!(transport.connect("https://after-reload.example", 1).is_ok());
    }
    #[test]
    fn pending_failed_auth_never_reuses_the_previous_user_token() {
        let (transport, handle) = connected();
        signed_in(&transport, &handle, &"a".repeat(64));
        let old = transport.snapshot(&handle, false).unwrap();
        let pending = transport.snapshot(&handle, true).unwrap();
        assert!(transport.snapshot(&handle, false).is_err());
        transport.failed_auth(&pending);
        assert!(transport.snapshot(&handle, false).unwrap().token.is_none());
        assert!(!transport.current(&old));
    }
    #[test]
    fn late_auth_and_old_401_cannot_replace_or_revoke_new_credentials() {
        let (transport, handle) = connected();
        let first = transport.snapshot(&handle, true).unwrap();
        let second = transport.snapshot(&handle, true).unwrap();
        let mut response_b = ApiResponse {
            status: 200,
            payload: json!({"user":{},"accessToken":"b".repeat(64)}),
        };
        transport
            .finish(&second, &mut response_b, policy::Kind::Auth)
            .unwrap();
        let mut response_a = ApiResponse {
            status: 200,
            payload: json!({"user":{},"accessToken":"a".repeat(64)}),
        };
        assert!(transport
            .finish(&first, &mut response_a, policy::Kind::Auth)
            .is_err());
        let mut unauthorized = ApiResponse {
            status: 401,
            payload: json!({}),
        };
        assert!(transport
            .finish(&first, &mut unauthorized, policy::Kind::Protected)
            .is_err());
        assert_eq!(
            transport
                .snapshot(&handle, false)
                .unwrap()
                .token
                .unwrap()
                .as_str(),
            "b".repeat(64)
        );
    }
    #[test]
    fn failed_logout_preserves_credentials_and_success_or_current_401_clears_them() {
        let (transport, handle) = connected();
        signed_in(&transport, &handle, &"a".repeat(64));
        let before = transport.snapshot(&handle, false).unwrap();
        transport
            .finish(
                &before,
                &mut ApiResponse {
                    status: 503,
                    payload: json!({}),
                },
                policy::Kind::Logout,
            )
            .unwrap();
        assert!(transport.snapshot(&handle, false).unwrap().token.is_some());
        transport
            .finish(
                &before,
                &mut ApiResponse {
                    status: 204,
                    payload: json!({}),
                },
                policy::Kind::Logout,
            )
            .unwrap();
        assert!(transport.snapshot(&handle, false).unwrap().token.is_none());
        signed_in(&transport, &handle, &"b".repeat(64));
        let current = transport.snapshot(&handle, false).unwrap();
        transport
            .finish(
                &current,
                &mut ApiResponse {
                    status: 401,
                    payload: json!({}),
                },
                policy::Kind::Protected,
            )
            .unwrap();
        assert!(transport.snapshot(&handle, false).unwrap().token.is_none());
    }
    async fn server(
        status: &str,
        headers: String,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_string();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 8192];
            let count = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).into_owned();
            let message = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{headers}Connection: close\r\n\r\n{body}");
            socket.write_all(message.as_bytes()).await.unwrap();
            request
        });
        (origin, task)
    }
    #[tokio::test]
    async fn actual_http_refuses_redirects_without_contacting_the_destination() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (origin, task) = server(
            "302 Found",
            format!(
                "Location: http://{}/private\r\nContent-Length: 2\r\n",
                destination.local_addr().unwrap()
            ),
            "{}",
        )
        .await;
        let transport = Transport::new(true).unwrap();
        let handle = transport.connect(&origin, 1).unwrap().handle;
        assert!(transport
            .request(&handle, "/instance", None, None)
            .await
            .is_err());
        let request = task.await.unwrap().to_ascii_lowercase();
        assert!(
            !request.contains("\r\norigin:")
                && !request.contains("\r\ncookie:")
                && !request.contains("\r\nauthorization:")
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(100), destination.accept())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn actual_http_caps_responses_and_keeps_bearer_out_of_cookie_origin_headers() {
        let (origin, task) = server("200 OK", "Content-Length: 2\r\n".into(), "{}").await;
        let transport = Transport::new(true).unwrap();
        let handle = transport.connect(&origin, 1).unwrap().handle;
        signed_in(&transport, &handle, &"a".repeat(64));
        assert_eq!(
            transport
                .request(&handle, "/bootstrap", None, None)
                .await
                .unwrap()
                .status,
            200
        );
        let request = task.await.unwrap().to_ascii_lowercase();
        assert!(request.contains("\r\nauthorization: bearer "));
        assert!(!request.contains("\r\norigin:") && !request.contains("\r\ncookie:"));
        let (origin, oversized) = server(
            "200 OK",
            format!("Content-Length: {}\r\n", MAX_RESPONSE + 1),
            "",
        )
        .await;
        let handle = transport.connect(&origin, 2).unwrap().handle;
        assert!(transport
            .request(&handle, "/instance", None, None)
            .await
            .is_err());
        oversized.await.unwrap();
    }
}
