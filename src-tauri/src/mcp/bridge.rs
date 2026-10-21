use std::time::Duration;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpClientInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpBridgeRequest {
    pub request_id: String,
    pub tool_name: String,
    pub arguments: Value,
    pub client_info: McpClientInfo,
    pub deadline_ms: u64,
    pub workspace_session_id: String,
    pub risk: String,
    pub permission: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpResourceRequest {
    pub request_id: String,
    pub uri: String,
    pub client_info: McpClientInfo,
    pub workspace_session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpPromptRequest {
    pub request_id: String,
    pub prompt_name: String,
    pub arguments: Value,
    pub client_info: McpClientInfo,
    pub workspace_session_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct McpBridgeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BridgeContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct McpBridgeResponse {
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpBridgeError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<BridgeContent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct BridgeProgress {
    pub progress: f64,
    pub total: Option<f64>,
    pub message: Option<String>,
}

pub struct PendingCall {
    response_tx: oneshot::Sender<McpBridgeResponse>,
    progress_tx: mpsc::UnboundedSender<BridgeProgress>,
    permission: String,
}

pub struct BridgeWaiter {
    pub response_rx: oneshot::Receiver<McpBridgeResponse>,
    pub progress_rx: mpsc::UnboundedReceiver<BridgeProgress>,
}

#[derive(Default)]
pub struct BridgeHub {
    pending: DashMap<String, PendingCall>,
}

impl BridgeHub {
    pub fn register(
        &self,
        request_id: impl Into<String>,
        permission: impl Into<String>,
    ) -> BridgeWaiter {
        let request_id = request_id.into();
        let (response_tx, response_rx) = oneshot::channel();
        let (progress_tx, progress_rx) = mpsc::unbounded_channel();
        self.pending.insert(
            request_id,
            PendingCall {
                response_tx,
                progress_tx,
                permission: permission.into(),
            },
        );
        BridgeWaiter {
            response_rx,
            progress_rx,
        }
    }

    pub fn respond(&self, response: McpBridgeResponse) -> bool {
        let Some((_, pending)) = self.pending.remove(&response.request_id) else {
            return false;
        };
        pending.response_tx.send(response).is_ok()
    }

    pub fn progress(&self, request_id: &str, progress: BridgeProgress) -> bool {
        let Some(pending) = self.pending.get(request_id) else {
            return false;
        };
        pending.progress_tx.send(progress).is_ok()
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        self.pending.remove(request_id).is_some()
    }

    pub fn cancel_all(&self) -> Vec<String> {
        let ids = self
            .pending
            .iter()
            .map(|entry| entry.key().clone())
            .collect();
        self.pending.clear();
        ids
    }

    pub fn cancel_disallowed(&self, access_level: &str) -> Vec<String> {
        let ids = self
            .pending
            .iter()
            .filter(|entry| !super::manifest::permission_allows(access_level, &entry.permission))
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        for id in &ids {
            self.pending.remove(id);
        }
        ids
    }

    pub fn active_count(&self) -> usize {
        self.pending.len()
    }
}

pub fn deadline_for_risk(risk: &str) -> Duration {
    match risk {
        "R0" => Duration::from_secs(60),
        "R1" | "R2" => Duration::from_secs(120),
        "R3" => Duration::from_secs(30 * 60),
        _ => Duration::from_secs(120),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn correlates_response_and_progress() {
        let hub = BridgeHub::default();
        let waiter = hub.register("request-1", "read");
        assert!(hub.progress(
            "request-1",
            BridgeProgress {
                progress: 1.0,
                total: Some(2.0),
                message: Some("half".into())
            }
        ));
        assert!(hub.respond(McpBridgeResponse {
            request_id: "request-1".into(),
            ok: true,
            data: Some(Value::String("done".into())),
            ..Default::default()
        }));
        assert_eq!(hub.active_count(), 0);
        let response = waiter.response_rx.await.unwrap();
        assert!(response.ok);
    }

    #[test]
    fn lowering_permission_cancels_only_disallowed_calls() {
        let hub = BridgeHub::default();
        hub.register("read-call", "read");
        hub.register("write-call", "write");
        let cancelled = hub.cancel_disallowed("read");
        assert_eq!(cancelled, vec!["write-call".to_string()]);
        assert_eq!(hub.active_count(), 1);
    }
}
