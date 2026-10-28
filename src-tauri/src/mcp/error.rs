use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpRuntimeError {
    #[error("MCP is not running")]
    NotRunning,
    #[error("MCP start failed: {0}")]
    Start(String),
    #[error("MCP configuration is invalid: {0}")]
    Manifest(String),
    #[error("MCP credentials failed: {0}")]
    Credentials(String),
    #[error("MCP audit failed: {0}")]
    Audit(String),
}

pub type McpResult<T> = Result<T, McpRuntimeError>;
