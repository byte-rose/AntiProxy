// API Key authentication middleware
use axum::{
    extract::State,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::proxy::{ProxyAuthMode, ProxySecurityConfig};

/// API Key authentication middleware
/// Supports multi-key authentication: first checks multi-key database, then falls back to single key from config file
pub async fn auth_middleware(
    State(security): State<Arc<RwLock<ProxySecurityConfig>>>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    // Filter heartbeat and health check requests to avoid log noise
    if !path.contains("event_logging") && path != "/healthz" {
        tracing::info!("Request: {} {}", method, path);
    } else {
        tracing::trace!("Heartbeat: {} {}", method, path);
    }

    // Allow CORS preflight regardless of auth policy.
    if method == axum::http::Method::OPTIONS {
        return Ok(next.run(request).await);
    }

    if is_static_asset(&path) {
        return Ok(next.run(request).await);
    }

    if path == "/oauth-callback" || path.starts_with("/api/oauth/") {
        return Ok(next.run(request).await);
    }

    let security = security.read().await.clone();
    let effective_mode = security.effective_auth_mode();

    // Extract API key from header (attempt extraction regardless of auth mode for statistics)
    let api_key = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").or(Some(s)))
        .or_else(|| {
            request
                .headers()
                .get("x-api-key")
                .and_then(|h| h.to_str().ok())
        })
        .map(|s| s.to_string());

    // If API key is provided, try to validate and set AuthenticatedKey (for statistics)
    if let Some(ref key_str) = api_key {
        // First try to validate from multi-key database
        match crate::modules::api_keys::find_by_key(key_str) {
            Ok(Some(api_key_record)) => {
                if api_key_record.enabled {
                    tracing::debug!("[Auth] Found valid API key for tracking: {} (id: {})", api_key_record.name, api_key_record.id);
                    request.extensions_mut().insert(AuthenticatedKey {
                        key: key_str.clone(),
                        key_id: api_key_record.id,
                        key_name: api_key_record.name,
                    });
                }
            }
            Ok(None) => {
                // Check if it matches the single key from config file
                if key_str == &security.api_key {
                    tracing::debug!("[Auth] Found legacy config key for tracking");
                    request.extensions_mut().insert(AuthenticatedKey {
                        key: key_str.clone(),
                        key_id: "legacy".to_string(),
                        key_name: "Legacy Config Key".to_string(),
                    });
                }
            }
            Err(e) => {
                tracing::debug!("[Auth] Failed to query API keys database: {}", e);
            }
        }
    }

    // If auth mode is Off, allow through (but AuthenticatedKey is already set for statistics)
    if matches!(effective_mode, ProxyAuthMode::Off) {
        return Ok(next.run(request).await);
    }

    if matches!(effective_mode, ProxyAuthMode::AllExceptHealth) && path == "/healthz" {
        return Ok(next.run(request).await);
    }

    // Auth mode is not Off, need to validate API key
    let Some(_key_str) = api_key else {
        tracing::warn!("No API key provided in request");
        return Err(StatusCode::UNAUTHORIZED);
    };

    // Check if AuthenticatedKey is already set in request extensions
    if request.extensions().get::<AuthenticatedKey>().is_some() {
        // Already validated, allow through
        return Ok(next.run(request).await);
    }

    // API key is invalid
    Err(StatusCode::UNAUTHORIZED)
}

/// Authenticated API Key information (stored in request extensions)
#[derive(Clone, Debug)]
pub struct AuthenticatedKey {
    pub key: String,
    pub key_id: String,
    pub key_name: String,
}

fn is_static_asset(path: &str) -> bool {
    if path == "/" || path == "/index.html" || path == "/favicon.ico" {
        return true;
    }

    if path.starts_with("/assets/") {
        return true;
    }

    matches!(
        path.rsplit('.').next(),
        Some("css") | Some("js") | Some("png") | Some("svg") | Some("jpg") | Some("jpeg") | Some("webp") | Some("ico")
    )
}

#[cfg(test)]
mod tests {
    // Removed unused use super::*;

    #[test]
    fn test_auth_placeholder() {
        // Placeholder test
        assert!(true);
    }
}
