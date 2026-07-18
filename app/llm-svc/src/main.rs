// main.rs: tonic gRPC server bootstrap

use anyhow::Result;
use std::net::SocketAddr;
use tonic::transport::Server;
use tracing::info;

mod llmsvc {
    tonic::include_proto!("llmsvc");
}

mod service;
mod routing;
mod models;
mod cloud_proxy;
mod config;

use llmsvc::llm_svc_server::LlmSvcServer;
use service::LlmSvcImpl;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Load configuration
    let config = config::Config::from_env()?;
    info!("LLM Service starting with config: {:?}", config);

    // T166: hot-reload models.yaml on change, without a rebuild/restart.
    let hot_reload_secs: u64 = std::env::var("MODELS_YAML_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    config
        .clone()
        .spawn_hot_reload(std::time::Duration::from_secs(hot_reload_secs));

    // Bind gRPC server
    let addr: SocketAddr = config
        .bind_addr
        .parse()
        .expect("Invalid LLMSVC_ADDR");

    // Create service implementation
    let service = LlmSvcImpl::new(config).await?;
    info!("LLM Service listening on {}", addr);

    // Start tonic server
    Server::builder()
        .add_service(LlmSvcServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
