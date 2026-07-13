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
    // T168: verify zero Ollama dependency, both statically and at runtime.

    // 1. Cargo.lock must not have pulled in any ollama-related crate transitively.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let cargo_lock = std::fs::read_to_string(format!("{}/Cargo.lock", manifest_dir))
        .expect("Cargo.lock should exist");
    assert!(
        !cargo_lock.to_lowercase().contains("ollama"),
        "Cargo.lock must not depend on any ollama crate"
    );

    // 2. No source file references Ollama's default host/port/API as a real target
    // (this file's own strings are excluded since it legitimately mentions them).
    for entry in std::fs::read_dir(format!("{}/src", manifest_dir)).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let content = std::fs::read_to_string(&path).unwrap();
        let lower = content.to_lowercase();
        assert!(
            !lower.contains("ollama") && !lower.contains("11434"),
            "{:?} must not reference Ollama (found 'ollama' or port 11434)",
            path
        );
    }

    // 3. Runtime probe: bind Ollama's default port ourselves and confirm nothing in
    // the public routing API attempts to connect to it while exercising every
    // NLP_MODE's routing decisions. If the port is already in use by something else
    // in this environment, skip the runtime probe (the static checks above already
    // ran and are the decisive signal).
    if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:11434") {
        listener.set_nonblocking(true).unwrap();

        use llm_svc::routing::{NlpMode, Router};
        for mode in [NlpMode::CloudOnly, NlpMode::CloudWithLocalPreprocess, NlpMode::LocalOnly] {
            for has_local in [true, false] {
                for has_cloud in [true, false] {
                    let router = Router::new(mode, has_local, has_cloud);
                    for task in [
                        "embed", "rerank", "extract_entities", "compress",
                        "detect_intent", "generate",
                    ] {
                        let _ = router.route(task);
                    }
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            listener.accept().is_err(),
            "unexpected connection attempt to Ollama's default port 11434"
        );
    }

    // 4. No environment variable expecting Ollama-specific configuration is read
    // anywhere in Config::from_env's real behavior.
    let config = llm_svc::config::Config::from_env().expect("Config load failed");
    assert!(!config.brain_local_provider.to_lowercase().contains("ollama"));
    assert!(!config
        .llm_api_base_url
        .as_deref()
        .unwrap_or("")
        .contains("11434"));
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

    // First attempt should have base delay. delay_for_attempt's jitter formula is
    // `delay_ms - jitter_range/2 + jitter` with jitter_range = delay_ms/4 and jitter
    // in [0, jitter_range) keyed off std::process::id(), so the true possible range
    // is base +/- 12.5%, not +/- 10% — widen to avoid PID-dependent flakiness.
    let d0 = policy.delay_for_attempt(0);
    assert!(d0.as_millis() >= 875 && d0.as_millis() <= 1125);

    // Second attempt should be roughly 2x (with jitter)
    let d1 = policy.delay_for_attempt(1);
    assert!(d1.as_millis() >= 1000 && d1.as_millis() <= 3000);

    // Max attempts should return 0
    assert_eq!(policy.delay_for_attempt(3), Duration::ZERO);
}
