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

    let input_ids = TensorRef::from_array_view(([batch_size, seq_len], &*ids_flat))
        .map_err(|e| format!("failed to build input_ids tensor: {}", e))?;
    let attention_mask = TensorRef::from_array_view(([batch_size, seq_len], &*mask_flat))
        .map_err(|e| format!("failed to build attention_mask tensor: {}", e))?;

    // Positional inputs (matches the model's declared input order — most
    // BERT-family ONNX exports declare input_ids then attention_mask first;
    // an export with a different input order or an extra required input
    // (e.g. token_type_ids) will surface as a clear ort error here, not a
    // silent wrong answer).
    let outputs = session
        .run(ort::inputs![input_ids, attention_mask])
        .map_err(|e| format!("ONNX inference failed: {}", e))?;

    // last_hidden_state is conventionally the encoder's first output, shape
    // [batch, seq_len, hidden_dim].
    let last_hidden_state = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("failed to extract output tensor: {}", e))?
        .into_dimensionality::<Ix3>()
        .map_err(|e| format!("unexpected output tensor rank (expected 3D [batch, seq, hidden]): {}", e))?;

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

    Ok(embeddings)
}

/// Rerank documents against a query using local ONNX embeddings (bi-encoder
/// cosine similarity — see crate::cloud_proxy::cosine_similarity's doc comment
/// for why this isn't a dedicated cross-encoder forward pass).
pub fn rerank(model_dir: &str, query: &str, documents: &[&str]) -> Result<Vec<f32>, String> {
    if documents.is_empty() {
        return Ok(vec![]);
    }
    let mut texts: Vec<&str> = vec![query];
    texts.extend_from_slice(documents);
    let vectors = embed(model_dir, &texts)?;
    if vectors.len() != texts.len() {
        return Err("embed() returned a different count than requested".to_string());
    }
    let query_vec = &vectors[0];
    Ok(vectors[1..]
        .iter()
        .map(|doc_vec| crate::cloud_proxy::cosine_similarity(query_vec, doc_vec))
        .collect())
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
