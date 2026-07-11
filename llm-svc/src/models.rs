// models.rs: Model format support (ONNX, GGUF, safetensors)

use std::sync::{Arc, Mutex};

/// ModelFormat describes how a model is serialized/loaded
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFormat {
    /// ONNX format via ort crate
    Onnx,
    /// GGUF format via llama.cpp Rust binding
    Gguf,
    /// Safetensors format via candle
    Safetensors,
    /// Cloud-only (no local inference)
    Cloud,
}

impl ModelFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "onnx" => Some(ModelFormat::Onnx),
            "gguf" => Some(ModelFormat::Gguf),
            "safetensors" => Some(ModelFormat::Safetensors),
            "cloud" => Some(ModelFormat::Cloud),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ModelFormat::Onnx => "onnx",
            ModelFormat::Gguf => "gguf",
            ModelFormat::Safetensors => "safetensors",
            ModelFormat::Cloud => "cloud",
        }
    }
}

/// ModelKind describes the task a model performs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    Embedding,
    Reranker,
    Generative,
    Other,
}

impl ModelKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "embedding" => Some(ModelKind::Embedding),
            "reranker" => Some(ModelKind::Reranker),
            "generative" => Some(ModelKind::Generative),
            "other" => Some(ModelKind::Other),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ModelKind::Embedding => "embedding",
            ModelKind::Reranker => "reranker",
            ModelKind::Generative => "generative",
            ModelKind::Other => "other",
        }
    }
}

/// Model metadata loaded from models.yaml
#[derive(Debug, Clone)]
pub struct Model {
    /// name: model identifier (e.g., "text-embedding-3-small", "qwen3-8b-q4")
    pub name: String,
    /// kind: what task this model performs
    pub kind: ModelKind,
    /// format: how the model is serialized
    pub format: ModelFormat,
    /// path: file path to model (empty for cloud models)
    pub path: String,
    /// dimensions: vector dimensionality for embedding models
    pub dimensions: usize,
    /// version: model version
    pub version: String,
    /// is_default: true if this is the default model for its kind
    pub is_default: bool,
}

impl Model {
    /// Create a new model configuration
    pub fn new(
        name: String,
        kind: ModelKind,
        format: ModelFormat,
        path: String,
        dimensions: usize,
        version: String,
        is_default: bool,
    ) -> Self {
        Model {
            name,
            kind,
            format,
            path,
            dimensions,
            version,
            is_default,
        }
    }
}

/// ModelRegistry holds all loaded models and provides lookup
pub struct ModelRegistry {
    models: Arc<Mutex<Vec<Model>>>,
}

impl ModelRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        ModelRegistry {
            models: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Add a model to the registry
    pub fn add(&self, model: Model) {
        if let Ok(mut models) = self.models.lock() {
            models.push(model);
        }
    }

    /// Find a model by name
    pub fn get(&self, name: &str) -> Option<Model> {
        if let Ok(models) = self.models.lock() {
            models.iter().find(|m| m.name == name).cloned()
        } else {
            None
        }
    }

    /// Find the default model of a given kind
    pub fn get_default(&self, kind: ModelKind) -> Option<Model> {
        if let Ok(models) = self.models.lock() {
            models
                .iter()
                .find(|m| m.kind == kind && m.is_default)
                .cloned()
        } else {
            None
        }
    }

    /// List all models, optionally filtered by kind
    pub fn list(&self, kind_filter: Option<ModelKind>) -> Vec<Model> {
        if let Ok(models) = self.models.lock() {
            if let Some(kind) = kind_filter {
                models.iter().filter(|m| m.kind == kind).cloned().collect()
            } else {
                models.clone()
            }
        } else {
            vec![]
        }
    }

    /// Replace all models (for hot-reload)
    pub fn replace(&self, new_models: Vec<Model>) {
        if let Ok(mut models) = self.models.lock() {
            *models = new_models;
        }
    }
}

impl Clone for ModelRegistry {
    fn clone(&self) -> Self {
        ModelRegistry {
            models: Arc::clone(&self.models),
        }
    }
}

impl Default for ModelRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// Stubs for Phase 2 implementation (actual inference backends)

/// ONNX inference module (Phase 2)
pub mod onnx {
    /// Embed texts using ONNX model
    /// Phase 2: Implement via `ort` crate
    pub fn embed(_texts: &[&str]) -> Result<Vec<Vec<f32>>, String> {
        Err("ONNX embedding not implemented in Phase 1 (stub)".to_string())
    }

    /// Rerank documents using ONNX model
    /// Phase 2: Implement via `ort` crate
    pub fn rerank(_query: &str, _documents: &[&str]) -> Result<Vec<f32>, String> {
        Err("ONNX reranking not implemented in Phase 1 (stub)".to_string())
    }
}

/// GGUF inference module (Phase 2)
pub mod gguf {
    /// Generate text using GGUF model
    /// Phase 2: Implement via `llama-cpp-2` crate
    pub fn generate(_prompt: &str, _max_tokens: usize) -> Result<String, String> {
        Err("GGUF generation not implemented in Phase 1 (stub)".to_string())
    }

    /// Extract entities using GGUF model
    /// Phase 2: Implement via `llama-cpp-2` crate
    pub fn extract(_text: &str) -> Result<(Vec<String>, Vec<(String, String)>), String> {
        Err("GGUF extraction not implemented in Phase 1 (stub)".to_string())
    }
}

/// Safetensors inference module (Phase 2)
pub mod safetensors {
    /// Inference on safetensors model
    /// Phase 2: Implement via `candle` crate
    pub fn inference(_input: &[f32]) -> Result<Vec<f32>, String> {
        Err("Safetensors inference not implemented in Phase 1 (stub)".to_string())
    }
}
