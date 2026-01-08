// Upstream client implementation
// High-performance HTTP client wrapper

use reqwest::{header, Client, Response, StatusCode};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::Duration;

// Cloud Code v1internal endpoints
// [FIX] daily 端点优先 - sandbox 端点返回 404 已移除
const V1_INTERNAL_BASE_URL_DAILY: &str = "https://daily-cloudcode-pa.googleapis.com/v1internal";
const V1_INTERNAL_BASE_URL_PROD: &str = "https://cloudcode-pa.googleapis.com/v1internal";

pub struct UpstreamClient {
    http_client: Client,
    user_agent: String,
    // Dynamic endpoint priority list - successful fallback gets promoted
    endpoints: Arc<RwLock<Vec<String>>>,
}

impl UpstreamClient {
    pub fn new(proxy_config: Option<crate::proxy::config::UpstreamProxyConfig>) -> Self {
        let user_agent = proxy_config
            .as_ref()
            .map(|c| c.user_agent.clone())
            .filter(|ua| !ua.is_empty())
            .unwrap_or_else(|| "antigravity/1.13.3 darwin/arm64".to_string());

        let mut builder = Client::builder()
            // Connection settings (optimize connection reuse, reduce overhead)
            .connect_timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(16)                  // Max 16 idle connections per host
            .pool_idle_timeout(Duration::from_secs(90))  // Keep idle connections for 90s
            .tcp_keepalive(Duration::from_secs(60))      // TCP keepalive probe at 60s
            .timeout(Duration::from_secs(600))
            .user_agent(&user_agent);

        if let Some(config) = proxy_config {
            if config.enabled && !config.url.is_empty() {
                if let Ok(proxy) = reqwest::Proxy::all(&config.url) {
                    builder = builder.proxy(proxy);
                    tracing::info!("UpstreamClient enabled proxy: {}", config.url);
                }
            } else {
                builder = builder.no_proxy();
            }
        } else {
            builder = builder.no_proxy();
        }

        let http_client = builder.build().expect("Failed to create HTTP client");

        // Initialize with default endpoint priority
        // [FIX] daily 端点优先，避免 429 限流
        let endpoints = Arc::new(RwLock::new(vec![
            V1_INTERNAL_BASE_URL_DAILY.to_string(),
            V1_INTERNAL_BASE_URL_PROD.to_string(),
        ]));

        Self { http_client, user_agent, endpoints }
    }

    /// Promote a successful fallback endpoint to primary position
    async fn promote_endpoint(&self, successful_idx: usize) {
        if successful_idx == 0 {
            return; // Already primary
        }

        let mut endpoints = self.endpoints.write().await;
        if successful_idx < endpoints.len() {
            let endpoint = endpoints.remove(successful_idx);
            endpoints.insert(0, endpoint.clone());
            tracing::info!(
                "⚡ Endpoint promoted to primary: {} (was fallback #{})",
                endpoint,
                successful_idx
            );
        }
    }

    /// 构建 v1internal URL
    /// 
    /// 构建 API 请求地址
    fn build_url(base_url: &str, method: &str, query_string: Option<&str>) -> String {
        if let Some(qs) = query_string {
            format!("{}:{}?{}", base_url, method, qs)
        } else {
            format!("{}:{}", base_url, method)
        }
    }

    /// 判断是否应尝试下一个端点
    /// 
    /// 当遇到以下错误时，尝试切换到备用端点：
    /// - 429 Too Many Requests（限流）
    /// - 408 Request Timeout（超时）
    /// - 404 Not Found（端点不存在）
    /// - 5xx Server Error（服务器错误）
    fn should_try_next_endpoint(status: StatusCode) -> bool {
        status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
            || status == StatusCode::NOT_FOUND
            || status.is_server_error()
    }

    /// 调用 v1internal API（基础方法）
    ///
    /// 发起基础网络请求，支持多端点自动 Fallback
    /// 当 fallback 端点成功时，会自动将其提升为主端点
    pub async fn call_v1_internal(
        &self,
        method: &str,
        access_token: &str,
        body: Value,
        query_string: Option<&str>,
    ) -> Result<Response, String> {
        // 构建 Headers (所有端点复用)
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Bearer {}", access_token))
                .map_err(|e| e.to_string())?,
        );
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_str(&self.user_agent)
                .unwrap_or_else(|_| header::HeaderValue::from_static("antigravity/1.11.9 windows/amd64")),
        );

        let mut last_err: Option<String> = None;

        // Read current endpoint priority (dynamic, may have been promoted)
        let endpoints = self.endpoints.read().await.clone();
        let endpoint_count = endpoints.len();

        // 遍历所有端点，失败时自动切换
        for (idx, base_url) in endpoints.iter().enumerate() {
            let url = Self::build_url(base_url, method, query_string);
            let has_next = idx + 1 < endpoint_count;

            let response = self
                .http_client
                .post(&url)
                .headers(headers.clone())
                .json(&body)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        if idx > 0 {
                            tracing::info!(
                                "✓ Upstream fallback succeeded | Endpoint: {} | Status: {} | Attempt: {}/{}",
                                base_url,
                                status,
                                idx + 1,
                                endpoint_count
                            );
                            // Promote successful fallback to primary position
                            self.promote_endpoint(idx).await;
                        } else {
                            tracing::debug!("✓ Upstream request succeeded | Endpoint: {} | Status: {}", base_url, status);
                        }
                        return Ok(resp);
                    }

                    // 如果有下一个端点且当前错误可重试，则切换
                    if has_next && Self::should_try_next_endpoint(status) {
                        tracing::warn!(
                            "Upstream endpoint returned {} at {} (method={}), trying next endpoint",
                            status,
                            base_url,
                            method
                        );
                        last_err = Some(format!("Upstream {} returned {}", base_url, status));
                        continue;
                    }

                    // 不可重试的错误或已是最后一个端点，直接返回
                    return Ok(resp);
                }
                Err(e) => {
                    let msg = format!("HTTP request failed at {}: {}", base_url, e);
                    tracing::debug!("{}", msg);
                    last_err = Some(msg);

                    // 如果是最后一个端点，退出循环
                    if !has_next {
                        break;
                    }
                    continue;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| "All endpoints failed".to_string()))
    }

    /// 调用 v1internal API（带 429 重试,支持闭包）
    /// 
    /// 带容错和重试的核心请求逻辑
    /// 
    /// # Arguments
    /// * `method` - API method (e.g., "generateContent")
    /// * `query_string` - Optional query string (e.g., "?alt=sse")
    /// * `get_credentials` - 闭包，获取凭证（支持账号轮换）
    /// * `build_body` - 闭包，接收 project_id 构建请求体
    /// * `max_attempts` - 最大重试次数
    /// 
    /// # Returns
    /// HTTP Response
    // 已移除弃用的重试方法 (call_v1_internal_with_retry)

    // 已移除弃用的辅助方法 (parse_retry_delay)

    // 已移除弃用的辅助方法 (parse_duration_ms)

    /// 获取可用模型列表
    ///
    /// 获取远端模型列表，支持多端点自动 Fallback
    /// 当 fallback 端点成功时，会自动将其提升为主端点
    pub async fn fetch_available_models(&self, access_token: &str) -> Result<Value, String> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Bearer {}", access_token))
                .map_err(|e| e.to_string())?,
        );
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_str(&self.user_agent)
                .unwrap_or_else(|_| header::HeaderValue::from_static("antigravity/1.11.9 windows/amd64")),
        );

        let mut last_err: Option<String> = None;

        // Read current endpoint priority (dynamic, may have been promoted)
        let endpoints = self.endpoints.read().await.clone();
        let endpoint_count = endpoints.len();

        // 遍历所有端点，失败时自动切换
        for (idx, base_url) in endpoints.iter().enumerate() {
            let url = Self::build_url(base_url, "fetchAvailableModels", None);

            let response = self
                .http_client
                .post(&url)
                .headers(headers.clone())
                .json(&serde_json::json!({}))
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        if idx > 0 {
                            tracing::info!(
                                "✓ Upstream fallback succeeded for fetchAvailableModels | Endpoint: {} | Status: {}",
                                base_url,
                                status
                            );
                            // Promote successful fallback to primary position
                            self.promote_endpoint(idx).await;
                        } else {
                            tracing::debug!("✓ fetchAvailableModels succeeded | Endpoint: {}", base_url);
                        }
                        let json: Value = resp
                            .json()
                            .await
                            .map_err(|e| format!("Parse json failed: {}", e))?;
                        return Ok(json);
                    }

                    // 如果有下一个端点且当前错误可重试，则切换
                    let has_next = idx + 1 < endpoint_count;
                    if has_next && Self::should_try_next_endpoint(status) {
                        tracing::warn!(
                            "fetchAvailableModels returned {} at {}, trying next endpoint",
                            status,
                            base_url
                        );
                        last_err = Some(format!("Upstream error: {}", status));
                        continue;
                    }

                    // 不可重试的错误或已是最后一个端点
                    return Err(format!("Upstream error: {}", status));
                }
                Err(e) => {
                    let msg = format!("Request failed at {}: {}", base_url, e);
                    tracing::debug!("{}", msg);
                    last_err = Some(msg);

                    // 如果是最后一个端点，退出循环
                    if idx + 1 >= endpoint_count {
                        break;
                    }
                    continue;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| "All endpoints failed".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url() {
        let base_url = "https://cloudcode-pa.googleapis.com/v1internal";
        
        let url1 = UpstreamClient::build_url(base_url, "generateContent", None);
        assert_eq!(
            url1,
            "https://cloudcode-pa.googleapis.com/v1internal:generateContent"
        );

        let url2 = UpstreamClient::build_url(base_url, "streamGenerateContent", Some("alt=sse"));
        assert_eq!(
            url2,
            "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"
        );
    }

}
