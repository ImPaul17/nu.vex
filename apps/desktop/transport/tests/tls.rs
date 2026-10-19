//! Real, opt-in production TLS acceptance. The orchestrator owns every endpoint,
//! certificate, account and PostgreSQL database; no verifier is replaced here.
//! Run through scripts/verify-native-tls.mjs, never with a public instance fixture.

use nuvex_transport::{ApiResponse, StreamCommand, StreamEvent, Transport};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use url::Url;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    version: u32,
    run_id: String,
    account: Account,
    valid_origin: String,
    invalid_origins: InvalidOrigins,
    control_origin: String,
    control_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    email: String,
    handle: String,
    display_name: String,
    password: String,
}

#[derive(Deserialize)]
struct InvalidOrigins {
    untrusted: String,
    expired: String,
    hostname: String,
}

impl Fixture {
    fn read() -> Self {
        let path = std::env::var_os("NUVEX_TLS_FIXTURE_FILE")
            .expect("Explicit NUVEX_TLS_FIXTURE_FILE is required; use the TLS orchestrator");
        let bytes = fs::read(path).expect("Could not read the private TLS fixture");
        assert!(
            bytes.len() <= 16 * 1024,
            "TLS fixture is unexpectedly large"
        );
        let fixture: Self = serde_json::from_slice(&bytes).expect("Invalid TLS fixture JSON");
        assert_eq!(fixture.version, 1, "Unsupported TLS fixture version");
        assert!(
            Uuid::parse_str(&fixture.run_id).is_ok(),
            "A unique TLS run ID is required"
        );
        for origin in [
            &fixture.valid_origin,
            &fixture.invalid_origins.untrusted,
            &fixture.invalid_origins.expired,
            &fixture.invalid_origins.hostname,
        ] {
            validate_origin(origin, true);
        }
        validate_origin(&fixture.control_origin, false);
        assert!(
            fixture.control_token.len() == 64
                && fixture.control_token.bytes().all(|c| c.is_ascii_hexdigit()),
            "The private control token must be an opaque 256-bit value"
        );
        fixture
    }
}

fn validate_origin(origin: &str, tls: bool) {
    let url = Url::parse(origin).expect("Invalid loopback fixture origin");
    assert!(
        matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path() == "/"
            && origin == url.origin().ascii_serialization()
            && (url.scheme() == "https" || (!tls && url.scheme() == "http")),
        "TLS acceptance is restricted to explicit loopback origins"
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    ticket_successes: u64,
    new_tls_connections: u64,
    tls_failures: u64,
    proxy_requests: u64,
    upstream_requests: u64,
    upgrade_requests: u64,
    upstream_upgrade_requests: u64,
    sink_requests: u64,
    sink_connections: u64,
}

struct Control {
    client: reqwest::Client,
    origin: String,
    token: reqwest::header::HeaderValue,
}

impl Control {
    fn new(fixture: &Fixture) -> Self {
        let mut token = reqwest::header::HeaderValue::from_str(&fixture.control_token)
            .expect("Invalid private control token");
        token.set_sensitive(true);
        Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .no_proxy()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("Could not create the local test control client"),
            origin: fixture.control_origin.clone(),
            token,
        }
    }

    async fn configure(&self, label: &str, mut options: Value) {
        options["caseId"] = json!(label);
        self.client
            .post(format!("{}/configure", self.origin))
            .header("X-Nuvex-Test-Control", self.token.clone())
            .json(&options)
            .send()
            .await
            .expect("The isolated TLS controller did not respond")
            .error_for_status()
            .expect("The isolated TLS controller rejected its configuration");
    }

    async fn state(&self) -> Stats {
        self.client
            .get(format!("{}/state", self.origin))
            .header("X-Nuvex-Test-Control", self.token.clone())
            .send()
            .await
            .expect("The isolated TLS controller did not return evidence")
            .error_for_status()
            .expect("The isolated TLS controller rejected its evidence request")
            .json()
            .await
            .expect("The TLS proxy did not provide complete acceptance counters")
    }

    async fn tls_rejection(&self) -> Stats {
        // The server observes the TLS alert/socket close just after the client
        // returns its validation failure. Wait only for this bounded evidence.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let stats = self.state().await;
            if stats.tls_failures >= 1 || tokio::time::Instant::now() >= deadline {
                return stats;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

fn selected(origin: &str) -> (Arc<Transport>, String) {
    // This is the real release policy even when the integration binary is debug.
    let transport =
        Arc::new(Transport::new(false).expect("Production transport initialization failed"));
    let document = transport.document().expect("Document nonce is unavailable");
    let handle = transport
        .connect(origin, 1, &document.document_id)
        .expect("Could not select the isolated HTTPS origin")
        .handle;
    (transport, handle)
}

async fn request(
    transport: &Transport,
    handle: &str,
    path: &str,
    method: &str,
    body: Option<Value>,
    status: u16,
) -> ApiResponse {
    let serialized = body.map(|value| value.to_string());
    let response = transport
        .request(handle, path, Some(method), serialized.as_deref())
        .await
        .expect("A real HTTPS API operation failed");
    assert_eq!(response.status, status, "Unexpected real API status");
    response
}

struct Events {
    transport: Arc<Transport>,
    handle: String,
    stream_id: String,
    receiver: mpsc::Receiver<StreamEvent>,
}

impl Events {
    async fn open(transport: Arc<Transport>, handle: &str) -> Self {
        let (sender, receiver) = mpsc::channel(64);
        let stream = transport
            .events(
                handle,
                Arc::new(move |event| sender.try_send(event).map_err(|_| ())),
            )
            .await
            .expect("The trusted real WSS handshake failed");
        let mut events = Self {
            transport,
            handle: handle.into(),
            stream_id: stream.stream_id,
            receiver,
        };
        events.wait_message("ready", None).await;
        events
    }

    async fn receive(&mut self, deadline: tokio::time::Instant) -> StreamEvent {
        let event = tokio::time::timeout_at(deadline, self.receiver.recv())
            .await
            .expect("The real WSS stream did not deliver its committed event")
            .expect("The real WSS channel ended before its expected event");
        assert_eq!(
            event.stream_id, self.stream_id,
            "WSS callback crossed stream IDs"
        );
        let ack = self.transport.control(
            &self.handle,
            &self.stream_id,
            StreamCommand::Ack { seq: event.seq },
        );
        if event.r#type != "close" {
            ack.expect("Could not acknowledge the real WSS stream");
        }
        event
    }

    async fn wait_message(&mut self, kind: &str, id: Option<&str>) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            let event = self.receive(deadline).await;
            assert!(
                event.r#type != "close" && event.r#type != "error",
                "Trusted WSS closed unexpectedly"
            );
            if let Some(data) = event.data {
                let value: Value = serde_json::from_str(&data).expect("WSS delivered invalid JSON");
                if value["type"] == kind && id.is_none_or(|id| value["message"]["id"] == id) {
                    return;
                }
            }
        }
    }

    async fn close(mut self) {
        self.transport
            .control(&self.handle, &self.stream_id, StreamCommand::Close)
            .expect("Could not close the owned WSS subscription");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while self.receive(deadline).await.r#type != "close" {}
    }
}

fn no_redirect_contact(stats: &Stats) {
    assert_eq!(
        stats.sink_connections, 0,
        "A redirect contacted its forbidden destination"
    );
    assert_eq!(
        stats.sink_requests, 0,
        "A redirect forwarded a password, bearer, or ticket request"
    );
}

fn passed(label: &str) {
    // Static labels only. The orchestrator can redact its known fixture account
    // if a dependency reports an unexpected error, without recording any token.
    println!("PASS native-tls: {label}");
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "Requires the explicit private fixture, trusted ephemeral CA, real API and PostgreSQL provided by verify-native-tls.mjs"]
async fn production_https_wss_enforce_certificates_origins_and_redirect_boundaries() {
    let fixture = Fixture::read();
    let (transport, handle) = selected(&fixture.valid_origin);
    let control = Control::new(&fixture);
    let document = transport.document().unwrap();
    assert!(
        transport
            .connect("http://127.0.0.1:3001", 2, &document.document_id)
            .is_err(),
        "Release policy must reject HTTP even on loopback"
    );
    control
        .configure("valid_https_wss_reconnect", json!({"mode":"pass"}))
        .await;
    let instance = request(&transport, &handle, "/instance", "GET", None, 200).await;
    assert!(
        instance.payload["registrationOpen"] == true,
        "An explicitly disposable registration-enabled instance is required"
    );
    let login = json!({"email":fixture.account.email,"password":fixture.account.password});
    let mut registration = login.clone();
    registration["displayName"] = json!(fixture.account.display_name);
    registration["handle"] = json!(fixture.account.handle);
    let signed_in = request(
        &transport,
        &handle,
        "/auth/register",
        "POST",
        Some(registration),
        201,
    )
    .await;
    assert!(
        signed_in.payload["user"].is_object(),
        "Real registration must return a user"
    );
    assert!(
        signed_in.payload.get("accessToken").is_none(),
        "The production mediator must keep bearer credentials out of its caller DTO"
    );
    let community = request(
        &transport,
        &handle,
        "/communities",
        "POST",
        Some(json!({"name":"Native TLS acceptance"})),
        201,
    )
    .await;
    let channel = community.payload["community"]["channels"][0]["id"]
        .as_str()
        .expect("The real community did not create its text channel");
    let path = format!("/channels/{channel}/messages");
    let mut ids = Vec::new();
    for index in 0..2 {
        let mut events = Events::open(transport.clone(), &handle).await;
        let sent = request(&transport, &handle, &path, "POST", Some(json!({"content":format!("TLS committed message {index}"),"clientId":Uuid::new_v4().to_string()})), 201).await;
        let id = sent.payload["message"]["id"]
            .as_str()
            .expect("The real API did not persist its message")
            .to_owned();
        events.wait_message("message.created", Some(&id)).await;
        ids.push(id);
        events.close().await;
    }
    let history = request(
        &transport,
        &handle,
        &format!("{path}?limit=100"),
        "GET",
        None,
        200,
    )
    .await;
    assert!(
        ids.iter().all(|id| history.payload["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["id"] == *id)),
        "HTTPS history must preserve both messages across real WSS reconnection"
    );
    let stats = control.state().await;
    assert_eq!(stats.ticket_successes, 2);
    assert_eq!(stats.upstream_upgrade_requests, 2);
    assert_eq!(stats.tls_failures, 0);
    no_redirect_contact(&stats);
    passed("valid_https_wss_reconnect");

    for (kind, origin) in [
        ("untrusted", &fixture.invalid_origins.untrusted),
        ("expired", &fixture.invalid_origins.expired),
        ("hostname", &fixture.invalid_origins.hostname),
    ] {
        control
            .configure(&format!("https_{kind}"), json!({"mode":"pass"}))
            .await;
        let (invalid, invalid_handle) = selected(origin);
        let failure = invalid
            .request(
                &invalid_handle,
                "/auth/login",
                Some("POST"),
                Some(&login.to_string()),
            )
            .await
            .err()
            .expect("Invalid HTTPS certificate was accepted");
        assert_eq!(failure.code, "unreachable");
        let stats = control.tls_rejection().await;
        assert!(
            stats.new_tls_connections >= 1 && stats.tls_failures >= 1,
            "HTTPS rejection must follow an actual TLS handshake"
        );
        assert_eq!(
            stats.proxy_requests, 0,
            "An invalid TLS endpoint received an HTTP payload"
        );
        assert_eq!(stats.upstream_requests, 0);
        no_redirect_contact(&stats);
        invalid.dispose(&invalid_handle);
        passed(&format!("https_{kind}"));
    }

    for kind in ["untrusted", "expired", "hostname"] {
        control
            .configure(&format!("wss_{kind}"), json!({"mode":format!("ws-{kind}")}))
            .await;
        let (sender, mut receiver) = mpsc::channel(64);
        let failure = transport
            .events(
                &handle,
                Arc::new(move |event| sender.try_send(event).map_err(|_| ())),
            )
            .await
            .err()
            .expect("Invalid WSS certificate was accepted after ticket acquisition");
        assert_eq!(failure.code, "unreachable");
        assert!(
            receiver.try_recv().is_err(),
            "Rejected WSS must never expose an open stream or payload"
        );
        let stats = control.tls_rejection().await;
        assert_eq!(
            stats.ticket_successes, 1,
            "The native HTTPS ticket must succeed before the WSS negative"
        );
        assert!(
            stats.new_tls_connections >= 1 && stats.tls_failures >= 1,
            "WSS must attempt its own TLS handshake"
        );
        assert_eq!(
            stats.proxy_requests, 1,
            "Only the valid HTTPS ticket request may reach the TLS proxy"
        );
        assert_eq!(stats.upstream_requests, 1);
        assert_eq!(stats.upgrade_requests, 0);
        assert_eq!(stats.upstream_upgrade_requests, 0);
        no_redirect_contact(&stats);
        passed(&format!("wss_{kind}"));
    }

    for (status, target) in [(307, "https"), (308, "http")] {
        for (label, route, method, body) in [
            ("password", "/auth/login", "POST", Some(login.clone())),
            ("bearer", "/bootstrap", "GET", None),
        ] {
            control.configure(&format!("https_redirect_{status}_{label}"), json!({"mode":"http-redirect","status":status,"target":target,"path":format!("/api/v1{route}")})).await;
            let temporary;
            let (client, active_handle) = if label == "password" {
                temporary = selected(&fixture.valid_origin);
                (&temporary.0, temporary.1.as_str())
            } else {
                (&transport, handle.as_str())
            };
            let serialized = body.map(|value| value.to_string());
            let failure = client
                .request(active_handle, route, Some(method), serialized.as_deref())
                .await
                .err()
                .expect("The native HTTPS client followed an authentication redirect");
            assert_eq!(failure.code, "invalid_response");
            assert_eq!(failure.status, 502);
            let stats = control.state().await;
            assert_eq!(stats.proxy_requests, 1);
            assert_eq!(stats.upstream_requests, 0);
            no_redirect_contact(&stats);
            if label == "password" {
                client.dispose(active_handle);
            }
            passed(&format!("https_redirect_{status}_{label}"));
        }
        control
            .configure(
                &format!("wss_redirect_{status}"),
                json!({"mode":"ws-redirect","status":status,"target":target}),
            )
            .await;
        let (sender, mut receiver) = mpsc::channel(64);
        let failure = transport
            .events(
                &handle,
                Arc::new(move |event| sender.try_send(event).map_err(|_| ())),
            )
            .await
            .err()
            .expect("The native WSS client followed its ticket redirect");
        assert_eq!(failure.code, "unreachable");
        assert!(receiver.try_recv().is_err());
        let stats = control.state().await;
        assert_eq!(stats.ticket_successes, 1);
        assert_eq!(stats.upgrade_requests, 1);
        assert_eq!(stats.upstream_upgrade_requests, 0);
        assert_eq!(stats.proxy_requests, 2);
        no_redirect_contact(&stats);
        passed(&format!("wss_redirect_{status}"));
    }
    control
        .configure("final_authenticated_logout", json!({"mode":"pass"}))
        .await;
    request(&transport, &handle, "/bootstrap", "GET", None, 200).await;
    request(&transport, &handle, "/auth/logout", "POST", None, 204).await;
    transport.dispose(&handle);
    passed("final_authenticated_logout");
}
