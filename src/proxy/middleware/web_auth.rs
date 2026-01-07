//! Web UI authentication middleware
//!
//! Protects Web UI routes, requires Passkey authentication to access

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
};

use crate::proxy::server::AppState;

const SESSION_COOKIE_NAME: &str = "antiproxy_session";

/// Path prefixes that need protection
fn is_protected_path(path: &str) -> bool {
    // Admin API requires authentication
    if path.starts_with("/api/") {
        // Auth-related APIs don't need protection
        if path.starts_with("/api/auth/") {
            return false;
        }
        // OAuth callback doesn't need protection (need to add account before setting up passkey)
        if path.starts_with("/api/oauth/") {
            return false;
        }
        return true;
    }

    // Static assets don't need protection
    if is_static_asset(path) {
        return false;
    }

    // Login page doesn't need protection
    if path == "/login.html" || path == "/login" {
        return false;
    }

    // OAuth callback page
    if path == "/oauth-callback" {
        return false;
    }

    // Health check
    if path == "/healthz" {
        return false;
    }

    // API protocol endpoints don't need Web UI authentication (they have their own API Key authentication)
    if path.starts_with("/v1/") || path.starts_with("/v1beta/") {
        return false;
    }

    // Other paths (homepage, etc.) require authentication
    true
}

/// Check if the path is a static asset
fn is_static_asset(path: &str) -> bool {
    // HTML files are not static assets - they need authentication protection
    if path.ends_with(".html") {
        return false;
    }

    if path == "/favicon.ico" {
        return true;
    }

    if path.starts_with("/assets/") {
        return true;
    }

    matches!(
        path.rsplit('.').next(),
        Some("css") | Some("js") | Some("png") | Some("svg") | Some("jpg") | Some("jpeg") | Some("webp") | Some("ico") | Some("woff") | Some("woff2") | Some("ttf")
    )
}

/// Extract session token from Cookie
fn extract_session_token(request: &Request) -> Option<String> {
    let cookie_header = request.headers().get(header::COOKIE)?;
    let cookie_str = cookie_header.to_str().ok()?;

    for cookie in cookie_str.split(';') {
        let cookie = cookie.trim();
        if let Some(value) = cookie.strip_prefix(&format!("{}=", SESSION_COOKIE_NAME)) {
            return Some(value.to_string());
        }
    }

    None
}

/// Web UI authentication middleware
pub async fn web_auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();

    tracing::debug!("web_auth_middleware: checking path = {}", path);

    // Check if protection is needed
    if !is_protected_path(&path) {
        tracing::debug!("web_auth_middleware: path {} is not protected, allowing", path);
        return next.run(request).await;
    }

    tracing::debug!("web_auth_middleware: path {} is protected, checking session", path);

    let session_manager = &state.session_manager;

    // Check session
    if let Some(token) = extract_session_token(&request) {
        if session_manager.validate_session(&token).await {
            // Session is valid, refresh and continue
            session_manager.refresh_session(&token).await;
            tracing::debug!("web_auth_middleware: valid session for {}", path);
            return next.run(request).await;
        }
        tracing::debug!("web_auth_middleware: invalid session token for {}", path);
    } else {
        tracing::debug!("web_auth_middleware: no session cookie for {}", path);
    }

    // Unauthenticated - need to login or set up Passkey
    tracing::info!("web_auth_middleware: unauthenticated access to {}, redirecting to login", path);
    // API requests return 401
    if path.starts_with("/api/") {
        return (
            StatusCode::UNAUTHORIZED,
            [("Content-Type", "application/json")],
            r#"{"error": "Authentication required"}"#,
        )
            .into_response();
    }

    // Web pages redirect to login page
    Redirect::to("/login.html").into_response()
}
