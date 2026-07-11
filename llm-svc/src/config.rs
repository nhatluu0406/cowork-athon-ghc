// config.rs: Configuration loading (env vars + models.yaml)

use crate::routing::NlpMode;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Config holds llm-svc runtime configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// bind_addr: gRPC server bind address (default: "0.0.0.0:9090")
    pub bind_addr: String,

    /// nlp_mode: NLP_MODE policy (1 = cloud_only, 2 = cloud_with_local_preprocess, 3 = local_only)
    pub nlp_mode: NlpMode,

    /// llm_api_base_url: Cloud LLM endpoint (read by llm-svc, not Go)
    pub llm_api_base_url: Option<String>,

    /// llm_api_key: Cloud LLM API key
    pub llm_api_key: Option<String>,

    /// llm_model: Cloud model name (e.g., "gpt-4o-mini")
    pub llm_model: String,

    /// brain_local_provider: Local model identifier (modes 2/3)
    pub brain_local_provider: String,

    /// brain_fallback_to_cloud: Allow cloud fallback in mode 2
    pub brain_fallback_to_cloud: bool,

    /// models: loaded model configurations (from models.yaml)
    pub models: Vec<ModelConfig>,

    /// models_yaml_path: path to models.yaml for hot-reload
    pub models_yaml_path: Option<String>,
}

impl Config {
    /// Load configuration from environment variables and models.yaml
    pub fn from_env() -> Result<Self> {
        let bind_addr = std::env::var("LLMSVC_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:9090".to_string());

        let nlp_mode_str =
            std::env::var("NLP_MODE").unwrap_or_else(|_| "2".to_string());
        let nlp_mode = NlpMode::from_env(&nlp_mode_str)
            .map_err(|e| anyhow!("Invalid NLP_MODE: {}", e))?;

        let llm_api_base_url = std::env::var("LLM_API_BASE_URL").ok();
        let llm_api_key = std::env::var("LLM_API_KEY").ok();
        let llm_model = std::env::var("LLM_MODEL")
            .unwrap_or_else(|_| "gpt-4o-mini".to_string());

        let brain_local_provider = std::env::var("BRAIN_LOCAL_PROVIDER")
            .unwrap_or_else(|_| "qwen3-8b-q4".to_string());

        let brain_fallback_to_cloud = std::env::var("BRAIN_FALLBACK_TO_CLOUD")
            .unwrap_or_else(|_| "true".to_string())
            .parse::<bool>()
            .unwrap_or(true);

        let models_yaml_path = std::env::var("MODELS_YAML_PATH").ok();

        // Load models from models.yaml if specified, otherwise use defaults
        let models = if let Some(ref path) = models_yaml_path {
            Self::load_models_yaml(path).unwrap_or_else(|_| {
                // Fall back to defaults if file not found
                Self::default_models()
            })
        } else {
            Self::default_models()
        };

        Ok(Config {
            bind_addr,
            nlp_mode,
            llm_api_base_url,
            llm_api_key,
            llm_model,
            brain_local_provider,
            brain_fallback_to_cloud,
            models,
            models_yaml_path,
        })
    }

    /// Load models from a YAML file
    fn load_models_yaml<P: AsRef<Path>>(path: P) -> Result<Vec<ModelConfig>> {
        let content = std::fs::read_to_string(path)?;
        let config: ModelsYaml = serde_yaml::from_str(&content)?;
        Ok(config.models)
    }

    /// Return default model configurations
    fn default_models() -> Vec<ModelConfig> {
        vec![
            ModelConfig {
                name: "text-embedding-3-small".to_string(),
                kind: "embedding".to_string(),
                format: "cloud".to_string(),
                path: None,
                dims: 1536,
                version: "1.0".to_string(),
                is_default: true,
            },
            ModelConfig {
                name: "bge-reranker-base".to_string(),
                kind: "reranker".to_string(),
                format: "onnx".to_string(),
                path: Some("/models/bge-reranker-base.onnx".to_string()),
                dims: 0,
                version: "1.0".to_string(),
                is_default: true,
            },
        ]
    }

    /// Get a model configuration by name
    pub fn get_model(&self, name: &str) -> Option<&ModelConfig> {
        self.models.iter().find(|m| m.name == name)
    }

    /// Get the default model for a given kind
    pub fn get_default_model(&self, kind: &str) -> Option<&ModelConfig> {
        self.models
            .iter()
            .find(|m| m.kind == kind && m.is_default)
    }
}

/// ModelsYaml is the top-level structure for models.yaml
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsYaml {
    pub models: Vec<ModelConfig>,
}

/// ModelConfig describes a single model from models.yaml or config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// name: model identifier
    pub name: String,
    /// kind: task type (embedding, reranker, generative)
    pub kind: String,
    /// format: model format (onnx, gguf, safetensors, cloud)
    pub format: String,
    /// path: optional file path for local models
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// dims: embedding dimensionality (0 for non-embedding models)
    pub dims: usize,
    /// version: model version
    pub version: String,
    /// is_default: true if default for its kind
    #[serde(default)]
    pub is_default: bool,
}
