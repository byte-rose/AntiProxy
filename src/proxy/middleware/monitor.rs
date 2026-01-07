use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
    body::Body,
};
use std::time::Instant;
use crate::proxy::server::AppState;
use crate::proxy::monitor::ProxyRequestLog;
use crate::proxy::middleware::AuthenticatedKey;
use serde_json::Value;
use futures::StreamExt;

pub async fn monitor_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    // Extract API key info (for usage tracking)
    let authenticated_key = request.extensions().get::<AuthenticatedKey>().cloned();

    // Check if this is an API path that needs tracking
    let uri = request.uri().to_string();
    let is_api_request = uri.starts_with("/v1/") && !uri.contains("event_logging");

    // Debug log: check if AuthenticatedKey exists
    if is_api_request {
        if let Some(ref auth_key) = authenticated_key {
            tracing::debug!(
                "[Monitor] AuthenticatedKey found: id={}, name={}, key={}...",
                auth_key.key_id,
                auth_key.key_name,
                &auth_key.key.chars().take(12).collect::<String>()
            );
        } else {
            tracing::debug!("[Monitor] No AuthenticatedKey found for API request: {}", uri);
        }
    }

    if !state.monitor.is_enabled() {
        let response = next.run(request).await;
        // Even if monitor is disabled, we still need to record API key usage stats
        if is_api_request {
            if let Some(auth_key) = authenticated_key {
                let success = response.status().is_success();
                tracing::info!(
                    "[Monitor] Recording usage for key: {}... success={}, path={}",
                    &auth_key.key.chars().take(12).collect::<String>(),
                    success,
                    uri
                );
                match crate::modules::api_keys::record_usage(&auth_key.key, success, None, None) {
                    Ok(_) => tracing::debug!("[Monitor] Usage recorded successfully"),
                    Err(e) => tracing::error!("[Monitor] Failed to record usage: {}", e),
                }
            }
        }
        return response;
    }

    let start = Instant::now();
    let method = request.method().to_string();

    if uri.contains("event_logging") {
        return next.run(request).await;
    }

    let mut model = if uri.contains("/v1beta/models/") {
        uri.split("/v1beta/models/")
            .nth(1)
            .and_then(|s| s.split(':').next())
            .map(|s| s.to_string())
    } else {
        None
    };

    let request_body_str;
    let request = if method == "POST" {
        let (parts, body) = request.into_parts();
        match axum::body::to_bytes(body, 1024 * 1024).await {
            Ok(bytes) => {
                if model.is_none() {
                    model = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v|
                        v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string())
                    );
                }
                request_body_str = if let Ok(s) = std::str::from_utf8(&bytes) {
                    Some(s.to_string())
                } else {
                    Some("[Binary Request Data]".to_string())
                };
                Request::from_parts(parts, Body::from(bytes))
            }
            Err(_) => {
                request_body_str = None;
                Request::from_parts(parts, Body::empty())
            }
        }
    } else {
        request_body_str = None;
        request
    };

    let response = next.run(request).await;

    let duration = start.elapsed().as_millis() as u64;
    let status = response.status().as_u16();

    let content_type = response.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let monitor = state.monitor.clone();
    let mut log = ProxyRequestLog {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        method,
        url: uri,
        status,
        duration,
        model,
        error: None,
        request_body: request_body_str,
        response_body: None,
        input_tokens: None,
        output_tokens: None,
    };

    if content_type.contains("text/event-stream") {
        log.response_body = Some("[Stream Data]".to_string());
        let (parts, body) = response.into_parts();
        let mut stream = body.into_data_stream();
        let (tx, rx) = tokio::sync::mpsc::channel(64);

        // Clone API key info for spawned task
        let auth_key_for_spawn = authenticated_key.clone();

        tokio::spawn(async move {
            let mut last_few_bytes = Vec::new();
            while let Some(chunk_res) = stream.next().await {
                if let Ok(chunk) = chunk_res {
                    if chunk.len() > 8192 {
                        last_few_bytes = chunk.slice(chunk.len()-8192..).to_vec();
                    } else {
                        last_few_bytes.extend_from_slice(&chunk);
                        if last_few_bytes.len() > 8192 {
                            last_few_bytes.drain(0..last_few_bytes.len()-8192);
                        }
                    }
                    let _ = tx.send(Ok::<_, axum::Error>(chunk)).await;
                } else if let Err(e) = chunk_res {
                    let _ = tx.send(Err(axum::Error::new(e))).await;
                }
            }

            if let Ok(full_tail) = std::str::from_utf8(&last_few_bytes) {
                for line in full_tail.lines().rev() {
                    if line.starts_with("data: ") && line.contains("\"usage\"") {
                        let json_str = line.trim_start_matches("data: ").trim();
                        if let Ok(json) = serde_json::from_str::<Value>(json_str) {
                            if let Some(usage) = json.get("usage") {
                                log.input_tokens = usage.get("prompt_tokens").or(usage.get("input_tokens")).and_then(|v| v.as_u64()).map(|v| v as u32);
                                log.output_tokens = usage.get("completion_tokens").or(usage.get("output_tokens")).and_then(|v| v.as_u64()).map(|v| v as u32);
                                if log.input_tokens.is_none() && log.output_tokens.is_none() {
                                    log.output_tokens = usage.get("total_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            if log.status >= 400 {
                log.error = Some("Stream Error or Failed".to_string());
            }

            // Record API key usage stats
            if is_api_request {
                if let Some(auth_key) = auth_key_for_spawn {
                    let success = log.status < 400;
                    let _ = crate::modules::api_keys::record_usage(
                        &auth_key.key,
                        success,
                        log.input_tokens,
                        log.output_tokens,
                    );
                }
            }

            monitor.log_request(log).await;
        });

        Response::from_parts(parts, Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)))
    } else if content_type.contains("application/json") || content_type.contains("text/") {
        let (parts, body) = response.into_parts();
        match axum::body::to_bytes(body, 512 * 1024).await {
            Ok(bytes) => {
                if let Ok(s) = std::str::from_utf8(&bytes) {
                    if let Ok(json) = serde_json::from_str::<Value>(&s) {
                        if let Some(usage) = json.get("usage") {
                            log.input_tokens = usage.get("prompt_tokens").or(usage.get("input_tokens")).and_then(|v| v.as_u64()).map(|v| v as u32);
                            log.output_tokens = usage.get("completion_tokens").or(usage.get("output_tokens")).and_then(|v| v.as_u64()).map(|v| v as u32);
                            if log.input_tokens.is_none() && log.output_tokens.is_none() {
                                log.output_tokens = usage.get("total_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                            }
                        }
                    }
                    log.response_body = Some(s.to_string());
                } else {
                    log.response_body = Some("[Binary Response Data]".to_string());
                }

                if log.status >= 400 {
                    log.error = log.response_body.clone();
                }

                // Record API key usage stats
                if is_api_request {
                    if let Some(auth_key) = authenticated_key.clone() {
                        let success = log.status < 400;
                        let _ = crate::modules::api_keys::record_usage(
                            &auth_key.key,
                            success,
                            log.input_tokens,
                            log.output_tokens,
                        );
                    }
                }

                monitor.log_request(log).await;
                Response::from_parts(parts, Body::from(bytes))
            }
            Err(_) => {
                log.response_body = Some("[Response too large]".to_string());

                // Record API key usage stats (failure case)
                if is_api_request {
                    if let Some(auth_key) = authenticated_key.clone() {
                        let _ = crate::modules::api_keys::record_usage(&auth_key.key, false, None, None);
                    }
                }

                monitor.log_request(log).await;
                Response::from_parts(parts, Body::empty())
            }
        }
    } else {
        log.response_body = Some(format!("[{}]", content_type));

        // Record API key usage stats
        if is_api_request {
            if let Some(auth_key) = authenticated_key {
                let success = log.status < 400;
                let _ = crate::modules::api_keys::record_usage(&auth_key.key, success, None, None);
            }
        }

        monitor.log_request(log).await;
        response
    }
}
