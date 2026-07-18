// service.rs: LlmSvc trait implementation for all RPCs

use crate::cloud_proxy::{cosine_similarity, CloudProxyClient, EmbedProxyClient};
use crate::config::Config;
use crate::llmsvc::{
    llm_svc_server::LlmSvc, CompressRequest, CompressResponse, Entity,
    EmbedRequest, EmbedResponse, ExtractRequest, ExtractResponse, GenerateRequest,
    GenerateResponse, HealthRequest, HealthResponse, IntentRequest, IntentResponse,
    ListModelsRequest, ListModelsResponse, ModelInfo, Relationship, RerankRequest,
    RerankResponse, RerankResult,
};
use crate::routing::{Router, RouteDecision};
use std::collections::HashMap;
use tonic::{Request, Response, Status};
use tracing::{debug, info, warn};

/// Serialize an embedding vector to little-endian float32 bytes, matching the
/// wire format `internal/embedding/store.go` already expects on the Go side.
fn encode_embedding(v: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(v.len() * 4);
    for f in v {
        buf.extend_from_slice(&f.to_le_bytes());
    }
    buf
}

/// LlmSvcImpl is the gRPC service implementation for all LLM-shaped operations.
#[derive(Clone)]
pub struct LlmSvcImpl {
    config: Config,
    router: Router,
    cloud_proxy: Option<CloudProxyClient>,
    /// Separate OpenAI-compatible embedding client (used when cloud_proxy is Anthropic).
    embed_proxy: Option<EmbedProxyClient>,
}

impl LlmSvcImpl {
    /// Create a new LlmSvc instance with the given configuration.
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let has_local_models = true; // TODO: Check if local models are actually available
        let cloud_proxy = CloudProxyClient::from_env().ok().flatten();
        let embed_proxy = EmbedProxyClient::from_env().ok().flatten();
        let has_cloud_config = cloud_proxy.is_some();

        let router = Router::new(config.nlp_mode, has_local_models, has_cloud_config);

        info!(
            "LlmSvcImpl initialized: mode={:?}, has_local={}, has_cloud={}, has_embed_proxy={}",
            config.nlp_mode, has_local_models, has_cloud_config, embed_proxy.is_some()
        );

        Ok(LlmSvcImpl {
            config,
            router,
            cloud_proxy,
            embed_proxy,
        })
    }
}

#[tonic::async_trait]
impl LlmSvc for LlmSvcImpl {
    /// Embed generates embeddings for a batch of texts.
    async fn embed(
        &self,
        request: Request<EmbedRequest>,
    ) -> Result<Response<EmbedResponse>, Status> {
        let req = request.into_inner();
        info!(
            "Embed RPC called with {} texts, model: {}",
            req.texts.len(),
            if req.model_name.is_empty() { "default" } else { req.model_name.as_str() }
        );

        // Route decision: embed should prefer local ONNX, fallback to cloud.
        // When cloud_proxy is Anthropic (no embedding API), use embed_proxy if configured,
        // else fall through to local ONNX.
        match self.router.route("embed") {
            RouteDecision::Cloud => {
                // Try dedicated embed proxy first (works with any primary LLM provider)
                if let Some(embed_proxy) = &self.embed_proxy {
                    let model = if req.model_name.is_empty() { "text-embedding-3-small" } else { &req.model_name };
                    match embed_proxy.embed(&req.texts, model).await {
                        Ok(vectors) => {
                            let dimensions = vectors.first().map(|v| v.len()).unwrap_or(0) as i32;
                            let embeddings = vectors.iter().map(|v| encode_embedding(v)).collect();
                            return Ok(Response::new(EmbedResponse {
                                embeddings,
                                model_name: req.model_name,
                                dimensions,
                                error: String::new(),
                            }));
                        }
                        Err(e) => {
                            warn!("Embed proxy failed, falling back to local: {}", e);
                            // Fall through to local ONNX below
                        }
                    }
                }
                // Use cloud_proxy embed only when NOT Anthropic (Anthropic has no embedding API)
                if let Some(proxy) = &self.cloud_proxy {
                    if !proxy.is_anthropic() {
                        match proxy.embed(&req.texts, Some(&req.model_name)).await {
                            Ok(vectors) => {
                                let dimensions = vectors.first().map(|v| v.len()).unwrap_or(0) as i32;
                                let embeddings =
                                    vectors.iter().map(|v| encode_embedding(v)).collect();
                                return Ok(Response::new(EmbedResponse {
                                    embeddings,
                                    model_name: req.model_name,
                                    dimensions,
                                    error: String::new(),
                                }));
                            }
                            Err(e) => {
                                warn!("Cloud embedding failed: {}", e);
                                return Err(Status::internal(format!("Embedding failed: {}", e)));
                            }
                        }
                    }
                }
                // Anthropic + no embed_proxy: degrade to local ONNX
                warn!("No embedding provider configured (Anthropic has no embedding API); falling back to local ONNX");
                // Fall through to local ONNX path by re-routing
                let model = if req.model_name.is_empty() {
                    self.config
                        .models_registry
                        .get_default(crate::models::ModelKind::Embedding)
                } else {
                    self.config.models_registry.get(&req.model_name)
                };
                let Some(model) = model else {
                    return Err(Status::failed_precondition(
                        "No local embedding model configured. Set EMBED_API_BASE_URL+EMBED_API_KEY for cloud embeddings, or configure a local ONNX model.",
                    ));
                };
                if model.format != crate::models::ModelFormat::Onnx {
                    return Err(Status::failed_precondition(format!(
                        "Model '{}' is not ONNX; cannot use for local embedding fallback",
                        model.name
                    )));
                }
                let model_dir = model.path.clone();
                let texts: Vec<String> = req.texts.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
                    crate::models::onnx::embed(&model_dir, &text_refs)
                })
                .await
                .map_err(|e| Status::internal(format!("embedding task panicked: {}", e)))?;
                match result {
                    Ok(vectors) => {
                        let dimensions = vectors.first().map(|v| v.len()).unwrap_or(0) as i32;
                        let embeddings = vectors.iter().map(|v| encode_embedding(v)).collect();
                        Ok(Response::new(EmbedResponse {
                            embeddings,
                            model_name: model.name,
                            dimensions,
                            error: String::new(),
                        }))
                    }
                    Err(e) => {
                        warn!("Local ONNX embedding failed: {}", e);
                        Err(Status::internal(format!("Local embedding failed: {}", e)))
                    }
                }
            }
            RouteDecision::Local => {
                let model = if req.model_name.is_empty() {
                    self.config
                        .models_registry
                        .get_default(crate::models::ModelKind::Embedding)
                } else {
                    self.config.models_registry.get(&req.model_name)
                };
                let Some(model) = model else {
                    return Err(Status::failed_precondition(
                        "No local embedding model configured (models.yaml)",
                    ));
                };
                if model.format != crate::models::ModelFormat::Onnx {
                    return Err(Status::failed_precondition(format!(
                        "Model '{}' is not an ONNX model (format: {})",
                        model.name,
                        model.format.as_str()
                    )));
                }

                let model_dir = model.path.clone();
                let texts: Vec<String> = req.texts.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
                    crate::models::onnx::embed(&model_dir, &text_refs)
                })
                .await
                .map_err(|e| Status::internal(format!("embedding task panicked: {}", e)))?;

                match result {
                    Ok(vectors) => {
                        let dimensions = vectors.first().map(|v| v.len()).unwrap_or(0) as i32;
                        let embeddings = vectors.iter().map(|v| encode_embedding(v)).collect();
                        Ok(Response::new(EmbedResponse {
                            embeddings,
                            model_name: model.name,
                            dimensions,
                            error: String::new(),
                        }))
                    }
                    Err(e) => {
                        warn!("Local ONNX embedding failed: {}", e);
                        Err(Status::internal(format!("Local embedding failed: {}", e)))
                    }
                }
            }
            RouteDecision::Error => Err(Status::failed_precondition("Cannot route Embed request")),
        }
    }

    /// Rerank scores documents against a query.
    async fn rerank(
        &self,
        request: Request<RerankRequest>,
    ) -> Result<Response<RerankResponse>, Status> {
        let req = request.into_inner();
        info!(
            "Rerank RPC called with {} documents, model: {}",
            req.documents.len(),
            if req.model_name.is_empty() { "default" } else { req.model_name.as_str() }
        );

        // Route decision: rerank should prefer local ONNX, fallback to cloud.
        // Both paths score relevance as query/document embedding cosine similarity
        // (a bi-encoder approach) rather than a dedicated cross-encoder forward
        // pass — see cosine_similarity's doc comment for why.
        match self.router.route("rerank") {
            RouteDecision::Cloud => {
                if let Some(proxy) = &self.cloud_proxy {
                    let mut texts: Vec<String> = vec![req.query.clone()];
                    texts.extend(req.documents.iter().map(|d| d.text.clone()));
                    match proxy.embed(&texts, None).await {
                        Ok(vectors) if vectors.len() == texts.len() => {
                            let query_vec = &vectors[0];
                            let mut results: Vec<RerankResult> = req
                                .documents
                                .iter()
                                .zip(vectors[1..].iter())
                                .map(|(doc, doc_vec)| RerankResult {
                                    doc_id: doc.doc_id.clone(),
                                    score: cosine_similarity(query_vec, doc_vec),
                                    rank: 0,
                                })
                                .collect();
                            results.sort_by(|a, b| {
                                b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
                            });
                            for (i, r) in results.iter_mut().enumerate() {
                                r.rank = (i + 1) as i32;
                            }
                            if req.top_k > 0 {
                                results.truncate(req.top_k as usize);
                            }
                            Ok(Response::new(RerankResponse {
                                results,
                                model_name: req.model_name,
                                error: String::new(),
                            }))
                        }
                        Ok(_) => Err(Status::internal(
                            "Rerank embedding count mismatch from cloud provider",
                        )),
                        Err(e) => {
                            warn!("Cloud reranking failed: {}", e);
                            Err(Status::internal(format!("Reranking failed: {}", e)))
                        }
                    }
                } else {
                    Err(Status::unavailable("No cloud proxy configured"))
                }
            }
            RouteDecision::Local => {
                let model = if req.model_name.is_empty() {
                    self.config
                        .models_registry
                        .get_default(crate::models::ModelKind::Embedding)
                } else {
                    self.config.models_registry.get(&req.model_name)
                };
                let Some(model) = model else {
                    return Err(Status::failed_precondition(
                        "No local embedding model configured for reranking (models.yaml)",
                    ));
                };

                let model_dir = model.path.clone();
                let mut texts: Vec<String> = vec![req.query.clone()];
                texts.extend(req.documents.iter().map(|d| d.text.clone()));
                let doc_count = req.documents.len();

                let result = tokio::task::spawn_blocking(move || {
                    let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
                    crate::models::onnx::embed(&model_dir, &text_refs)
                })
                .await
                .map_err(|e| Status::internal(format!("reranking task panicked: {}", e)))?;

                match result {
                    Ok(vectors) if vectors.len() == doc_count + 1 => {
                        let query_vec = &vectors[0];
                        let mut results: Vec<RerankResult> = req
                            .documents
                            .iter()
                            .zip(vectors[1..].iter())
                            .map(|(doc, doc_vec)| RerankResult {
                                doc_id: doc.doc_id.clone(),
                                score: cosine_similarity(query_vec, doc_vec),
                                rank: 0,
                            })
                            .collect();
                        results.sort_by(|a, b| {
                            b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        for (i, r) in results.iter_mut().enumerate() {
                            r.rank = (i + 1) as i32;
                        }
                        if req.top_k > 0 {
                            results.truncate(req.top_k as usize);
                        }
                        Ok(Response::new(RerankResponse {
                            results,
                            model_name: model.name,
                            error: String::new(),
                        }))
                    }
                    Ok(_) => Err(Status::internal(
                        "Rerank embedding count mismatch from local ONNX model",
                    )),
                    Err(e) => {
                        warn!("Local ONNX reranking failed: {}", e);
                        Err(Status::internal(format!("Local reranking failed: {}", e)))
                    }
                }
            }
            RouteDecision::Error => Err(Status::failed_precondition("Cannot route Rerank request")),
        }
    }

    /// ExtractEntities performs NLP entity and relationship extraction.
    async fn extract_entities(
        &self,
        request: Request<ExtractRequest>,
    ) -> Result<Response<ExtractResponse>, Status> {
        let req = request.into_inner();
        info!(
            "ExtractEntities RPC called with task_mode: {}, model: {}",
            req.task_mode,
            if req.model_name.is_empty() { "default" } else { req.model_name.as_str() }
        );

        match self.router.route("extract_entities") {
            RouteDecision::Cloud => {
                if let Some(proxy) = &self.cloud_proxy {
                    match proxy.extract(&req.text).await {
                        Ok((entities, relationships)) => {
                            let proto_entities = entities
                                .into_iter()
                                .map(|e| Entity {
                                    name: e.clone(),
                                    r#type: "extracted".to_string(),
                                    confidence: 0.95,
                                    metadata: "{}".to_string(),
                                })
                                .collect();
                            let proto_rels = relationships
                                .into_iter()
                                .map(|(rel, _)| Relationship {
                                    from_entity: "entity".to_string(),
                                    relationship_type: rel,
                                    to_entity: "entity".to_string(),
                                    confidence: 0.9,
                                    metadata: "{}".to_string(),
                                })
                                .collect();

                            Ok(Response::new(ExtractResponse {
                                entities: proto_entities,
                                relationships: proto_rels,
                                model_name: req.model_name,
                                error: String::new(),
                            }))
                        }
                        Err(e) => {
                            warn!("Cloud extraction failed: {}", e);
                            Err(Status::internal(format!("Extraction failed: {}", e)))
                        }
                    }
                } else {
                    Err(Status::unavailable("No cloud proxy configured"))
                }
            }
            RouteDecision::Local => {
                // Phase 2: Implement local GGUF extraction
                warn!("Local GGUF extraction not implemented in Phase 1 (stub)");
                Err(Status::unimplemented(
                    "Local GGUF extraction not yet implemented",
                ))
            }
            RouteDecision::Error => {
                Err(Status::failed_precondition("Cannot route ExtractEntities request"))
            }
        }
    }

    /// Compress reduces context size for Stage 6 of retrieval pipeline.
    async fn compress(
        &self,
        request: Request<CompressRequest>,
    ) -> Result<Response<CompressResponse>, Status> {
        let req = request.into_inner();
        info!(
            "Compress RPC called with method: {}, target_tokens: {}",
            req.method, req.target_tokens
        );

        match self.router.route("compress") {
            RouteDecision::Cloud => {
                if let Some(proxy) = &self.cloud_proxy {
                    match proxy
                        .compress(&req.context, req.target_tokens, &req.query)
                        .await
                    {
                        Ok(compressed) => {
                            // Approximate token counts the same way context_packer.go does
                            // (len/4) — llm-svc doesn't have access to the target LLM's
                            // real tokenizer either.
                            let original_tokens = (req.context.len() / 4).max(1) as i32;
                            let compressed_tokens = (compressed.len() / 4) as i32;
                            let compression_ratio = compressed_tokens as f32 / original_tokens as f32;
                            Ok(Response::new(CompressResponse {
                                compressed_context: compressed,
                                original_tokens,
                                compressed_tokens,
                                compression_ratio,
                                error: String::new(),
                            }))
                        }
                        Err(e) => {
                            warn!("Cloud compression failed: {}", e);
                            Err(Status::internal(format!("Compression failed: {}", e)))
                        }
                    }
                } else {
                    Err(Status::unavailable("No cloud proxy configured"))
                }
            }
            RouteDecision::Local => {
                // T161: Implement local compression via GGUF
                warn!("Local GGUF compression not implemented (stub)");
                Err(Status::unimplemented(
                    "Local GGUF compression not yet implemented",
                ))
            }
            RouteDecision::Error => {
                Err(Status::failed_precondition("Cannot route Compress request"))
            }
        }
    }

    /// DetectIntent classifies user's intent (Stage 1 of retrieval pipeline).
    async fn detect_intent(
        &self,
        request: Request<IntentRequest>,
    ) -> Result<Response<IntentResponse>, Status> {
        let req = request.into_inner();
        info!("DetectIntent RPC called with query: {}", req.query);

        match self.router.route("detect_intent") {
            RouteDecision::Cloud => {
                if let Some(proxy) = &self.cloud_proxy {
                    match proxy.detect_intent(&req.query).await {
                        Ok(intent) => Ok(Response::new(IntentResponse {
                            intent,
                            confidence: 0.85,
                            attributes: "{}".to_string(),
                            error: String::new(),
                        })),
                        Err(e) => {
                            warn!("Cloud intent detection failed: {}", e);
                            Err(Status::internal(format!(
                                "Intent detection failed: {}",
                                e
                            )))
                        }
                    }
                } else {
                    Err(Status::unavailable("No cloud proxy configured"))
                }
            }
            RouteDecision::Local => {
                // Phase 2: Implement local GGUF intent detection
                // For now, simple rule-based fallback
                let intent = self.simple_intent_detection(&req.query);
                Ok(Response::new(IntentResponse {
                    intent,
                    confidence: 0.75,
                    attributes: "{}".to_string(),
                    error: String::new(),
                }))
            }
            RouteDecision::Error => {
                Err(Status::failed_precondition("Cannot route DetectIntent request"))
            }
        }
    }

    /// Generate produces an answer to a user query (Stage 7 of retrieval pipeline).
    async fn generate(
        &self,
        request: Request<GenerateRequest>,
    ) -> Result<Response<GenerateResponse>, Status> {
        let req = request.into_inner();
        info!("Generate RPC called with query: {}", req.query);

        match self.router.route("generate") {
            RouteDecision::Cloud => {
                if let Some(proxy) = &self.cloud_proxy {
                    let temp = if req.temperature > 0.0 {
                        req.temperature
                    } else {
                        0.7
                    };
                    match proxy
                        .generate(
                            &format!("Context: {}\n\nQuestion: {}", req.context, req.query),
                            req.max_tokens as i32,
                            temp,
                        )
                        .await
                    {
                        Ok(answer) => {
                            let latency_ms = 0; // TODO: Track actual latency
                            Ok(Response::new(GenerateResponse {
                                answer,
                                citations: vec![],
                                model_name: req.model_name,
                                tokens_used: 0,
                                latency_ms,
                                error: String::new(),
                            }))
                        }
                        Err(e) => {
                            warn!("Cloud generation failed: {}", e);
                            Err(Status::internal(format!("Generation failed: {}", e)))
                        }
                    }
                } else {
                    Err(Status::unavailable("No cloud proxy configured"))
                }
            }
            RouteDecision::Local => {
                // Phase 2: Implement local GGUF generation
                warn!("Local GGUF generation not implemented in Phase 1 (stub)");
                Err(Status::unimplemented(
                    "Local GGUF generation not yet implemented",
                ))
            }
            RouteDecision::Error => {
                Err(Status::failed_precondition("Cannot route Generate request"))
            }
        }
    }

    /// Health checks the service's liveness.
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        debug!("Health RPC called");
        let mut checks = HashMap::new();
        checks.insert("llm_svc".to_string(), "ok".to_string());

        if self.cloud_proxy.is_some() {
            checks.insert("cloud_proxy".to_string(), "configured".to_string());
        } else {
            checks.insert("cloud_proxy".to_string(), "not_configured".to_string());
        }

        checks.insert(
            "nlp_mode".to_string(),
            format!("{:?}", self.config.nlp_mode),
        );

        Ok(Response::new(HealthResponse {
            status: "SERVING".to_string(),
            message: "llm-svc is running".to_string(),
            checks,
        }))
    }

    /// ListModels returns available embedding and generative models.
    async fn list_models(
        &self,
        request: Request<ListModelsRequest>,
    ) -> Result<Response<ListModelsResponse>, Status> {
        let req = request.into_inner();
        debug!(
            "ListModels RPC called with filter: {}",
            if req.model_kind.is_empty() { "all" } else { req.model_kind.as_str() }
        );

        // T166: read from the hot-reloadable registry, not the startup-time
        // snapshot in self.config.models — a models.yaml edit takes effect here
        // without a rebuild/restart.
        let registry_models = if req.model_kind.is_empty() {
            self.config.models_registry.list(None)
        } else if let Some(kind) = crate::models::ModelKind::from_str(&req.model_kind) {
            self.config.models_registry.list(Some(kind))
        } else {
            // Unrecognized filter value: no models match, matching the prior
            // string-equality filter's behavior for garbage input.
            vec![]
        };
        let models: Vec<ModelInfo> = registry_models
            .into_iter()
            .map(|m| ModelInfo {
                name: m.name.clone(),
                kind: m.kind.as_str().to_string(),
                format: m.format.as_str().to_string(),
                dimensions: m.dimensions as i32,
                version: m.version.clone(),
                is_local: !m.path.is_empty(),
                is_default: m.is_default,
                metadata: "{}".to_string(),
            })
            .collect();

        Ok(Response::new(ListModelsResponse {
            models,
            error: String::new(),
        }))
    }
}

impl LlmSvcImpl {
    /// Simple rule-based intent detection (fallback when local models not available)
    fn simple_intent_detection(&self, query: &str) -> String {
        let q = query.to_lowercase();
        if q.contains("who") || q.contains("expert") {
            "find_expert".to_string()
        } else if q.contains("document") || q.contains("file") {
            "find_document".to_string()
        } else if q.contains("project") {
            "find_project_info".to_string()
        } else if q.contains("technology") || q.contains("tech") {
            "find_technology_usage".to_string()
        } else {
            "general_question".to_string()
        }
    }
}
