use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{extract::DefaultBodyLimit, middleware, routing::get, Json, Router};
use rmcp::{
    model::ResourceUpdatedNotificationParam,
    service::Peer,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    RoleServer,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{sync::Semaphore, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use super::{
    audit::AuditWriter,
    auth::{hash_token, RateLimiter},
    bridge::{BridgeHub, BridgeProgress, McpBridgeResponse, McpClientInfo},
    credentials::{load_or_create_token, workspace_key},
    error::{McpResult, McpRuntimeError},
    manifest::McpManifest,
    server::NovelsServer,
};

const DEFAULT_PORT: u16 = 38471;
const MAX_PORT: u16 = 38480;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_CONCURRENT_CALLS: usize = 8;
const CLIENT_RETENTION_MS: u128 = 30 * 60 * 1_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientStatus {
    pub name: String,
    pub version: Option<String>,
    pub title: Option<String>,
    pub connected_at: u128,
    pub last_seen_at: u128,
}

struct ConnectedClient {
    peer: Peer<RoleServer>,
    status: McpClientStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub endpoint: Option<String>,
    pub port: Option<u16>,
    pub token: Option<String>,
    pub access_level: String,
    pub protocol_version: String,
    pub compatible_versions: Vec<String>,
    pub started_at: Option<u128>,
    pub workspace_session_id: Option<String>,
    pub tool_count: usize,
    pub resource_count: usize,
    pub prompt_count: usize,
    pub active_calls: usize,
    pub connected_clients: usize,
    pub clients: Vec<McpClientStatus>,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self {
            running: false,
            endpoint: None,
            port: None,
            token: None,
            access_level: "read".into(),
            protocol_version: "2026-07-28".into(),
            compatible_versions: vec!["2026-07-28".into(), "2025-11-25".into()],
            started_at: None,
            workspace_session_id: None,
            tool_count: 0,
            resource_count: 0,
            prompt_count: 0,
            active_calls: 0,
            connected_clients: 0,
            clients: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartRequest {
    pub root: String,
    pub manifest: McpManifest,
    #[serde(default)]
    pub rotate_token: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigureRequest {
    pub manifest: McpManifest,
}

#[derive(Debug, Deserialize)]
pub struct McpProgressRequest {
    pub request_id: String,
    pub progress: f64,
    #[serde(default)]
    pub total: Option<f64>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResourceChangeRequest {
    pub uris: Vec<String>,
}

pub struct RuntimeShared {
    pub port: u16,
    pub token_hash: String,
    pub manifest: RwLock<McpManifest>,
    pub bridge: Arc<BridgeHub>,
    pub app: AppHandle,
    pub audit: Arc<AuditWriter>,
    pub workspace_session_id: String,
    clients: Mutex<HashMap<String, ConnectedClient>>,
    pub semaphore: Arc<Semaphore>,
    pub rate_limiter: RateLimiter,
    pub shutdown: CancellationToken,
    pub status: RwLock<McpStatus>,
}

impl RuntimeShared {
    pub fn current_manifest(&self) -> McpManifest {
        self.manifest
            .read()
            .expect("MCP manifest lock poisoned")
            .clone()
    }

    pub fn register_client(&self, peer: Peer<RoleServer>, client_info: McpClientInfo) {
        let now = now_ms();
        let name = client_info
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "unknown".into());
        let key = format!(
            "{}:{}:{}",
            name,
            client_info.version.as_deref().unwrap_or(""),
            client_info.title.as_deref().unwrap_or("")
        );
        let mut clients = self.clients.lock().expect("MCP client lock poisoned");
        clients.retain(|_, client| {
            now.saturating_sub(client.status.last_seen_at) < CLIENT_RETENTION_MS
        });
        if let Some(client) = clients.get_mut(&key) {
            client.peer = peer;
            client.status.last_seen_at = now;
            if client_info.version.is_some() {
                client.status.version = client_info.version;
            }
            if client_info.title.is_some() {
                client.status.title = client_info.title;
            }
        } else {
            clients.insert(
                key,
                ConnectedClient {
                    peer,
                    status: McpClientStatus {
                        name,
                        version: client_info.version,
                        title: client_info.title,
                        connected_at: now,
                        last_seen_at: now,
                    },
                },
            );
        }
        drop(clients);
        let _ = self
            .app
            .emit("mcp:clients-changed", serde_json::json!({}));
    }

    pub fn client_statuses(&self) -> Vec<McpClientStatus> {
        let now = now_ms();
        let mut clients = self.clients.lock().expect("MCP client lock poisoned");
        clients.retain(|_, client| {
            now.saturating_sub(client.status.last_seen_at) < CLIENT_RETENTION_MS
        });
        let mut statuses = clients
            .values()
            .map(|client| client.status.clone())
            .collect::<Vec<_>>();
        statuses.sort_by(|left, right| right.last_seen_at.cmp(&left.last_seen_at));
        statuses
    }

    pub async fn notify_manifest_changed(&self) {
        let clients = self
            .clients
            .lock()
            .expect("MCP client lock poisoned")
            .values()
            .map(|client| client.peer.clone())
            .collect::<Vec<_>>();
        for peer in clients {
            let _ = peer.notify_tool_list_changed().await;
            let _ = peer.notify_resource_list_changed().await;
            let _ = peer.notify_prompt_list_changed().await;
        }
    }

    pub async fn notify_resource_changed(&self, uri: &str) {
        let clients = self
            .clients
            .lock()
            .expect("MCP client lock poisoned")
            .values()
            .map(|client| client.peer.clone())
            .collect::<Vec<_>>();
        for peer in clients {
            let _ = peer
                .notify_resource_updated(ResourceUpdatedNotificationParam::new(uri))
                .await;
        }
    }
}

struct RuntimeHandle {
    shared: Arc<RuntimeShared>,
    join: JoinHandle<()>,
}

#[derive(Default)]
pub struct McpManager {
    inner: Mutex<Option<RuntimeHandle>>,
}

impl McpManager {
    fn shared(&self) -> Option<Arc<RuntimeShared>> {
        self.inner
            .lock()
            .expect("MCP manager lock poisoned")
            .as_ref()
            .map(|handle| handle.shared.clone())
    }

    async fn stop(&self) {
        let handle = self.inner.lock().expect("MCP manager lock poisoned").take();
        let Some(handle) = handle else {
            return;
        };
        handle.shared.shutdown.cancel();
        for request_id in handle.shared.bridge.cancel_all() {
            let _ = handle.shared.app.emit(
                "mcp:cancel",
                serde_json::json!({ "request_id": request_id }),
            );
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), handle.join).await;
    }
}

#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    manager: State<'_, McpManager>,
    request: McpStartRequest,
) -> Result<McpStatus, String> {
    if let Err(error) = request.manifest.validate() {
        return Err(McpRuntimeError::Manifest(error).to_string());
    }
    manager.stop().await;

    let token = load_or_create_token(&app, &request.root, request.rotate_token)
        .map_err(|error| error.to_string())?;
    let (listener, port) = bind_available_listener()
        .await
        .map_err(|error| McpRuntimeError::Start(error).to_string())?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let started_at = now_ms();
    let audit_path = audit_path(&app, &request.root).ok();
    let audit = Arc::new(AuditWriter::new(audit_path));
    let shutdown = CancellationToken::new();
    let status = build_status(
        port,
        token.clone(),
        &request.manifest,
        session_id.clone(),
        started_at,
    );
    let shared = Arc::new(RuntimeShared {
        port,
        token_hash: hash_token(&token),
        manifest: RwLock::new(request.manifest),
        bridge: Arc::new(BridgeHub::default()),
        app: app.clone(),
        audit,
        workspace_session_id: session_id,
        clients: Mutex::new(HashMap::new()),
        semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_CALLS)),
        rate_limiter: RateLimiter::default(),
        shutdown: shutdown.clone(),
        status: RwLock::new(status.clone()),
    });

    let server_shared = shared.clone();
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_sse_keep_alive(None)
        .with_cancellation_token(shutdown.child_token());
    let service: StreamableHttpService<NovelsServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(NovelsServer::new(server_shared.clone())),
            Default::default(),
            config,
        );
    let auth_shared = shared.clone();
    let mcp_router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            auth_shared,
            super::auth::authorize_request,
        ))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES));
    let router = Router::new()
        .route("/healthz", get(healthz))
        .merge(mcp_router);
    let graceful = shutdown.clone();
    let join = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async move { graceful.cancelled_owned().await })
            .await
        {
            log::error!("MCP HTTP server stopped with error: {error}");
        }
    });

    *manager.inner.lock().expect("MCP manager lock poisoned") = Some(RuntimeHandle {
        shared: shared.clone(),
        join,
    });
    log::info!(
        "MCP server started on port {} with {} tools",
        port,
        status.tool_count
    );
    Ok(status)
}

#[tauri::command]
pub async fn mcp_stop(manager: State<'_, McpManager>) -> Result<(), String> {
    manager.stop().await;
    Ok(())
}

#[tauri::command]
pub fn mcp_status(manager: State<'_, McpManager>) -> McpStatus {
    let Some(shared) = manager.shared() else {
        return McpStatus::default();
    };
    let mut status = shared
        .status
        .read()
        .expect("MCP status lock poisoned")
        .clone();
    status.active_calls = shared.bridge.active_count();
    status.clients = shared.client_statuses();
    status.connected_clients = status.clients.len();
    status
}

#[tauri::command]
pub async fn mcp_configure(
    manager: State<'_, McpManager>,
    request: McpConfigureRequest,
) -> Result<McpStatus, String> {
    request
        .manifest
        .validate()
        .map_err(|error| McpRuntimeError::Manifest(error).to_string())?;
    let Some(shared) = manager.shared() else {
        return Err(McpRuntimeError::NotRunning.to_string());
    };
    let next_status = {
        let mut manifest = shared.manifest.write().expect("MCP manifest lock poisoned");
        *manifest = request.manifest;
        let mut status = shared.status.write().expect("MCP status lock poisoned");
        status.access_level = manifest.access_level.clone();
        status.tool_count = manifest.tools_for_permission().count();
        status.resource_count = manifest.resources_for_permission().count();
        status.prompt_count = manifest.prompts.len();
        status.clone()
    };
    for request_id in shared.bridge.cancel_disallowed(&next_status.access_level) {
        let _ = shared.app.emit(
            "mcp:cancel",
            serde_json::json!({ "request_id": request_id }),
        );
    }
    shared.notify_manifest_changed().await;
    Ok(next_status)
}

#[tauri::command]
pub fn mcp_bridge_respond(
    manager: State<'_, McpManager>,
    response: McpBridgeResponse,
) -> Result<bool, String> {
    let shared = manager
        .shared()
        .ok_or_else(|| McpRuntimeError::NotRunning.to_string())?;
    Ok(shared.bridge.respond(response))
}

#[tauri::command]
pub fn mcp_bridge_progress(
    manager: State<'_, McpManager>,
    request: McpProgressRequest,
) -> Result<bool, String> {
    let shared = manager
        .shared()
        .ok_or_else(|| McpRuntimeError::NotRunning.to_string())?;
    Ok(shared.bridge.progress(
        &request.request_id,
        BridgeProgress {
            progress: request.progress,
            total: request.total,
            message: request.message,
        },
    ))
}

#[tauri::command]
pub fn mcp_bridge_cancel(
    manager: State<'_, McpManager>,
    request_id: String,
) -> Result<bool, String> {
    let shared = manager
        .shared()
        .ok_or_else(|| McpRuntimeError::NotRunning.to_string())?;
    let cancelled = shared.bridge.cancel(&request_id);
    if cancelled {
        let _ = shared.app.emit(
            "mcp:cancel",
            serde_json::json!({ "request_id": request_id }),
        );
    }
    Ok(cancelled)
}

#[tauri::command]
pub async fn mcp_notify_resources_changed(
    manager: State<'_, McpManager>,
    request: ResourceChangeRequest,
) -> Result<(), String> {
    let Some(shared) = manager.shared() else {
        return Ok(());
    };
    for uri in request.uris {
        shared.notify_resource_changed(&uri).await;
    }
    Ok(())
}

async fn healthz() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "protocol_versions": ["2026-07-28", "2025-11-25"],
    }))
}

async fn bind_available_listener() -> Result<(tokio::net::TcpListener, u16), String> {
    for port in DEFAULT_PORT..=MAX_PORT {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok((listener, port)),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(error) => return Err(format!("bind 127.0.0.1:{port} failed: {error}")),
        }
    }
    Err(format!(
        "no available MCP port in {}..={}",
        DEFAULT_PORT, MAX_PORT
    ))
}

fn build_status(
    port: u16,
    token: String,
    manifest: &McpManifest,
    session_id: String,
    started_at: u128,
) -> McpStatus {
    McpStatus {
        running: true,
        endpoint: Some(format!("http://127.0.0.1:{port}/mcp")),
        port: Some(port),
        token: Some(token),
        access_level: manifest.access_level.clone(),
        protocol_version: manifest.protocol_version.clone(),
        compatible_versions: manifest.compatible_versions.clone(),
        started_at: Some(started_at),
        workspace_session_id: Some(session_id),
        tool_count: manifest.tools_for_permission().count(),
        resource_count: manifest.resources_for_permission().count(),
        prompt_count: manifest.prompts.len(),
        active_calls: 0,
        connected_clients: 0,
        clients: Vec::new(),
    }
}

fn audit_path(app: &AppHandle, root: &str) -> McpResult<PathBuf> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|error| McpRuntimeError::Audit(error.to_string()))?;
    Ok(base
        .join("mcp")
        .join("audit")
        .join(format!("{}.jsonl", workspace_key(root))))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
