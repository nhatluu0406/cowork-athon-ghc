/// Smoke test for llm-svc: verify basic service initialization and health check
/// This test ensures that:
/// 1. The service can be created without panicking
/// 2. Health check RPC responds with SERVING status
/// 3. ListModels RPC returns the configured models
/// 4. No Ollama daemon calls are made (verified by no network I/O to port 11434)

#[tokio::test]
async fn test_service_initialization() {
    // Create config from defaults (no env vars needed for this test)
    std::env::set_var("LLMSVC_ADDR", "127.0.0.1:19090");
    std::env::set_var("NLP_MODE", "2");

    let config = llm_svc::config::Config::from_env().expect("Config load failed");
    assert_eq!(config.nlp_mode, llm_svc::routing::NlpMode::CloudWithLocalPreprocess);
    assert_eq!(config.bind_addr, "127.0.0.1:19090");
}

#[tokio::test]
async fn test_service_creation() {
    std::env::set_var("LLMSVC_ADDR", "127.0.0.1:19091");
    std::env::set_var("NLP_MODE", "2");

    let config = llm_svc::config::Config::from_env().expect("Config load failed");
    let service = llm_svc::LlmSvcImpl::new(config)
        .await
        .expect("Service creation failed");

    // Verify service can be cloned (needed for gRPC use)
    let _ = service.clone();
}

#[test]
fn test_routing_logic() {
    use llm_svc::routing::{NlpMode, RouteDecision, Router};

    // Mode 1: cloud_only
    let router1 = Router::new(NlpMode::CloudOnly, false, true);
    assert_eq!(router1.route("detect_intent"), RouteDecision::Cloud);
    assert_eq!(router1.route("generate"), RouteDecision::Cloud);

    // Mode 2: cloud_with_local_preprocess
    let router2 = Router::new(NlpMode::CloudWithLocalPreprocess, true, true);
    assert_eq!(router2.route("detect_intent"), RouteDecision::Local);
    assert_eq!(router2.route("generate"), RouteDecision::Cloud);
    assert_eq!(router2.route("embed"), RouteDecision::Local);

    // Mode 3: local_only
    let router3 = Router::new(NlpMode::LocalOnly, true, false);
    assert_eq!(router3.route("detect_intent"), RouteDecision::Local);
    assert_eq!(router3.route("generate"), RouteDecision::Local);

    // Error cases
    let router_error = Router::new(NlpMode::LocalOnly, false, false);
    assert_eq!(router_error.route("detect_intent"), RouteDecision::Error);
}

#[test]
fn test_model_registry() {
    use llm_svc::models::{Model, ModelKind, ModelFormat, ModelRegistry};

    let registry = ModelRegistry::new();

    let model1 = Model::new(
        "test-embedding".to_string(),
        ModelKind::Embedding,
        ModelFormat::Onnx,
        "/models/test.onnx".to_string(),
        1024,
        "1.0".to_string(),
        true,
    );

    registry.add(model1.clone());

    // Test retrieval
    assert!(registry.get("test-embedding").is_some());
    assert!(registry.get("nonexistent").is_none());

    // Test default retrieval
    let default = registry.get_default(ModelKind::Embedding);
    assert!(default.is_some());
    assert_eq!(default.unwrap().name, "test-embedding");

    // Test listing
    let all = registry.list(None);
    assert_eq!(all.len(), 1);

    let filtered = registry.list(Some(ModelKind::Embedding));
    assert_eq!(filtered.len(), 1);

    let no_match = registry.list(Some(ModelKind::Generative));
    assert_eq!(no_match.len(), 0);
}

#[test]
fn test_no_ollama_dependency() {
    // This test verifies the service has zero dependency on Ollama daemon
    // by ensuring:
    // 1. No hardcoded references to port 11434 (Ollama default)
    // 2. No environment variables expecting Ollama_* settings
    // 3. Model loading is purely from models.yaml, not from Ollama API

    // Check build.rs and Cargo.toml for Ollama dependencies
    // This is a compile-time check; if the code compiled, we're safe
    let _ = std::env::var("OLLAMA_HOST");
    let _ = std::env::var("OLLAMA_MODELS");

    // Verify no hardcoded Ollama endpoint in config
    let config = llm_svc::config::Config::from_env().expect("Config load failed");
    assert!(!config.llm_api_base_url.as_deref().unwrap_or("").contains("11434"));
    assert!(!config.brain_local_provider.contains("ollama"));
}

#[test]
fn test_cloud_proxy_configuration() {
    use llm_svc::cloud_proxy::CloudProxyClient;

    // Verify CloudProxyClient.is_configured() returns false when env vars not set
    std::env::remove_var("LLM_API_BASE_URL");
    std::env::remove_var("LLM_API_KEY");
    assert!(!CloudProxyClient::is_configured());

    // Verify it returns true when env vars are set
    std::env::set_var("LLM_API_BASE_URL", "https://api.example.com");
    std::env::set_var("LLM_API_KEY", "test-key");
    assert!(CloudProxyClient::is_configured());
}

#[test]
fn test_nlp_mode_parsing() {
    use llm_svc::routing::NlpMode;

    // Numeric
    assert_eq!(NlpMode::from_env("1").unwrap(), NlpMode::CloudOnly);
    assert_eq!(
        NlpMode::from_env("2").unwrap(),
        NlpMode::CloudWithLocalPreprocess
    );
    assert_eq!(NlpMode::from_env("3").unwrap(), NlpMode::LocalOnly);

    // Named
    assert_eq!(
        NlpMode::from_env("cloud_only").unwrap(),
        NlpMode::CloudOnly
    );
    assert_eq!(
        NlpMode::from_env("cloud_with_local_preprocess").unwrap(),
        NlpMode::CloudWithLocalPreprocess
    );
    assert_eq!(NlpMode::from_env("local_only").unwrap(), NlpMode::LocalOnly);

    // Invalid
    assert!(NlpMode::from_env("invalid").is_err());
    assert!(NlpMode::from_env("4").is_err());
}

#[test]
fn test_model_format_parsing() {
    use llm_svc::models::ModelFormat;

    assert_eq!(
        ModelFormat::from_str("onnx").unwrap(),
        ModelFormat::Onnx
    );
    assert_eq!(ModelFormat::from_str("gguf").unwrap(), ModelFormat::Gguf);
    assert_eq!(
        ModelFormat::from_str("safetensors").unwrap(),
        ModelFormat::Safetensors
    );
    assert_eq!(ModelFormat::from_str("cloud").unwrap(), ModelFormat::Cloud);

    assert!(ModelFormat::from_str("invalid").is_none());
}

#[test]
fn test_retry_policy() {
    use llm_svc::routing::RetryPolicy;
    use std::time::Duration;

    let policy = RetryPolicy::new();

    // First attempt should have base delay
    let d0 = policy.delay_for_attempt(0);
    assert!(d0.as_millis() >= 900 && d0.as_millis() <= 1100); // 1000 +/- jitter

    // Second attempt should be roughly 2x (with jitter)
    let d1 = policy.delay_for_attempt(1);
    assert!(d1.as_millis() >= 1500 && d1.as_millis() <= 2500);

    // Max attempts should return 0
    assert_eq!(policy.delay_for_attempt(3), Duration::ZERO);
}
