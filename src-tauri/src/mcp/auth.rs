use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::runtime::RuntimeShared;

const RATE_LIMIT: u32 = 120;
const RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailure {
    MissingToken,
    InvalidToken,
    InvalidHost,
    InvalidOrigin,
    RateLimited,
}

impl AuthFailure {
    pub fn status(self) -> StatusCode {
        match self {
            Self::InvalidHost | Self::InvalidOrigin => StatusCode::FORBIDDEN,
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::MissingToken | Self::InvalidToken => StatusCode::UNAUTHORIZED,
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::MissingToken => "missing bearer token",
            Self::InvalidToken => "invalid bearer token",
            Self::InvalidHost => "host is not allowed",
            Self::InvalidOrigin => "origin is not allowed",
            Self::RateLimited => "too many requests",
        }
    }
}

#[derive(Debug)]
struct RateWindow {
    started_at: Instant,
    count: u32,
}

#[derive(Debug)]
pub struct RateLimiter {
    window: Mutex<RateWindow>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self {
            window: Mutex::new(RateWindow {
                started_at: Instant::now(),
                count: 0,
            }),
        }
    }
}

impl RateLimiter {
    pub fn check(&self) -> bool {
        let mut window = self.window.lock().expect("rate limiter poisoned");
        if window.started_at.elapsed() >= RATE_WINDOW {
            window.started_at = Instant::now();
            window.count = 0;
        }
        if window.count >= RATE_LIMIT {
            return false;
        }
        window.count += 1;
        true
    }
}

pub fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

pub fn validate_host(headers: &HeaderMap, port: u16) -> bool {
    let Some(value) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let expected = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    expected.iter().any(|candidate| value == candidate)
}

pub fn validate_origin(headers: &HeaderMap, port: u16) -> bool {
    let Some(value) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = value.to_str() else {
        return false;
    };
    let exact = [
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        "http://127.0.0.1:1420".to_string(),
        "http://localhost:1420".to_string(),
        "tauri://localhost".to_string(),
        "http://tauri.localhost".to_string(),
        "https://tauri.localhost".to_string(),
    ];
    exact.iter().any(|candidate| origin == candidate)
}

pub fn authorize(
    headers: &HeaderMap,
    port: u16,
    token_hash: &str,
    rate_limiter: &RateLimiter,
) -> Result<(), AuthFailure> {
    if !validate_host(headers, port) {
        return Err(AuthFailure::InvalidHost);
    }
    if !validate_origin(headers, port) {
        return Err(AuthFailure::InvalidOrigin);
    }
    let token = bearer_token(headers).ok_or(AuthFailure::MissingToken)?;
    if hash_token(token) != token_hash {
        return Err(AuthFailure::InvalidToken);
    }
    if !rate_limiter.check() {
        return Err(AuthFailure::RateLimited);
    }
    Ok(())
}

pub async fn authorize_request(
    State(shared): State<Arc<RuntimeShared>>,
    request: Request,
    next: Next,
) -> Response {
    match authorize(
        request.headers(),
        shared.port,
        &shared.token_hash,
        &shared.rate_limiter,
    ) {
        Ok(()) => next.run(request).await,
        Err(error) => {
            log::warn!("MCP request rejected: {:?}", error);
            (error.status(), error.message()).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(host: &str, token: Option<&str>, origin: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_str(host).unwrap());
        if let Some(token) = token {
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
            );
        }
        if let Some(origin) = origin {
            headers.insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
        }
        headers
    }

    #[test]
    fn validates_loopback_hosts() {
        assert!(validate_host(
            &headers("127.0.0.1:38471", None, None),
            38471
        ));
        assert!(validate_host(
            &headers("localhost:38471", None, None),
            38471
        ));
        assert!(!validate_host(
            &headers("evil.example:38471", None, None),
            38471
        ));
    }

    #[test]
    fn rejects_external_origins() {
        assert!(!validate_origin(
            &headers("127.0.0.1:38471", None, Some("http://localhost:6274")),
            38471
        ));
        assert!(validate_origin(
            &headers("127.0.0.1:38471", None, Some("http://localhost:1420")),
            38471
        ));
        assert!(!validate_origin(
            &headers("127.0.0.1:38471", None, Some("https://evil.example")),
            38471
        ));
    }

    #[test]
    fn token_round_trip() {
        let token = generate_token();
        let hash = hash_token(&token);
        let headers = headers("127.0.0.1:38471", Some(&token), None);
        assert!(authorize(&headers, 38471, &hash, &RateLimiter::default()).is_ok());
    }
}
