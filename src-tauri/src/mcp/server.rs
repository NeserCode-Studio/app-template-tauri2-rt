use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use rmcp::{
    model::{
        CallToolRequestMethod, CallToolRequestParams, CallToolResponse, CallToolResult,
        ContentBlock, ErrorData as McpError, GetPromptRequestParams, GetPromptResponse,
        GetPromptResult, Implementation, ListPromptsResult, ListResourceTemplatesResult,
        ListResourcesResult, ListToolsResult, PaginatedRequestParams, ProgressNotificationParam,
        PromptMessage, ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult,
        ResourceContents, Role, ServerCapabilities, ServerConfig, SubscriptionFilter,
    },
    service::{RequestContext, SubscriptionContext},
    RoleServer, ServerHandler,
};
use serde_json::Value;
use tauri::Emitter;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use super::{
    bridge::{
        deadline_for_risk, BridgeWaiter, McpBridgeRequest, McpClientInfo, McpPromptRequest,
        McpResourceRequest,
    },
    runtime::RuntimeShared,
};

#[derive(Clone)]
pub struct NovelsServer {
    shared: Arc<RuntimeShared>,
}

impl NovelsServer {
    pub fn new(shared: Arc<RuntimeShared>) -> Self {
        Self { shared }
    }

    fn client_info(context: &RequestContext<RoleServer>) -> McpClientInfo {
        context
            .client_info()
            .map(|client| McpClientInfo {
                name: Some(client.name),
                version: Some(client.version),
                title: client.title,
            })
            .unwrap_or_else(|| McpClientInfo {
                name: Some("unknown".into()),
                version: None,
                title: None,
            })
    }

    fn tool_error(message: impl Into<String>) -> CallToolResponse {
        CallToolResponse::Complete(CallToolResult::error(vec![ContentBlock::text(
            message.into(),
        )]))
    }

    async fn wait_bridge(
        &self,
        waiter: BridgeWaiter,
        timeout: Duration,
        cancellation: CancellationToken,
        progress_token: Option<rmcp::model::ProgressToken>,
        context: &RequestContext<RoleServer>,
    ) -> Result<super::bridge::McpBridgeResponse, &'static str> {
        let deadline = sleep(timeout);
        tokio::pin!(deadline);
        let mut response_rx = waiter.response_rx;
        let mut progress_rx = waiter.progress_rx;
        loop {
            tokio::select! {
                _ = &mut deadline => return Err("timeout"),
                _ = cancellation.cancelled() => return Err("cancelled"),
                maybe_progress = progress_rx.recv() => {
                    if let (Some(progress), Some(token)) = (maybe_progress, progress_token.clone()) {
                        let mut notification = ProgressNotificationParam::new(token, progress.progress);
                        if let Some(total) = progress.total {
                            notification = notification.with_total(total);
                        }
                        if let Some(message) = progress.message {
                            notification = notification.with_message(message);
                        }
                        let _ = context.peer.notify_progress(notification).await;
                    }
                }
                result = &mut response_rx => {
                    return result.map_err(|_| "cancelled");
                }
            }
        }
    }
}

impl ServerHandler for NovelsServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .enable_resources()
                .enable_resources_list_changed()
                .enable_resources_subscribe()
                .enable_prompts()
                .enable_prompts_list_changed()
                .build(),
        )
        .with_server_info(Implementation::new("novels-yes", env!("CARGO_PKG_VERSION")))
        .with_instructions(
            "novels-yes exposes the currently open writing workspace. Read resources before writing, use expected_revision for chapter writes, and expect session-boundary operations to require user confirmation.",
        )
    }

    fn accepted_subscription_filter(
        &self,
        requested: &SubscriptionFilter,
    ) -> Option<SubscriptionFilter> {
        Some(requested.clone())
    }

    async fn listen(&self, context: SubscriptionContext) -> Result<(), McpError> {
        context.cancelled().await;
        Ok(())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info);
        let manifest = self.shared.current_manifest();
        let tools = manifest
            .tools_for_permission()
            .filter_map(|tool| manifest.rmcp_tool(&tool.name))
            .collect();
        Ok(ListToolsResult::with_all_items(tools))
    }

    fn get_tool(&self, name: &str) -> Option<rmcp::model::Tool> {
        self.shared.current_manifest().rmcp_tool(name)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info.clone());
        let tool_name = request.name.to_string();
        let manifest = self.shared.current_manifest();
        let Some(tool) = manifest.tool(&tool_name) else {
            return Err(McpError::method_not_found::<CallToolRequestMethod>());
        };
        if !super::manifest::permission_allows(&manifest.access_level, &tool.permission) {
            return Ok(Self::tool_error(format!(
                "permission_denied: {} requires {} access",
                tool_name, tool.permission
            )));
        }
        let permit = match self.shared.semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(_) => {
                return Ok(Self::tool_error(
                    "operation_failed: MCP concurrency limiter is unavailable",
                ))
            }
        };
        let request_id = uuid::Uuid::new_v4().to_string();
        let waiter = self.shared.bridge.register(&request_id, &tool.permission);
        let timeout = deadline_for_risk(&tool.risk);
        let payload = McpBridgeRequest {
            request_id: request_id.clone(),
            tool_name: tool_name.clone(),
            arguments: Value::Object(request.arguments.unwrap_or_default()),
            client_info: client_info.clone(),
            deadline_ms: timeout.as_millis() as u64,
            workspace_session_id: self.shared.workspace_session_id.clone(),
            risk: tool.risk.clone(),
            permission: tool.permission.clone(),
        };
        if let Err(error) = self.shared.app.emit("mcp:tool-call", &payload) {
            self.shared.bridge.cancel(&request_id);
            drop(permit);
            return Ok(Self::tool_error(format!(
                "bridge_unavailable: failed to reach the application WebView ({error})"
            )));
        }

        let progress_token = request
            .meta
            .as_ref()
            .and_then(|meta| meta.get_progress_token());
        let started_at = Instant::now();
        let response = self
            .wait_bridge(
                waiter,
                timeout,
                context.ct.clone(),
                progress_token,
                &context,
            )
            .await;
        drop(permit);

        let duration_ms = started_at.elapsed().as_millis();
        let client_name = client_info
            .name
            .unwrap_or_else(|| "unknown".into());
        match response {
            Ok(response) => {
                self.shared.audit.record_tool(
                    &request_id,
                    &client_name,
                    &tool_name,
                    &payload.arguments,
                    if response.ok { "ok" } else { "error" },
                    duration_ms,
                );
                let content = response
                    .content
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|item| ContentBlock::text(item.text))
                    .collect::<Vec<_>>();
                let mut result = if response.is_error.unwrap_or(!response.ok) {
                    CallToolResult::error(content)
                } else {
                    CallToolResult::success(content)
                };
                if let Some(structured) = response.structured_content.or(response.data) {
                    result.structured_content = Some(structured);
                }
                Ok(CallToolResponse::Complete(result))
            }
            Err(reason) => {
                self.shared.bridge.cancel(&request_id);
                let _ = self.shared.app.emit(
                    "mcp:cancel",
                    serde_json::json!({ "request_id": request_id.clone() }),
                );
                self.shared.audit.record_tool(
                    &request_id,
                    &client_name,
                    &tool_name,
                    &payload.arguments,
                    reason,
                    duration_ms,
                );
                let message = match reason {
                    "timeout" => {
                        "operation_failed: the application did not finish the MCP call before its deadline"
                    }
                    "cancelled" => "cancelled: the MCP call was cancelled",
                    _ => "operation_failed: the MCP bridge stopped unexpectedly",
                };
                Ok(Self::tool_error(message))
            }
        }
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info);
        Ok(ListResourcesResult::with_all_items(
            self.shared.current_manifest().rmcp_resources(),
        ))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info);
        Ok(ListResourceTemplatesResult::with_all_items(
            self.shared.current_manifest().rmcp_resource_templates(),
        ))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info.clone());
        if !request.uri.starts_with("novels://") || request.uri.len() > 2_000 {
            return Err(McpError::resource_not_found(
                "resource URI is not supported",
                None,
            ));
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let waiter = self.shared.bridge.register(&request_id, "read");
        let payload = McpResourceRequest {
            request_id: request_id.clone(),
            uri: request.uri.clone(),
            client_info,
            workspace_session_id: self.shared.workspace_session_id.clone(),
        };
        if self.shared.app.emit("mcp:resource-read", &payload).is_err() {
            self.shared.bridge.cancel(&request_id);
            return Err(McpError::internal_error(
                "the application WebView is unavailable",
                None,
            ));
        }
        let response = match self
            .wait_bridge(
                waiter,
                Duration::from_secs(60),
                context.ct.clone(),
                None,
                &context,
            )
            .await
        {
            Ok(response) => response,
            Err(reason) => {
                self.shared.bridge.cancel(&request_id);
                let _ = self.shared.app.emit(
                    "mcp:cancel",
                    serde_json::json!({ "request_id": request_id }),
                );
                return Err(McpError::internal_error(reason, None));
            }
        };
        if !response.ok {
            self.shared.bridge.cancel(&request_id);
            return Err(McpError::resource_not_found(
                response
                    .error
                    .map(|error| error.message)
                    .unwrap_or_else(|| "resource could not be read".into()),
                None,
            ));
        }
        let data = response.data.unwrap_or(Value::Null);
        let uri = data
            .get("uri")
            .and_then(Value::as_str)
            .unwrap_or(&request.uri)
            .to_string();
        let text = data
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(&data).unwrap_or_else(|_| "{}".into()));
        let mime_type = data
            .get("mimeType")
            .and_then(Value::as_str)
            .unwrap_or("application/json");
        Ok(ReadResourceResponse::Complete(ReadResourceResult::new(
            vec![ResourceContents::text(text, uri).with_mime_type(mime_type)],
        )))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info);
        Ok(ListPromptsResult::with_all_items(
            self.shared.current_manifest().rmcp_prompts(),
        ))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, McpError> {
        let client_info = Self::client_info(&context);
        self.shared
            .register_client(context.peer.clone(), client_info.clone());
        let manifest = self.shared.current_manifest();
        if manifest.prompt(&request.name).is_none() {
            return Err(McpError::invalid_params("unknown prompt", None));
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let waiter = self.shared.bridge.register(&request_id, "read");
        let payload = McpPromptRequest {
            request_id: request_id.clone(),
            prompt_name: request.name.clone(),
            arguments: Value::Object(request.arguments.unwrap_or_default()),
            client_info,
            workspace_session_id: self.shared.workspace_session_id.clone(),
        };
        if self.shared.app.emit("mcp:prompt-get", &payload).is_err() {
            self.shared.bridge.cancel(&request_id);
            return Err(McpError::internal_error(
                "the application WebView is unavailable",
                None,
            ));
        }
        let response = match self
            .wait_bridge(
                waiter,
                Duration::from_secs(60),
                context.ct.clone(),
                None,
                &context,
            )
            .await
        {
            Ok(response) => response,
            Err(reason) => {
                self.shared.bridge.cancel(&request_id);
                let _ = self.shared.app.emit(
                    "mcp:cancel",
                    serde_json::json!({ "request_id": request_id }),
                );
                return Err(McpError::internal_error(reason, None));
            }
        };
        if !response.ok {
            self.shared.bridge.cancel(&request_id);
            return Err(McpError::invalid_params(
                response
                    .error
                    .map(|error| error.message)
                    .unwrap_or_else(|| "prompt could not be expanded".into()),
                None,
            ));
        }
        let data = response.data.unwrap_or(Value::Null);
        let description = data
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("novels-yes prompt");
        let messages = data
            .get("messages")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let text = item.get("text")?.as_str()?;
                        Some(PromptMessage::new_text(Role::User, text))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| {
                vec![PromptMessage::new_text(
                    Role::User,
                    data.get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("Continue the requested writing task."),
                )]
            });
        Ok(GetPromptResponse::Complete(
            GetPromptResult::new(messages).with_description(description),
        ))
    }
}
