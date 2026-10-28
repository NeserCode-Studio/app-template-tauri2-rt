use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest::{Client, StatusCode};

const KEYRING_SERVICE: &str = "com.novels-yes.app";
const KEYRING_USER: &str = "zhuque-ai-api-key";
const ZHUQUE_ENDPOINT: &str = "https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZhuqueAiError {
    code: String,
    message: String,
}

impl ZhuqueAiError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    fn credential_store(error: impl std::fmt::Display) -> Self {
        log::error!("zhuque credential store failed: {error}");
        Self::new(
            "credential_store",
            "The operating system credential store is unavailable.",
        )
    }
}

impl std::fmt::Display for ZhuqueAiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ZhuqueAiError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZhuqueAiConfig {
    configured: bool,
    masked_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZhuqueLabelsRatio {
    #[serde(rename(deserialize = "0"), default)]
    human: f64,
    #[serde(rename(deserialize = "1"), default)]
    ai: f64,
    #[serde(rename(deserialize = "2"), default)]
    suspected_ai: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZhuqueSegmentLabel {
    text: String,
    label: u8,
    conf: f64,
    order: u32,
    #[serde(default)]
    position: Vec<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ZhuqueUsage {
    #[serde(default)]
    total_tokens: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ZhuqueAiDetection {
    status: String,
    #[serde(default)]
    softmax_confidence: f64,
    #[serde(default)]
    ratio_confidence: f64,
    #[serde(default)]
    labels_ratio: ZhuqueLabelsRatio,
    #[serde(default)]
    segment_labels: Vec<ZhuqueSegmentLabel>,
    usage: Option<ZhuqueUsage>,
    #[serde(default)]
    msg: String,
    makers_models_usage: Option<ZhuqueUsage>,
}

#[derive(Serialize)]
struct ZhuqueRequest<'a> {
    text: &'a str,
    is_merge: bool,
}

#[derive(Deserialize, Default)]
struct ZhuqueErrorResponse {
    #[serde(default)]
    msg: String,
    #[serde(default)]
    message: String,
}

fn credential_entry() -> Result<Entry, ZhuqueAiError> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(ZhuqueAiError::credential_store)
}

fn mask_key(api_key: &str) -> String {
    let chars: Vec<char> = api_key.chars().collect();
    if chars.len() <= 4 {
        return "****".to_string();
    }
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("****{suffix}")
}

fn read_api_key() -> Result<Option<String>, ZhuqueAiError> {
    match credential_entry()?.get_password() {
        Ok(api_key) if !api_key.trim().is_empty() => Ok(Some(api_key)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(ZhuqueAiError::credential_store(error)),
    }
}

fn config_from_key(api_key: Option<&str>) -> ZhuqueAiConfig {
    ZhuqueAiConfig {
        configured: api_key.is_some(),
        masked_key: api_key.map(mask_key),
    }
}

fn validate_api_key(api_key: &str) -> Result<&str, ZhuqueAiError> {
    let trimmed = api_key.trim();
    if trimmed.len() < 8 || trimmed.len() > 512 || trimmed.chars().any(char::is_whitespace) {
        return Err(ZhuqueAiError::new(
            "invalid_key",
            "The API key format is invalid.",
        ));
    }
    Ok(trimmed)
}

fn validate_text(text: &str) -> Result<&str, ZhuqueAiError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ZhuqueAiError::new(
            "invalid_text",
            "There is no text to detect.",
        ));
    }
    Ok(trimmed)
}

fn response_message(body: &str) -> Option<String> {
    let parsed = serde_json::from_str::<ZhuqueErrorResponse>(body).ok()?;
    let message = if !parsed.msg.trim().is_empty() {
        parsed.msg
    } else {
        parsed.message
    };
    let trimmed = message.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(240).collect())
    }
}

#[tauri::command]
pub fn zhuque_ai_config_get() -> Result<ZhuqueAiConfig, ZhuqueAiError> {
    let api_key = read_api_key()?;
    Ok(config_from_key(api_key.as_deref()))
}

#[tauri::command]
pub fn zhuque_ai_config_set(api_key: String) -> Result<ZhuqueAiConfig, ZhuqueAiError> {
    let api_key = validate_api_key(&api_key)?;
    credential_entry()?
        .set_password(api_key)
        .map_err(ZhuqueAiError::credential_store)?;
    Ok(config_from_key(Some(api_key)))
}

#[tauri::command]
pub fn zhuque_ai_config_clear() -> Result<ZhuqueAiConfig, ZhuqueAiError> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(config_from_key(None)),
        Err(error) => Err(ZhuqueAiError::credential_store(error)),
    }
}

#[tauri::command]
pub async fn zhuque_ai_detect(
    text: String,
    is_merge: bool,
) -> Result<ZhuqueAiDetection, ZhuqueAiError> {
    let text = validate_text(&text)?;
    let api_key = read_api_key()?.ok_or_else(|| {
        ZhuqueAiError::new(
            "not_configured",
            "Configure a Zhuque API key in Settings > AI first.",
        )
    })?;
    let payload = serde_json::to_vec(&ZhuqueRequest { text, is_merge }).map_err(|error| {
        log::error!("zhuque request serialization failed: {error}");
        ZhuqueAiError::new("invalid_text", "The detection text could not be encoded.")
    })?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("novels-yes")
        .build()
        .map_err(|error| {
            log::error!("zhuque http client failed: {error}");
            ZhuqueAiError::new("network_error", "Could not create the HTTP client.")
        })?;
    let response = client
        .post(ZHUQUE_ENDPOINT)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|error| {
            log::error!("zhuque request failed: {error}");
            ZhuqueAiError::new("network_error", "Could not reach the detection service.")
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        log::error!("zhuque response read failed: {error}");
        ZhuqueAiError::new("upstream_error", "Could not read the detection response.")
    })?;

    if !status.is_success() {
        let message = response_message(&body);
        log::warn!("zhuque request rejected: status={status}");
        return Err(match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ZhuqueAiError::new(
                "auth_failed",
                message.unwrap_or_else(|| "The API key was rejected.".to_string()),
            ),
            StatusCode::TOO_MANY_REQUESTS => ZhuqueAiError::new(
                "rate_limited",
                message.unwrap_or_else(|| "The detection service is rate limited.".to_string()),
            ),
            _ => ZhuqueAiError::new(
                "upstream_error",
                message.unwrap_or_else(|| "The detection service returned an error.".to_string()),
            ),
        });
    }

    let result = serde_json::from_str::<ZhuqueAiDetection>(&body).map_err(|error| {
        log::error!("zhuque response parse failed: {error}");
        ZhuqueAiError::new(
            "invalid_response",
            "The detection response was not valid JSON.",
        )
    })?;
    if result.status != "success" {
        return Err(ZhuqueAiError::new(
            "upstream_error",
            if result.msg.trim().is_empty() {
                "The detection service did not complete the request.".to_string()
            } else {
                result.msg.chars().take(240).collect()
            },
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_api_key_without_exposing_the_secret() {
        assert_eq!(mask_key("abcdefghijkl"), "****ijkl");
        assert_eq!(mask_key("abc"), "****");
    }

    #[test]
    fn validates_text_bounds() {
        assert!(validate_text("   ").is_err());
        assert_eq!(validate_text(" 正文 ").unwrap(), "正文");
    }

    #[test]
    fn parses_documented_response_fields() {
        let body = r#"{
          "status": "success",
          "softmax_confidence": 0.0019,
          "ratio_confidence": 0,
          "labels_ratio": {"0": 1, "1": 0, "2": 0},
          "segment_labels": [{
            "text": "hello world",
            "label": 0,
            "conf": 0.0019,
            "order": 1,
            "position": [0, 11]
          }],
          "usage": {"total_tokens": 50},
          "msg": "",
          "makers_models_usage": {"total_tokens": 30}
        }"#;
        let parsed = serde_json::from_str::<ZhuqueAiDetection>(body).unwrap();
        assert_eq!(parsed.labels_ratio.human, 1.0);
        assert_eq!(parsed.segment_labels[0].label, 0);
        assert_eq!(parsed.makers_models_usage.unwrap().total_tokens, 30);
    }

    #[test]
    fn serializes_labels_ratio_for_the_frontend() {
        let parsed =
            serde_json::from_str::<ZhuqueLabelsRatio>(r#"{"0": 1, "1": 0, "2": 0}"#).unwrap();
        let value = serde_json::to_value(&parsed).unwrap();

        assert_eq!(value["human"], 1.0);
        assert_eq!(value["ai"], 0.0);
        assert_eq!(value["suspectedAi"], 0.0);
        assert!(value.get("0").is_none());
    }
}
