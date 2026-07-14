// lib.rs: llm-svc library module declarations and re-exports

// Generate Rust code from proto/llmsvc.proto
pub mod llmsvc {
    tonic::include_proto!("llmsvc");
}

// Service implementation
pub mod service;

// Routing and NLP_MODE policy
pub mod routing;

// Model inference runtimes
pub mod models;

// Cloud LLM provider proxy
pub mod cloud_proxy;

// Configuration (models.yaml, env vars)
pub mod config;

// Re-export commonly used types
pub use llmsvc::{
    llm_svc_server::{LlmSvc, LlmSvcServer},
    CompressRequest, CompressResponse, EmbedRequest, EmbedResponse,
    ExtractRequest, ExtractResponse, GenerateRequest, GenerateResponse, HealthRequest,
    HealthResponse, IntentRequest, IntentResponse, ListModelsRequest, ListModelsResponse,
    RerankDocument, RerankRequest, RerankResponse,
};

pub use service::LlmSvcImpl;
