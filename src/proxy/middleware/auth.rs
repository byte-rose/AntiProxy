// API Key 认证中间件
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

/// API Key 认证中间件
/// 支持多 key 认证：先检查多 key 数据库，再回退到配置文件中的单一 key
pub async fn auth_middleware(
    State(security): State<Arc<RwLock<ProxySecurityConfig>>>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    // 过滤心跳和健康检查请求,避免日志噪音
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

    if matches!(effective_mode, ProxyAuthMode::Off) {
        return Ok(next.run(request).await);
    }

    if matches!(effective_mode, ProxyAuthMode::AllExceptHealth) && path == "/healthz" {
        return Ok(next.run(request).await);
    }

    // 从 header 中提取 API key
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

    let Some(key_str) = api_key else {
        tracing::warn!("No API key provided in request");
        return Err(StatusCode::UNAUTHORIZED);
    };

    // 首先尝试从多 key 数据库验证
    match crate::modules::api_keys::find_by_key(&key_str) {
        Ok(Some(api_key_record)) => {
            if !api_key_record.enabled {
                tracing::warn!("API key is disabled: {}", api_key_record.name);
                return Err(StatusCode::UNAUTHORIZED);
            }
            tracing::debug!("Authenticated via multi-key: {}", api_key_record.name);
            // 将 key ID 存入请求扩展，供后续用量统计使用
            request.extensions_mut().insert(AuthenticatedKey {
                key: key_str,
                key_id: api_key_record.id,
                key_name: api_key_record.name,
            });
            return Ok(next.run(request).await);
        }
        Ok(None) => {
            // 多 key 数据库中没有找到，回退到配置文件中的单一 key
        }
        Err(e) => {
            tracing::error!("Failed to query API keys database: {}", e);
            // 数据库错误时回退到配置文件
        }
    }

    // 回退：检查配置文件中的单一 key
    if security.api_key.is_empty() {
        tracing::error!("Proxy auth is enabled but no API keys configured; denying request");
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 检查是否匹配配置文件中的单一 key
    if key_str == security.api_key {
        request.extensions_mut().insert(AuthenticatedKey {
            key: key_str,
            key_id: "legacy".to_string(),
            key_name: "Legacy Config Key".to_string(),
        });
        return Ok(next.run(request).await);
    }

    Err(StatusCode::UNAUTHORIZED)
}

/// 已认证的 API Key 信息（存储在请求扩展中）
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
    // 移除未使用的 use super::*;

    #[test]
    fn test_auth_placeholder() {
        // Placeholder test
        assert!(true);
    }
}
