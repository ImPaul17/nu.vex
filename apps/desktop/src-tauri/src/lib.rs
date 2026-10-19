use nuvex_transport::{
    ApiResponse, Connection, Document, StreamCommand, StreamEvent, Subscription, Transport,
    TransportError,
};
use std::sync::Arc;
use tauri::{
    ipc::Channel,
    webview::{NewWindowResponse, PageLoadEvent},
    Manager, State, WebviewWindow,
};

fn local_url(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let packaged = if cfg!(target_os = "windows") {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none()
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none()
    };
    packaged
        || (cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:5173")
}
fn caller(window: &WebviewWindow) -> Result<(), TransportError> {
    if window.label() == "main" && window.url().is_ok_and(|url| local_url(&url)) {
        return Ok(());
    }
    Err(TransportError {
        status: 403,
        code: "native_caller_denied",
        message: "La conexión nativa sólo está disponible en la ventana principal local.",
    })
}
#[tauri::command]
async fn nuvex_document(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
) -> Result<Document, TransportError> {
    caller(&window)?;
    state.document()
}
#[tauri::command]
async fn nuvex_connect(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
    origin: String,
    order: u64,
    document_id: String,
) -> Result<Connection, TransportError> {
    caller(&window)?;
    state.connect(&origin, order, &document_id)
}
#[tauri::command]
async fn nuvex_request(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
    handle: String,
    path: String,
    method: Option<String>,
    body: Option<String>,
) -> Result<ApiResponse, TransportError> {
    caller(&window)?;
    state
        .request(&handle, &path, method.as_deref(), body.as_deref())
        .await
}
#[tauri::command]
async fn nuvex_events(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
    handle: String,
    channel: Channel<StreamEvent>,
) -> Result<Subscription, TransportError> {
    caller(&window)?;
    state
        .inner()
        .clone()
        .events(
            &handle,
            Arc::new(move |event| channel.send(event).map_err(|_| ())),
        )
        .await
}
#[tauri::command]
async fn nuvex_events_control(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
    handle: String,
    stream_id: String,
    control: StreamCommand,
) -> Result<(), TransportError> {
    caller(&window)?;
    state.control(&handle, &stream_id, control)
}
#[tauri::command]
async fn nuvex_dispose(
    window: WebviewWindow,
    state: State<'_, Arc<Transport>>,
    handle: String,
) -> Result<(), TransportError> {
    caller(&window)?;
    state.dispose(&handle);
    Ok(())
}
pub fn run() {
    let transport = Arc::new(
        Transport::new(cfg!(debug_assertions))
            .expect("Could not initialize secure native networking"),
    );
    tauri::Builder::default()
        .manage(transport)
        .invoke_handler(tauri::generate_handler![
            nuvex_document,
            nuvex_connect,
            nuvex_request,
            nuvex_events,
            nuvex_events_control,
            nuvex_dispose
        ])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("The main window configuration is required");
            let transport = app.state::<Arc<Transport>>().inner().clone();
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(local_url)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .on_page_load(move |_, payload| {
                    if payload.event() == PageLoadEvent::Started {
                        transport.reset();
                    }
                })
                .build()?;
            let transport = app.state::<Arc<Transport>>().inner().clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    transport.reset();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not start the nu.vex desktop window");
}
