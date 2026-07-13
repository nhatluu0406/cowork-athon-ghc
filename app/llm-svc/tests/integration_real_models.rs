//! Integration tests with real ONNX models from /mnt/data-disk/Data/ONNXModel/models
//!
//! These tests verify ONNX embedding inference works end-to-end with real model files.
//! Expected model structure:
//!   model_root/
//!     ├── onnx/model.onnx          (actual model file)
//!     └── tokenizer.json            (HuggingFace tokenizer)

#[cfg(test)]
mod real_model_tests {
    use std::path::Path;
    use std::fs;
    use std::io;

    /// Setup symlinks or copies to create the expected model directory structure
    /// Returns the temp directory path where model files are accessible in expected layout
    fn setup_model_structure(
        _source_model_dir: &str,
        source_onnx_file: &str,
        source_tokenizer: &str,
    ) -> Result<String, io::Error> {
        use std::thread;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Use a unique temp dir per test to avoid conflicts when tests run in parallel
        let temp_base = "/tmp/llm_svc_test_models";
        let _ = fs::create_dir_all(temp_base);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let thread_id = format!("{:?}", thread::current().id());
        let temp_dir = format!("{}/model_{}_{}", temp_base, timestamp, thread_id);

        // Clean up old test directory if it exists
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir)?;

        // Copy model.onnx directly to root (not in onnx/ subdirectory)
        // The ONNX code expects: dir/model.onnx and dir/tokenizer.json
        if Path::new(source_onnx_file).exists() {
            fs::copy(source_onnx_file, format!("{}/model.onnx", temp_dir))?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Source model not found: {}", source_onnx_file),
            ));
        }

        // Copy tokenizer.json to root of temp directory
        if Path::new(source_tokenizer).exists() {
            fs::copy(source_tokenizer, format!("{}/tokenizer.json", temp_dir))?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Source tokenizer not found: {}", source_tokenizer),
            ));
        }

        Ok(temp_dir)
    }

    /// Test embedding with real all-MiniLM-L6-v2 model
    #[test]
    fn test_embed_real_minilm_model() {
        let source_model = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/onnx/model.onnx";
        let source_tokenizer = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/tokenizer.json";

        let model_dir = match setup_model_structure(
            "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2",
            source_model,
            source_tokenizer,
        ) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("⚠️  Skipping test: {}", e);
                return;
            }
        };

        // Try to load and use the model
        match llm_svc::models::onnx::embed(&model_dir, &["hello world", "test"]) {
            Ok(embeddings) => {
                assert_eq!(embeddings.len(), 2, "Should return 2 embeddings");
                assert!(embeddings[0].len() > 0, "First embedding should not be empty");
                assert!(embeddings[1].len() > 0, "Second embedding should not be empty");

                // Check embedding dimensions (MiniLM typically produces 384-dim embeddings)
                let expected_dims = 384;
                assert_eq!(embeddings[0].len(), expected_dims,
                    "Expected {} dimensions, got {}", expected_dims, embeddings[0].len());
                println!("✅ Embedding test passed: 2 texts -> {} dimensions", embeddings[0].len());
            }
            Err(e) => {
                panic!("ONNX embed failed: {}", e);
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&model_dir);
    }

    /// Test reranking with real bge-reranker-base model
    #[test]
    fn test_rerank_real_bge_model() {
        let source_model = "/mnt/data-disk/Data/ONNXModel/models/bge-reranker-base/onnx/model.onnx";
        let source_tokenizer = "/mnt/data-disk/Data/ONNXModel/models/bge-reranker-base/tokenizer.json";

        // Verify source files exist
        if !Path::new(source_model).exists() {
            println!("⚠️  bge-reranker-base model not found, skipping test");
            return;
        }

        let model_dir = match setup_model_structure(
            "/mnt/data-disk/Data/ONNXModel/models/bge-reranker-base",
            source_model,
            source_tokenizer,
        ) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("⚠️  Skipping test: {}", e);
                return;
            }
        };

        // Test reranking
        let query = "what is machine learning";
        let documents = vec![
            "Machine learning is a subset of AI",
            "Python is a programming language",
            "Deep learning uses neural networks",
        ];

        match llm_svc::models::onnx::rerank(&model_dir, query, &documents) {
            Ok(scores) => {
                assert_eq!(scores.len(), documents.len(), "Should return score per document");

                // Verify scores are in valid range
                for (i, &score) in scores.iter().enumerate() {
                    assert!(score >= 0.0 && score <= 1.0,
                        "Score {} out of range: {}", i, score);
                    println!("  Doc {}: {:.4}", i, score);
                }
                println!("✅ Reranking test passed: {} documents scored", documents.len());
            }
            Err(e) => {
                panic!("ONNX rerank failed: {}", e);
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&model_dir);
    }

    /// Test embedding quality - similar texts should have high similarity
    #[test]
    fn test_embedding_semantic_similarity() {
        let source_model = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/onnx/model.onnx";
        let source_tokenizer = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/tokenizer.json";

        let model_dir = match setup_model_structure(
            "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2",
            source_model,
            source_tokenizer,
        ) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("⚠️  Skipping test: {}", e);
                return;
            }
        };

        let texts = vec![
            "The cat sat on the mat",
            "A feline was resting on the rug",  // Similar meaning
            "The weather is sunny today",        // Different meaning
        ];

        match llm_svc::models::onnx::embed(&model_dir, &texts) {
            Ok(embeddings) => {
                // Compute cosine similarity
                let sim_01 = cosine_similarity(&embeddings[0], &embeddings[1]);
                let sim_02 = cosine_similarity(&embeddings[0], &embeddings[2]);

                println!("  Similarity (0,1): {:.4} (should be high)", sim_01);
                println!("  Similarity (0,2): {:.4} (should be low)", sim_02);

                // Similar texts should have higher similarity
                assert!(sim_01 > sim_02,
                    "Similar texts should have higher similarity: {:.4} > {:.4}",
                    sim_01, sim_02);
                println!("✅ Semantic similarity test passed");
            }
            Err(e) => {
                panic!("Embedding failed: {}", e);
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&model_dir);
    }

    /// Test batch embedding with various text lengths
    #[test]
    fn test_batch_embedding_various_lengths() {
        let source_model = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/onnx/model.onnx";
        let source_tokenizer = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/tokenizer.json";

        let model_dir = match setup_model_structure(
            "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2",
            source_model,
            source_tokenizer,
        ) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("⚠️  Skipping test: {}", e);
                return;
            }
        };

        let texts = vec![
            "Hi",                                          // Very short
            "This is a medium length sentence",           // Medium
            "This is a much longer sentence that contains multiple clauses and ideas to test how the model handles longer texts without exceeding the maximum sequence length that the tokenizer supports", // Long
        ];

        match llm_svc::models::onnx::embed(&model_dir, &texts) {
            Ok(embeddings) => {
                assert_eq!(embeddings.len(), 3, "Should embed all 3 texts");

                // All should have same dimensions despite different lengths
                for (i, emb) in embeddings.iter().enumerate() {
                    assert_eq!(emb.len(), 384,
                        "Text {} embedding should have 384 dims", i);
                }
                println!("✅ Batch embedding test passed: {} texts of varying lengths", texts.len());
            }
            Err(e) => {
                panic!("Batch embedding failed: {}", e);
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&model_dir);
    }

    /// Test empty input handling
    #[test]
    fn test_embed_empty_input() {
        let source_model = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/onnx/model.onnx";
        let source_tokenizer = "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2/tokenizer.json";

        let model_dir = match setup_model_structure(
            "/mnt/data-disk/Data/ONNXModel/models/all-MiniLM-L6-v2",
            source_model,
            source_tokenizer,
        ) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("⚠️  Skipping test: {}", e);
                return;
            }
        };

        match llm_svc::models::onnx::embed(&model_dir, &[]) {
            Ok(embeddings) => {
                assert!(embeddings.is_empty(), "Empty input should return empty result");
                println!("✅ Empty input handling test passed");
            }
            Err(e) => {
                panic!("Empty input test failed: {}", e);
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&model_dir);
    }

    /// Helper: compute cosine similarity between two vectors
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let mut dot_product = 0.0;
        let mut norm_a = 0.0;
        let mut norm_b = 0.0;

        for (ai, bi) in a.iter().zip(b.iter()) {
            dot_product += ai * bi;
            norm_a += ai * ai;
            norm_b += bi * bi;
        }

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a.sqrt() * norm_b.sqrt())
    }
}
