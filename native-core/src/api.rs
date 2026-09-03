use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tokio::net::TcpListener;

use crate::config::Policy;
use crate::verifier::{VerificationRequest, VerificationResult};
use crate::{AppState, CoreStatus, PROTOCOL_VERSION};

const MAX_REQUEST_BYTES: usize = 64 * 1024;

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/policy", get(get_policy).put(put_policy))
        .route("/verify", post(verify))
        .route("/status", get(status))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

pub async fn serve(address: SocketAddr, state: Arc<AppState>) -> anyhow::Result<()> {
    if !address.ip().is_loopback() {
        anyhow::bail!(
            "GPTWork refuses non-loopback listen address / GPTWork 拒绝监听非本机回环地址"
        );
    }
    let listener = TcpListener::bind(address).await?;
    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> (StatusCode, Json<HealthResponse>) {
    match state.status() {
        Ok(status) => (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                version: env!("CARGO_PKG_VERSION"),
                protocol_version: PROTOCOL_VERSION,
                uptime_seconds: status.uptime_seconds,
            }),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                status: "degraded",
                version: env!("CARGO_PKG_VERSION"),
                protocol_version: PROTOCOL_VERSION,
                uptime_seconds: 0,
            }),
        ),
    }
}

async fn get_policy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<PolicyEnvelope>, ApiError> {
    authorize(&headers, state.api_token())?;
    let (policy, revision) = state.policy().map_err(ApiError::internal)?;
    Ok(Json(PolicyEnvelope { policy, revision }))
}

async fn put_policy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(policy): Json<Policy>,
) -> Result<Json<PolicyEnvelope>, ApiError> {
    authorize(&headers, state.api_token())?;
    let (policy, revision) = state
        .set_policy(policy, "localhost_api")
        .map_err(ApiError::bad_request)?;
    Ok(Json(PolicyEnvelope { policy, revision }))
}

async fn verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<VerificationRequest>,
) -> Result<Json<VerificationResult>, ApiError> {
    authorize(&headers, state.api_token())?;
    state.verify(request).map(Json).map_err(ApiError::internal)
}

async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<CoreStatus>, ApiError> {
    authorize(&headers, state.api_token())?;
    state.status().map(Json).map_err(ApiError::internal)
}

fn authorize(headers: &HeaderMap, expected: &str) -> Result<(), ApiError> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let custom = headers
        .get("x-gptlock-token")
        .and_then(|value| value.to_str().ok());
    if bearer
        .or(custom)
        .is_some_and(|provided| constant_time_eq(provided.as_bytes(), expected.as_bytes()))
    {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "缺少或无效的本地 API 令牌",
            "Missing or invalid local API token",
        ))
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    protocol_version: u32,
    uptime_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyEnvelope {
    policy: Policy,
    revision: String,
}

struct ApiError {
    status: StatusCode,
    body: ErrorBody,
}

impl ApiError {
    fn new(
        status: StatusCode,
        code: &'static str,
        message_zh_cn: impl Into<String>,
        message_en: impl Into<String>,
    ) -> Self {
        Self {
            status,
            body: ErrorBody {
                code,
                message_zh_cn: message_zh_cn.into(),
                message_en: message_en.into(),
            },
        }
    }

    fn bad_request(error: anyhow::Error) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            format!("请求无效：{error}"),
            format!("Invalid request: {error}"),
        )
    }

    fn internal(_error: anyhow::Error) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "GPTWork 本地核心处理失败，请查看审计日志",
            "GPTWork local core failed to process the request; inspect the audit log",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    message_zh_cn: String,
    message_en: String,
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = terminate.recv() => {},
            }
        } else {
            let _ = tokio::signal::ctrl_c().await;
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
