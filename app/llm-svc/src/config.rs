// config.rs: Configuration loading (env vars + models.yaml)

use crate::models::{Model, ModelRegistry};
use crate::routing::NlpMode;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tracing::{info, warn};

/// Config holds llm-svc runtime configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// bind_addr: gRPC server bind address (default: "0.0.0.0:9090")
    pub bind_addr: String,

    /// nlp_mode: NLP_MODE policy (1 = cloud_only, 2 = cloud_with_local_preprocess, 3 = local_only)
    pub nlp_mode: NlpMode,

    /// llm_api_base_url: Cloud LLM endpoint (read by llm-svc, not Go)
    #[allow(dead_code)]
    pub llm_api_base_url: Option<String>,

    /// llm_api_key: Cloud LLM API key
    #[allow(dead_code)]
    pub llm_api_key: Option<String>,

    /// llm_model: Cloud model name (e.g., "gpt-4o-mini")
    #[allow(dead_code)]
    pub llm_model: String,

    /// brain_local_provider: Local model identifier (modes 2/3)
    #[allow(dead_code)]
    pub brain_local_provider: String,

    /// brain_fallback_to_cloud: Allow cloud fallback in mode 2
    #[allow(dead_code)]
    pub brain_fallback_to_cloud: bool,

    /// models: loaded model configurations (from models.yaml)
    #[allow(dead_code)]
    pub models: Vec<ModelConfig>,

    /// models_yaml_path: path to models.yaml for hot-reload
    pub models_yaml_path: Option<String>,

    /// models_registry: shared, hot-swappable view of `models` (T166) — RPC
    /// handlers (e.g. ListModels) read from this instead of the static `models`
    /// Vec above, so a models.yaml edit takes effect without a rebuild/restart.
    /// Cheap to clone (Arc-backed); every Config clone shares the same registry.
    pub models_registry: ModelRegistry,
}

impl Config {
    /// Load configuration from environment variables and models.yaml
    pub fn from_env() -> Result<Self> {
        let bind_addr = std::env::var("LLMSVC_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:9090".to_string());

        let nlp_mode_str =
            std::env::var("NLP_MODE").unwrap_or_else(|_| "1".to_string());
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

        let models_registry = ModelRegistry::new();
        models_registry.replace(Self::configs_to_models(&models));

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
            models_registry,
        })
    }

    /// Convert models.yaml-sourced ModelConfig entries into runtime Models,
    /// skipping (and logging) any entry with an unrecognized format/kind rather
    /// than failing the whole load.
    fn configs_to_models(configs: &[ModelConfig]) -> Vec<Model> {
        configs
            .iter()
            .filter_map(|c| match Model::try_from(c) {
                Ok(m) => Some(m),
                Err(e) => {
                    warn!("skipping invalid model '{}' in models.yaml: {}", c.name, e);
                    None
                }
            })
            .collect()
    }

    /// Re-read models_yaml_path and swap the shared registry's contents in
    /// place (T166: "swapping the active model is a config change, not a
    /// rebuild"). Returns the number of models loaded. No-op error if no
    /// models.yaml path was configured at startup.
    pub fn reload_models(&self) -> Result<usize> {
        let path = self
            .models_yaml_path
            .as_ref()
            .ok_or_else(|| anyhow!("MODELS_YAML_PATH not configured; nothing to reload"))?;
        let configs = Self::load_models_yaml(path)?;
        let models = Self::configs_to_models(&configs);
        let count = models.len();
        self.models_registry.replace(models);
        Ok(count)
    }

    /// Spawn a background task that polls models_yaml_path's mtime and calls
    /// reload_models() whenever the file changes, so a models.yaml edit takes
    /// effect without restarting the process. No-op if no path is configured.
    pub fn spawn_hot_reload(self, poll_interval: Duration) {
        let Some(path) = self.models_yaml_path.clone() else {
            info!("MODELS_YAML_PATH not set; models.yaml hot-reload disabled");
            return;
        };
        tokio::spawn(async move {
            let mut last_modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
            loop {
                tokio::time::sleep(poll_interval).await;
                let modified = match std::fs::metadata(&path).and_then(|m| m.modified()) {
                    Ok(m) => m,
                    Err(e) => {
                        warn!("hot-reload: failed to stat {}: {}", path, e);
                        continue;
                    }
                };
                if Some(modified) != last_modified {
                    match self.reload_models() {
                        Ok(count) => {
                            info!("hot-reload: reloaded {} models from {}", count, path)
                        }
                        Err(e) => warn!("hot-reload: failed to reload {}: {}", path, e),
                    }
                    last_modified = Some(modified);
                }
            }
        });
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
    #[allow(dead_code)]
    pub fn get_model(&self, name: &str) -> Option<&ModelConfig> {
        self.models.iter().find(|m| m.name == name)
    }

    /// Get the default model for a given kind
    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModelKind;
    use std::io::Write;

    fn write_models_yaml(dir: &std::path::Path, models: &[(&str, &str, &str, bool)]) -> std::path::PathBuf {
        let path = dir.join("models.yaml");
        let mut yaml = String::from("models:\n");
        for (name, kind, format, is_default) in models {
            yaml.push_str(&format!(
                "  - name: \"{}\"\n    kind: \"{}\"\n    format: \"{}\"\n    dims: 0\n    version: \"1.0\"\n    is_default: {}\n",
                name, kind, format, is_default
            ));
        }
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(yaml.as_bytes()).unwrap();
        path
    }

    fn unique_test_dir(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("llmsvc_test_{}_{}_{}", label, std::process::id(), nonce))
    }

    #[test]
    fn test_reload_models_swaps_registry_contents() {
        let dir = unique_test_dir("reload");
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_models_yaml(&dir, &[("model-a", "embedding", "cloud", true)]);

        let initial_configs = Config::load_models_yaml(&path).unwrap();
        let models_registry = ModelRegistry::new();
        models_registry.replace(Config::configs_to_models(&initial_configs));

        let config = Config {
            bind_addr: "0.0.0.0:9090".to_string(),
            nlp_mode: NlpMode::CloudWithLocalPreprocess,
            llm_api_base_url: None,
            llm_api_key: None,
            llm_model: "test-model".to_string(),
            brain_local_provider: "test".to_string(),
            brain_fallback_to_cloud: true,
            models: initial_configs,
            models_yaml_path: Some(path.to_str().unwrap().to_string()),
            models_registry,
        };

        assert_eq!(config.models_registry.list(None).len(), 1);
        assert_eq!(config.models_registry.get("model-a").unwrap().name, "model-a");
        assert!(config.models_registry.get("model-b").is_none());

        // Edit models.yaml to a different set, then reload — registry must reflect
        // the new set, not the union or the old one (a real swap, not an append).
        write_models_yaml(&dir, &[("model-b", "reranker", "onnx", true)]);
        let count = config.reload_models().unwrap();
        assert_eq!(count, 1);
        assert!(config.models_registry.get("model-a").is_none());
        assert_eq!(
            config.models_registry.get_default(ModelKind::Reranker).unwrap().name,
            "model-b"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_reload_models_skips_invalid_entries_without_failing() {
        let dir = unique_test_dir("invalid_model");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("models.yaml");
        std::fs::write(
            &path,
            "models:\n  - name: \"good\"\n    kind: \"embedding\"\n    format: \"cloud\"\n    dims: 0\n    version: \"1.0\"\n    is_default: true\n  - name: \"bad\"\n    kind: \"not-a-real-kind\"\n    format: \"cloud\"\n    dims: 0\n    version: \"1.0\"\n    is_default: false\n",
        )
        .unwrap();

        let configs = Config::load_models_yaml(&path).unwrap();
        let models = Config::configs_to_models(&configs);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "good");

        std::fs::remove_dir_all(&dir).ok();
    }
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
