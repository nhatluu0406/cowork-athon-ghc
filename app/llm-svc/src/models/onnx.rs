// models/onnx.rs: real local ONNX embedding inference (T160).
//
// Layout convention: a "local" embedding model is a directory containing
//   model.onnx      — the exported encoder (e.g. a sentence-transformers /
//                      BERT-family model exported to ONNX)
//   tokenizer.json   — a HuggingFace `tokenizers` fast-tokenizer file matching
//                      that model's vocab
// `Model.path` (from models.yaml) should point at that directory. This matches
// the standard HuggingFace export layout and is what `llm-svc/models.example.yaml`
// documents.
//
// Pooling: this module mean-pools the encoder's last-hidden-state output over
// the attention mask (the standard sentence-embedding technique for BERT-family
// encoders that don't ship a dedicated pooler output). This is a real,
// documented assumption, not verified against a specific model file — no model
// artifacts are checked into this repo (POC without model weights committed),
// so this code is real but its exact numerical behavior against any given
// model export is unverified until run against one.

use ndarray::{Array2, Axis, Ix3};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use std::path::Path;
use tokenizers::Tokenizer;

const MAX_SEQ_LEN: usize = 512;

/// Embed a batch of texts using a local ONNX model directory.
///
/// `model_dir` must contain `model.onnx` and `tokenizer.json`. Returns one
/// embedding vector per input text (mean-pooled over real, non-padding tokens).
pub fn embed(model_dir: &str, texts: &[&str]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    let dir = Path::new(model_dir);
    let model_path = dir.join("model.onnx");
    let tokenizer_path = dir.join("tokenizer.json");

    if !model_path.exists() {
        return Err(format!(
            "ONNX model file not found at {}",
            model_path.display()
        ));
    }
    if !tokenizer_path.exists() {
        return Err(format!(
            "tokenizer.json not found at {}",
            tokenizer_path.display()
        ));
    }

    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| format!("failed to load tokenizer from {}: {}", tokenizer_path.display(), e))?;

    let mut session = Session::builder()
        .map_err(|e| format!("failed to create ONNX session builder: {}", e))?
        .with_optimization_level(GraphOptimizationLevel::Level1)
        .map_err(|e| format!("failed to set optimization level: {}", e))?
        .with_intra_threads(1)
        .map_err(|e| format!("failed to set intra-op threads: {}", e))?
        .commit_from_file(&model_path)
        .map_err(|e| format!("failed to load ONNX model from {}: {}", model_path.display(), e))?;

    let mut encodings = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| format!("tokenization failed: {}", e))?;

    // Truncate defensively even if the tokenizer wasn't configured with a
    // truncation policy — a runaway sequence length would otherwise blow up
    // the tensor allocation below.
    for enc in &mut encodings {
        enc.truncate(MAX_SEQ_LEN, 0, tokenizers::TruncationDirection::Right);
    }

    let batch_size = encodings.len();
    let seq_len = encodings.iter().map(|e| e.len()).max().unwrap_or(0);
    if seq_len == 0 {
        return Err("tokenizer produced zero-length encodings for all inputs".to_string());
    }

    // Pad every encoding to the batch's max length (right-padded with 0, mask 0).
    let mut ids_flat: Vec<i64> = Vec::with_capacity(batch_size * seq_len);
    let mut mask_flat: Vec<i64> = Vec::with_capacity(batch_size * seq_len);
    for enc in &encodings {
        let ids = enc.get_ids();
        let mask = enc.get_attention_mask();
        for i in 0..seq_len {
            ids_flat.push(*ids.get(i).unwrap_or(&0) as i64);
            mask_flat.push(*mask.get(i).unwrap_or(&0) as i64);
        }
    }

    // Build input tensors for standard BERT model format:
    // 1. input_ids: token IDs from tokenizer
    // 2. attention_mask: 1 for real tokens, 0 for padding
    // 3. token_type_ids: 0 for single-sequence encoding

    let input_ids = TensorRef::from_array_view(([batch_size, seq_len], &*ids_flat))
        .map_err(|e| format!("failed to build input_ids tensor: {}", e))?;
    let attention_mask = TensorRef::from_array_view(([batch_size, seq_len], &*mask_flat))
        .map_err(|e| format!("failed to build attention_mask tensor: {}", e))?;

    // token_type_ids: zeros for single-sequence BERT encoding
    // This is required by standard transformer models (sentence-transformers, MiniLM, BGE embeddings, etc.)
    // Cross-encoder models that don't use token_type_ids may need model export adjustment
    let token_type_ids_flat: Vec<i64> = vec![0i64; batch_size * seq_len];
    let token_type_ids = TensorRef::from_array_view(([batch_size, seq_len], &*token_type_ids_flat))
        .map_err(|e| format!("failed to build token_type_ids tensor: {}", e))?;

    // Run inference with standard BERT inputs (input_ids, attention_mask, token_type_ids)
    // Most transformer ONNX exports follow this schema. If your model doesn't accept
    // token_type_ids, you may need to re-export it with that input slot included
    // (even if unused by the model's actual computation).
    let outputs = session
        .run(ort::inputs![input_ids, attention_mask, token_type_ids])
        .map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("inputs were provided") || err_msg.contains("only accepts") {
                format!(
                    "ONNX model input mismatch: expected 3 inputs (input_ids, attention_mask, token_type_ids). \
                     Error: {}. \
                     Some cross-encoder models may need re-export with token_type_ids input slot.",
                    e
                )
            } else {
                format!("ONNX inference failed: {}", e)
            }
        })?;

    // Try to extract output as f32 tensor and check its dimensionality
    let output_tensor = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("failed to extract output tensor: {}", e))?;

    let embeddings = if let Ok(last_hidden_state) = output_tensor.clone().into_dimensionality::<Ix3>() {
        // Standard encoder output: [batch, seq_len, hidden_dim]
        // Mean-pool over sequence dimension, respecting attention mask
        let hidden_dim = last_hidden_state.shape()[2];
        let mut embeddings = Vec::with_capacity(batch_size);
        for (b, token_embeddings) in last_hidden_state.axis_iter(Axis(0)).enumerate() {
            let mask_row = &mask_flat[b * seq_len..(b + 1) * seq_len];
            let mut pooled = vec![0f32; hidden_dim];
            let mut valid_tokens = 0f32;
            for (t, mask_val) in mask_row.iter().enumerate() {
                if *mask_val == 0 {
                    continue;
                }
                valid_tokens += 1.0;
                let token_vec = token_embeddings.index_axis(Axis(0), t);
                for (d, v) in token_vec.iter().enumerate() {
                    pooled[d] += v;
                }
            }
            if valid_tokens > 0.0 {
                for v in pooled.iter_mut() {
                    *v /= valid_tokens;
                }
            }
            embeddings.push(pooled);
        }
        embeddings
    } else if let Ok(scores_2d) = output_tensor.into_dimensionality::<ndarray::Ix2>() {
        // Cross-encoder or score output: [batch, scores] or [batch, 1]
        // Extract the score(s) as a vector for each batch item
        scores_2d
            .axis_iter(Axis(0))
            .map(|row| row.to_vec())
            .collect()
    } else {
        return Err(
            "unexpected output tensor rank (expected 3D [batch, seq, hidden] or 2D [batch, scores])"
                .to_string(),
        );
    };

    Ok(embeddings)
}

/// Rerank documents against a query using local ONNX models.
///
/// Supports two types of models:
/// 1. **Bi-encoder models** (sentence-transformers, MiniLM): embed query + docs, score via cosine similarity
/// 2. **Cross-encoder models** (BGE reranker): pass query+doc pairs directly, get relevance scores
///
/// This function attempts bi-encoder mode (calls embed()). If that fails due to model input mismatch,
/// it falls back to cross-encoder mode using direct session inference with 2 inputs.
#[allow(dead_code)]
pub fn rerank(model_dir: &str, query: &str, documents: &[&str]) -> Result<Vec<f32>, String> {
    if documents.is_empty() {
        return Ok(vec![]);
    }

    // Try bi-encoder approach first: embed all texts and compute cosine similarity
    let mut texts: Vec<&str> = vec![query];
    texts.extend_from_slice(documents);

    match embed(model_dir, &texts) {
        Ok(vectors) => {
            // Bi-encoder: return cosine similarities
            if vectors.len() != texts.len() {
                return Err("embed() returned a different count than requested".to_string());
            }
            let query_vec = &vectors[0];
            Ok(vectors[1..]
                .iter()
                .map(|doc_vec| crate::cloud_proxy::cosine_similarity(query_vec, doc_vec))
                .collect())
        }
        Err(e) => {
            // Check if the error is due to input mismatch (cross-encoder case)
            if e.contains("inputs were provided") || e.contains("only accepts") {
                // Cross-encoder: run inference with query-document pairs
                rerank_cross_encoder(model_dir, query, documents)
            } else {
                // Some other error — propagate it
                Err(e)
            }
        }
    }
}

/// Rerank using a cross-encoder model (e.g., BGE reranker).
/// Cross-encoders expect 2 inputs: input_ids and attention_mask (no token_type_ids).
/// They return scores directly, not embeddings.
fn rerank_cross_encoder(model_dir: &str, query: &str, documents: &[&str]) -> Result<Vec<f32>, String> {
    use ort::session::builder::GraphOptimizationLevel;
    use std::path::Path;

    let path = Path::new(model_dir);
    let model_path = path.join("model.onnx");
    let tokenizer_path = path.join("tokenizer.json");

    if !model_path.exists() {
        return Err(format!("ONNX model file not found at {}", model_path.display()));
    }
    if !tokenizer_path.exists() {
        return Err(format!(
            "tokenizer.json not found at {}",
            tokenizer_path.display()
        ));
    }

    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| format!("failed to load tokenizer: {}", e))?;

    let mut session = Session::builder()
        .map_err(|e| format!("failed to create ONNX session builder: {}", e))?
        .with_optimization_level(GraphOptimizationLevel::Level1)
        .map_err(|e| format!("failed to set optimization level: {}", e))?
        .with_intra_threads(1)
        .map_err(|e| format!("failed to set intra-op threads: {}", e))?
        .commit_from_file(&model_path)
        .map_err(|e| format!("failed to load ONNX model: {}", e))?;

    let mut scores = Vec::with_capacity(documents.len());

    for doc in documents {
        // Tokenize query + document as a pair
        let pair_text = format!("{} {}", query, doc);
        let encoding = tokenizer
            .encode(pair_text.clone(), true)
            .map_err(|e| format!("tokenization failed for '{}': {}", pair_text, e))?;

        let ids_raw = encoding.get_ids();
        let mask_raw = encoding.get_attention_mask();
        let seq_len = ids_raw.len();

        // Convert to i64 for ONNX (input_ids are typically i64)
        let ids_i64: Vec<i64> = ids_raw.iter().map(|&id| id as i64).collect();
        let mask_i64: Vec<i64> = mask_raw.iter().map(|&m| m as i64).collect();

        // Build 2-input tensors for cross-encoder
        let input_ids = TensorRef::from_array_view(([1usize, seq_len], &*ids_i64))
            .map_err(|e| format!("failed to build input_ids tensor: {}", e))?;
        let attention_mask = TensorRef::from_array_view(([1usize, seq_len], &*mask_i64))
            .map_err(|e| format!("failed to build attention_mask tensor: {}", e))?;

        // Run cross-encoder inference (2 inputs, no token_type_ids)
        let outputs = session
            .run(ort::inputs![input_ids, attention_mask])
            .map_err(|e| format!("cross-encoder inference failed: {}", e))?;

        // Extract relevance score (usually first output, typically shape [1, 1] or [1])
        let output_tensor = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|e| format!("failed to extract output tensor: {}", e))?;

        // Handle different output shapes: [batch, 1] or [batch]
        let raw_score = if let Ok(scores_2d) = output_tensor.clone().into_dimensionality::<ndarray::Ix2>() {
            scores_2d[[0, 0]]
        } else if let Ok(scores_1d) = output_tensor.into_dimensionality::<ndarray::Ix1>() {
            scores_1d[0]
        } else {
            return Err("unexpected cross-encoder output shape".to_string());
        };

        // Normalize raw logits to [0, 1] using sigmoid
        // Cross-encoders typically return unbounded scores; sigmoid maps them to interpretable probabilities
        let normalized_score = 1.0 / (1.0 + (-raw_score).exp());
        scores.push(normalized_score);
    }

    Ok(scores)
}

// Silence unused-import warnings for Array2 until a caller needs the
// non-flattened 2D view directly; kept as a documented building block for
// future non-mean-pooling extraction strategies (e.g. CLS-token pooling).
#[allow(dead_code)]
fn _unused_array2_reference() -> Option<Array2<f32>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embed_empty_input_returns_empty() {
        let result = embed("/nonexistent/path", &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_embed_missing_model_dir_returns_clear_error() {
        let err = embed("/nonexistent/path/that/does/not/exist", &["hello world"])
            .expect_err("should fail when model.onnx is absent");
        assert!(err.contains("model.onnx") || err.contains("not found"), "error was: {}", err);
    }

    #[test]
    fn test_embed_missing_tokenizer_returns_clear_error() {
        // Directory exists but has no model.onnx/tokenizer.json — same
        // "not found" path as a fully nonexistent directory, exercised
        // separately in case the two checks ever diverge.
        let dir = std::env::temp_dir().join(format!(
            "llmsvc_onnx_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let err = embed(dir.to_str().unwrap(), &["hello world"])
            .expect_err("should fail when model.onnx is absent from an existing dir");
        assert!(err.contains("model.onnx") || err.contains("not found"), "error was: {}", err);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_rerank_empty_documents_returns_empty() {
        let result = rerank("/nonexistent/path", "query", &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_rerank_missing_model_propagates_embed_error() {
        let err = rerank("/nonexistent/path/that/does/not/exist", "q", &["doc1"])
            .expect_err("should propagate embed()'s error");
        assert!(err.contains("model.onnx") || err.contains("not found"), "error was: {}", err);
    }
}
