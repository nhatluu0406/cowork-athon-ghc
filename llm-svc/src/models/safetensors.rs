//! Safetensors model inference via candle framework (T162).
//!
//! This module provides local inference for HuggingFace models in safetensors format
//! using the candle ML framework. Production-ready model loading with validation.
//!
//! ## Implementation Status (T162)
//! - [x] Model structure validation (config.json, tokenizer.json, safetensors files)
//! - [x] Sharded weight validation (model.safetensors.index.json)
//! - [x] Metadata extraction and validation
//! - [x] Error handling with clear diagnostics
//! - [ ] Actual inference pipeline (requires candle crate)
//! - [x] Unit tests for loading and validation
//!
//! ## Model Format
//!
//! Supports HuggingFace safetensors format with optional sharding:
//! - `config.json` - Model configuration
//! - `tokenizer.json` - HuggingFace tokenizer
//! - `model.safetensors` - Single-file weights (optional)
//! - `model.safetensors.index.json` - Shard index (for sharded models)
//! - `model-00001-of-XXXX.safetensors` to `model-XXXX-of-XXXX.safetensors` - Weight shards
//!
//! ## Implementation Notes
//! The current implementation validates model structure and metadata but requires
//! the `candle-core` crate for actual tensor operations. To enable inference:
//! 1. Add `candle-core = { version = "0.3" }` to Cargo.toml
//! 2. Implement `load_and_infer()` using candle's safetensors loader
//! 3. Port tokenizer integration from qwen_tokenizer.go
//! 4. Add GPU support via candle's CUDA features

use std::path::Path;
use serde_json::{json, Value as JsonValue};

/// Error type for safetensors operations
#[derive(Debug, Clone)]
pub enum SafetensorsError {
    /// Safetensors feature not yet implemented
    NotImplemented(String),
    /// Model file not found
    ModelNotFound(String),
    /// Tokenizer not found
    TokenizerNotFound(String),
    /// Model loading failed
    LoadFailed(String),
    /// Inference failed
    InferenceFailed(String),
}

impl std::fmt::Display for SafetensorsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SafetensorsError::NotImplemented(msg) => write!(f, "Safetensors not implemented: {}", msg),
            SafetensorsError::ModelNotFound(path) => write!(f, "Model not found: {}", path),
            SafetensorsError::TokenizerNotFound(path) => write!(f, "Tokenizer not found: {}", path),
            SafetensorsError::LoadFailed(msg) => write!(f, "Model load failed: {}", msg),
            SafetensorsError::InferenceFailed(msg) => write!(f, "Inference failed: {}", msg),
        }
    }
}

impl std::error::Error for SafetensorsError {}

/// Safetensors model metadata and validation state
#[derive(Debug, Clone)]
pub struct SafetensorsModel {
    /// Path to model directory
    pub path: String,
    /// Number of weight shards (from index.json)
    pub shard_count: usize,
    /// Model configuration from config.json
    pub config: JsonValue,
    /// Whether model has been fully validated
    pub validated: bool,
}

/// Load and validate a safetensors model from disk
pub fn load_model(model_dir: &str) -> Result<SafetensorsModel, SafetensorsError> {
    let path = Path::new(model_dir);

    // Validate directory structure
    if !path.exists() {
        return Err(SafetensorsError::ModelNotFound(model_dir.to_string()));
    }

    // Check for safetensors files
    let safetensors_file = path.join("model.safetensors");
    let safetensors_index = path.join("model.safetensors.index.json");
    let tokenizer_file = path.join("tokenizer.json");
    let config_file = path.join("config.json");

    // Validate required files
    let has_single_file = safetensors_file.exists();
    let has_sharded = safetensors_index.exists();

    if !has_single_file && !has_sharded {
        return Err(SafetensorsError::ModelNotFound(
            format!(
                "No safetensors weights found in {} (missing model.safetensors or model.safetensors.index.json)",
                model_dir
            ),
        ));
    }

    if !tokenizer_file.exists() {
        return Err(SafetensorsError::TokenizerNotFound(
            tokenizer_file.to_string_lossy().to_string(),
        ));
    }

    if !config_file.exists() {
        return Err(SafetensorsError::LoadFailed(
            format!("Missing config.json in {}", model_dir),
        ));
    }

    // Load and validate config.json
    let config_content = std::fs::read_to_string(&config_file)
        .map_err(|e| SafetensorsError::LoadFailed(format!("Failed to read config.json: {}", e)))?;
    let config: JsonValue = serde_json::from_str(&config_content)
        .map_err(|e| SafetensorsError::LoadFailed(format!("Invalid config.json: {}", e)))?;

    // For sharded models, load and validate index.json
    let shard_count = if has_sharded {
        let index_content = std::fs::read_to_string(&safetensors_index)
            .map_err(|e| SafetensorsError::LoadFailed(format!("Failed to read shard index: {}", e)))?;
        let index: JsonValue = serde_json::from_str(&index_content)
            .map_err(|e| SafetensorsError::LoadFailed(format!("Invalid index.json: {}", e)))?;

        // Extract shard count from weight_map (e.g., "model-00001-of-00002.safetensors")
        // The weight_map tells us which file each layer is in
        let mut max_shard = 0u32;
        if let Some(weight_map) = index.get("weight_map").and_then(|m| m.as_object()) {
            for (_, file_val) in weight_map.iter() {
                if let Some(filename) = file_val.as_str() {
                    // Parse "model-00001-of-00002.safetensors" to extract shard count
                    if filename.starts_with("model-") && filename.contains("-of-") {
                        let parts: Vec<&str> = filename.split("-of-").collect();
                        if parts.len() == 2 {
                            let shard_num_str = parts[1].replace(".safetensors", "");
                            if let Ok(shard_num) = shard_num_str.parse::<u32>() {
                                max_shard = max_shard.max(shard_num);
                            }
                        }
                    }
                }
            }
        }

        let shard_count = if max_shard > 0 { max_shard as usize } else { 1 };

        // Verify shard files exist
        for i in 1..=shard_count {
            let shard_file = path.join(format!("model-{:05}-of-{:05}.safetensors", i, shard_count));
            if !shard_file.exists() {
                return Err(SafetensorsError::LoadFailed(
                    format!("Missing shard file: {}", shard_file.display()),
                ));
            }
        }

        shard_count
    } else {
        1 // Single-file model
    };

    // Model successfully loaded and validated
    Ok(SafetensorsModel {
        path: model_dir.to_string(),
        shard_count,
        config,
        validated: true,
    })
}

/// Embed text using safetensors model (requires candle crate)
///
/// Current status: Model loading validated, inference blocked on candle integration.
/// To enable: add `candle-core = "0.3"` to Cargo.toml and implement tensor operations.
pub fn embed(model_dir: &str, input: &str) -> Result<Vec<f32>, SafetensorsError> {
    let model = load_model(model_dir)?;
    let _ = input;

    Err(SafetensorsError::NotImplemented(
        format!(
            "Safetensors embedding requires candle-core crate. Model loaded: {} ({} shards, config validated)",
            model.path, model.shard_count
        ),
    ))
}

/// Generate text using safetensors model (requires candle crate)
///
/// Current status: Model loading validated, inference blocked on candle integration.
/// To enable: add `candle-core = "0.3"` to Cargo.toml and implement generation loop.
pub fn generate(model_dir: &str, prompt: &str, max_tokens: usize) -> Result<String, SafetensorsError> {
    let model = load_model(model_dir)?;
    let _ = prompt;
    let _ = max_tokens;

    Err(SafetensorsError::NotImplemented(
        format!(
            "Safetensors generation requires candle-core + tokenizer integration. Model config: hidden_size={}, num_heads={}",
            model.config.get("hidden_size").and_then(|v| v.as_u64()).unwrap_or(0),
            model.config.get("num_attention_heads").and_then(|v| v.as_u64()).unwrap_or(0)
        ),
    ))
}

/// Extract entities using safetensors model (requires candle crate)
pub fn extract_entities(model_dir: &str, text: &str) -> Result<Vec<String>, SafetensorsError> {
    let model = load_model(model_dir)?;
    let _ = text;

    Err(SafetensorsError::NotImplemented(
        format!(
            "Entity extraction requires safetensors inference pipeline. Model: {} ({})",
            model.config.get("model_type").and_then(|v| v.as_str()).unwrap_or("unknown"),
            model.shard_count
        ),
    ))
}

/// Classify intent using safetensors model (requires candle crate)
pub fn detect_intent(model_dir: &str, text: &str) -> Result<String, SafetensorsError> {
    let model = load_model(model_dir)?;
    let _ = text;

    Err(SafetensorsError::NotImplemented(
        format!(
            "Intent detection requires candle inference pipeline for {}",
            model.config.get("model_type").and_then(|v| v.as_str()).unwrap_or("safetensors model")
        ),
    ))
}

/// Compress text using safetensors model (requires candle crate)
pub fn compress(model_dir: &str, text: &str, max_tokens: usize) -> Result<String, SafetensorsError> {
    let model = load_model(model_dir)?;
    let _ = text;
    let _ = max_tokens;

    Err(SafetensorsError::NotImplemented(
        format!(
            "Text compression via {} requires candle encoder (shards: {})",
            model.config.get("architectures")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
                .unwrap_or("transformer"),
            model.shard_count
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_model_missing_directory() {
        let result = load_model("/nonexistent/path");
        assert!(result.is_err());
        match result {
            Err(SafetensorsError::ModelNotFound(_)) => (),
            _ => panic!("Expected ModelNotFound error"),
        }
    }

    #[test]
    fn test_load_model_missing_weights() {
        // Create temp dir with config but no weights
        let dir = std::env::temp_dir().join(format!(
            "safetensors_test_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("config.json"), "{}").ok();
        std::fs::write(dir.join("tokenizer.json"), "{}").ok();

        let result = load_model(dir.to_str().unwrap());
        assert!(result.is_err());
        match result {
            Err(SafetensorsError::ModelNotFound(_)) => (),
            _ => panic!("Expected ModelNotFound error for missing weights"),
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_load_real_model_qwen() {
        // Test against real Qwen2.5-3B model if available
        let model_path = "/mnt/data-disk/Data/ONNXModel/translate-tool/models/qwen2.5-3B/";
        if Path::new(model_path).exists() {
            let result = load_model(model_path);
            if let Err(ref e) = result {
                eprintln!("Model load error: {:?}", e);
            }
            assert!(result.is_ok(), "Failed to load Qwen model: {:?}", result.err());

            let model = result.unwrap();
            assert!(model.validated, "Model should be validated");
            assert!(model.shard_count > 0, "Model should have shards");
            // Model type is "qwen2" in config.json
            let model_type = model.config.get("model_type").and_then(|v| v.as_str());
            assert_eq!(model_type, Some("qwen2"), "Expected model_type=qwen2, got {:?}", model_type);
        }
    }

    #[test]
    fn test_embed_requires_real_model() {
        // Test with nonexistent path - should fail on model loading
        let result = embed("/nonexistent/path", "test");
        assert!(result.is_err());
        // Could be ModelNotFound or NotImplemented depending on validation order
        assert!(matches!(result, Err(SafetensorsError::ModelNotFound(_)) | Err(SafetensorsError::NotImplemented(_))));
    }

    #[test]
    fn test_generate_requires_real_model() {
        let result = generate("/nonexistent/path", "test", 100);
        assert!(result.is_err());
        assert!(matches!(result, Err(SafetensorsError::ModelNotFound(_)) | Err(SafetensorsError::NotImplemented(_))));
    }

    #[test]
    fn test_extract_entities_requires_real_model() {
        let result = extract_entities("/nonexistent/path", "test text");
        assert!(result.is_err());
        assert!(matches!(result, Err(SafetensorsError::ModelNotFound(_)) | Err(SafetensorsError::NotImplemented(_))));
    }

    #[test]
    fn test_detect_intent_requires_real_model() {
        let result = detect_intent("/nonexistent/path", "test");
        assert!(result.is_err());
        assert!(matches!(result, Err(SafetensorsError::ModelNotFound(_)) | Err(SafetensorsError::NotImplemented(_))));
    }

    #[test]
    fn test_compress_requires_real_model() {
        let result = compress("/nonexistent/path", "test", 100);
        assert!(result.is_err());
        assert!(matches!(result, Err(SafetensorsError::ModelNotFound(_)) | Err(SafetensorsError::NotImplemented(_))));
    }
}
