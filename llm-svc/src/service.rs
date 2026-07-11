// service.rs: LlmSvc trait implementation for all RPCs

use crate::cloud_proxy::CloudProxyClient;
use crate::config::Config;
use crate::llmsvc::{
    llm_svc_server::LlmSvc, CompressRequest, CompressResponse, Entity,
    EmbedRequest, EmbedResponse, ExtractRequest, ExtractResponse, GenerateRequest,
    GenerateResponse, HealthRequest, HealthResponse, IntentRequest, IntentResponse,
    ListModelsRequest, ListModelsResponse, ModelInfo, Relationship, RerankRequest,
    RerankResponse,
};
use crate::routing::{Router, RouteDecision};
use std::collections::HashMap;
use tonic::{Request, Response, Status};
use tracing::{debug, info, warn};

/// LlmSvcImpl is the gRPC service implementation for all LLM-shaped operations.
#[derive(Clone)]
pub struct LlmSvcImpl {
    config: Config,
    router: Router,
    cloud_proxy: Option<CloudProxyClient>,
}

impl LlmSvcImpl {
    /// Create a new LlmSvc instance with the given configuration.
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let has_local_models = true; // TODO: Check if local models are actually available
        let cloud_proxy = CloudProxyClient::from_env().ok().flatten();
        let has_cloud_config = cloud_proxy.is_some();

        let router = Router::new(config.nlp_mode, has_local_models, has_cloud_config);

        info!(
            "LlmSvcImpl initialized: mode={:?}, has_local={}, has_cloud={}",
            config.nlp_mode, has_local_models, has_cloud_config
        );

        Ok(LlmSvcImpl {
            config,
            router,
            cloud_proxy,
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

        // Route decision: embed should prefer local ONNX, fallback to cloud
        match self.router.route("embed") {
            RouteDecision::Cloud => {
                if let Some(_proxy) = &self.cloud_proxy {
                    // Phase 2: Implement cloud embedding call
                    warn!("Cloud embedding not implemented in Phase 1");
                    return Err(Status::unimplemented(
                        "Cloud embedding not yet implemented",
                    ));
                }
                Err(Status::unavailable("No cloud proxy configured"))
            }
            RouteDecision::Local => {
                // Phase 2: Implement local ONNX embedding
                warn!("Local ONNX embedding not implemented in Phase 1 (stub)");
                Err(Status::unimplemented(
                    "Local ONNX embedding not yet implemented",
                ))
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

        // Route decision: rerank should prefer local ONNX, fallback to cloud
        match self.router.route("rerank") {
            RouteDecision::Cloud => {
                if let Some(_proxy) = &self.cloud_proxy {
                    // Phase 2: Implement cloud reranking call
                    warn!("Cloud reranking not implemented in Phase 1");
                    return Err(Status::unimplemented(
                        "Cloud reranking not yet implemented",
                    ));
                }
                Err(Status::unavailable("No cloud proxy configured"))
            }
            RouteDecision::Local => {
                // Phase 2: Implement local BGE reranker via ONNX
                warn!("Local ONNX reranking not implemented in Phase 1 (stub)");
                Err(Status::unimplemented(
                    "Local ONNX reranking not yet implemented",
                ))
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
                if let Some(_proxy) = &self.cloud_proxy {
                    // Phase 2: Implement cloud compression
                    warn!("Cloud compression not implemented in Phase 1");
                    return Err(Status::unimplemented(
                        "Cloud compression not yet implemented",
                    ));
                }
                Err(Status::unavailable("No cloud proxy configured"))
            }
            RouteDecision::Local => {
                // Phase 2: Implement local compression via GGUF
                warn!("Local GGUF compression not implemented in Phase 1 (stub)");
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

        let models: Vec<ModelInfo> = self
            .config
            .models
            .iter()
            .filter(|m| req.model_kind.is_empty() || m.kind == req.model_kind)
            .map(|m| ModelInfo {
                name: m.name.clone(),
                kind: m.kind.clone(),
                format: m.format.clone(),
                dimensions: m.dims as i32,
                version: m.version.clone(),
                is_local: m.path.is_some(),
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
