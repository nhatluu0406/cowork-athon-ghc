// Package llmsvc provides a gRPC client wrapper for the llm-svc service.
// This is the ONLY LLM-provider touchpoint in the Go backend (m365-knowledge-graph).
// All LLM-related operations (embedding, reranking, NER, compression, intent detection, generation)
// route through this client to llm-svc, which decides local vs. cloud per NLP_MODE.
//
// Task T046: gRPC client for llm-svc
// Implements methods: Embed, ExtractEntities, Rerank, DetectIntent, Compress, Generate
package llmsvc

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

// Client wraps the generated gRPC client for easier use.
// It provides high-level methods for all llm-svc operations while handling
// error conversion and response validation.
type Client struct {
	GrpcClient LlmSvcClient
	conn       *grpc.ClientConn
	addr       string
	logger     *slog.Logger
}

// ClientConfig holds configuration for gRPC client connection
type ClientConfig struct {
	Address         string        // "host:port" format
	Timeout         time.Duration // context timeout for each RPC
	MaxRetries      int           // max retries on transient errors
	KeepAliveTime   time.Duration // keepalive interval
	KeepAliveTimeout time.Duration // keepalive timeout
}

// DefaultClientConfig returns sensible defaults for Client configuration
func DefaultClientConfig() ClientConfig {
	return ClientConfig{
		Address:          "localhost:9090",
		Timeout:          30 * time.Second,
		MaxRetries:       3,
		KeepAliveTime:    30 * time.Second,
		KeepAliveTimeout: 10 * time.Second,
	}
}

// NewClient creates a new gRPC client connected to llm-svc.
// addr should be in the format "host:port" (e.g., "localhost:9090" or "llm-svc:9090").
func NewClient(addr string) (*Client, error) {
	cfg := DefaultClientConfig()
	cfg.Address = addr
	return NewClientWithConfig(cfg)
}

// NewClientWithConfig creates a new gRPC client with explicit configuration.
func NewClientWithConfig(cfg ClientConfig) (*Client, error) {
	if cfg.Address == "" {
		cfg.Address = "localhost:9090"
	}

	logger := slog.Default().With("component", "llmsvc.Client")

	// Configure keepalive parameters for connection health
	kacp := keepalive.ClientParameters{
		Time:                cfg.KeepAliveTime,
		Timeout:             cfg.KeepAliveTimeout,
		PermitWithoutStream: true,
	}

	// Dial the gRPC service at addr
	// Using insecure credentials for now; in production, use TLS from config
	conn, err := grpc.Dial(
		cfg.Address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(kacp),
	)
	if err != nil {
		logger.Error("failed to dial llm-svc", "address", cfg.Address, "err", err)
		return nil, fmt.Errorf("llmsvc.NewClientWithConfig: failed to dial %s: %w", cfg.Address, err)
	}

	grpcClient := NewLlmSvcClient(conn)
	logger.Info("llmsvc client created", "address", cfg.Address)

	return &Client{
		GrpcClient: grpcClient,
		conn:       conn,
		addr:       cfg.Address,
		logger:     logger,
	}, nil
}

// NewClientWithTLS creates a new gRPC client with TLS credentials.
// tlsCertFile should contain the path to the TLS certificate.
func NewClientWithTLS(addr string, tlsCertFile string) (*Client, error) {
	if addr == "" {
		addr = "localhost:9090"
	}

	// TODO: Load TLS credentials from tlsCertFile
	// For now, use insecure credentials as fallback
	slog.Warn("TLS not yet implemented for llmsvc client, using insecure connection", "address", addr)

	cfg := DefaultClientConfig()
	cfg.Address = addr
	return NewClientWithConfig(cfg)
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		c.logger.Debug("closing llmsvc client connection")
		return c.conn.Close()
	}
	return nil
}

// Embed calls the llm-svc Embed RPC to generate embeddings for texts.
// Task T046: Generate embeddings for a batch of texts
// Each text receives one embedding vector (as bytes, typically float32 array).
// If modelName is empty, llm-svc uses its configured default embedding model.
func (c *Client) Embed(ctx context.Context, texts []string, modelName string) ([][]byte, error) {
	if len(texts) == 0 {
		return nil, fmt.Errorf("embed: no texts provided")
	}

	c.logger.Debug("embedding texts", "text_count", len(texts), "model", modelName)

	req := &EmbedRequest{
		Texts:     texts,
		ModelName: modelName,
		TaskType:  "search_document", // hint for llm-svc routing
	}

	// Use context timeout if available
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.Embed(ctx, req)
	if err != nil {
		c.logger.Error("embed RPC failed", "err", err, "text_count", len(texts))
		return nil, fmt.Errorf("llmsvc.Embed: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("embed service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.Embed: service error: %s", resp.Error)
	}

	if len(resp.Embeddings) != len(texts) {
		c.logger.Warn("embedding count mismatch", "expected", len(texts), "got", len(resp.Embeddings))
	}

	c.logger.Debug("embedding succeeded", "count", len(resp.Embeddings), "dimensions", resp.Dimensions, "model", resp.ModelName)
	return resp.Embeddings, nil
}

// Rerank calls the llm-svc Rerank RPC to score documents against a query.
// Task T046: Score documents for relevance ranking (retrieval Stage 5)
// Returns documents sorted by relevance score (highest first).
func (c *Client) Rerank(ctx context.Context, query string, documents []DocumentForReranking, modelName string) ([]ScoredDocument, error) {
	if query == "" {
		return nil, fmt.Errorf("rerank: query is empty")
	}
	if len(documents) == 0 {
		return nil, fmt.Errorf("rerank: no documents provided")
	}

	c.logger.Debug("reranking documents", "query_len", len(query), "doc_count", len(documents), "model", modelName)

	// Convert DocumentForReranking to RerankDocument (proto type)
	protoDocuments := make([]*RerankDocument, len(documents))
	for i, doc := range documents {
		protoDocuments[i] = &RerankDocument{
			DocId:    doc.DocID,
			Text:     doc.Text,
			Metadata: doc.Metadata,
		}
	}

	req := &RerankRequest{
		Query:     query,
		Documents: protoDocuments,
		ModelName: modelName,
		TopK:      0, // 0 = return all
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.Rerank(ctx, req)
	if err != nil {
		c.logger.Error("rerank RPC failed", "err", err, "doc_count", len(documents))
		return nil, fmt.Errorf("llmsvc.Rerank: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("rerank service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.Rerank: service error: %s", resp.Error)
	}

	// Convert RerankResult (proto) to ScoredDocument
	results := make([]ScoredDocument, len(resp.Results))
	for i, r := range resp.Results {
		results[i] = ScoredDocument{
			DocID: r.DocId,
			Score: r.Score,
			Rank:  r.Rank,
		}
	}

	c.logger.Debug("rerank succeeded", "result_count", len(results), "model", resp.ModelName)
	return results, nil
}

// ExtractEntities calls the llm-svc ExtractEntities RPC for NER (Named Entity Recognition).
// Task T046: Extract entities and relationships from text
// taskMode: "ingestion" (from document chunks) or "query" (from user questions)
// Returns entities with confidence scores (0.0-1.0) and their relationships.
func (c *Client) ExtractEntities(ctx context.Context, text string, taskMode string, schema string) (*NERResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract_entities: text is empty")
	}

	if taskMode == "" {
		taskMode = "ingestion"
	}

	c.logger.Debug("extracting entities", "text_len", len(text), "task_mode", taskMode)

	req := &ExtractRequest{
		Text:                 text,
		TaskMode:             taskMode,
		Schema:               schema,
		IncludeRelationships: true,
		TaskType:             "nlp_extraction",
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.ExtractEntities(ctx, req)
	if err != nil {
		c.logger.Error("extract entities RPC failed", "err", err, "text_len", len(text))
		return nil, fmt.Errorf("llmsvc.ExtractEntities: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("extract entities service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.ExtractEntities: service error: %s", resp.Error)
	}

	// Convert proto types to our types
	entities := make([]*NEREntity, len(resp.Entities))
	for i, e := range resp.Entities {
		entities[i] = &NEREntity{
			Name:       e.Name,
			Type:       e.Type,
			Confidence: e.Confidence,
			Metadata:   e.Metadata,
		}
	}

	relationships := make([]*NERRelationship, len(resp.Relationships))
	for i, r := range resp.Relationships {
		relationships[i] = &NERRelationship{
			FromEntity:       r.FromEntity,
			RelationshipType: r.RelationshipType,
			ToEntity:         r.ToEntity,
			Confidence:       r.Confidence,
			Metadata:         r.Metadata,
		}
	}

	c.logger.Debug("extraction succeeded", "entities", len(entities), "relationships", len(relationships), "model", resp.ModelName)
	return &NERResult{
		Entities:      entities,
		Relationships: relationships,
		ModelName:     resp.ModelName,
	}, nil
}

// Compress calls the llm-svc Compress RPC to reduce context size.
// Task T046: Compress context for token budget (retrieval Stage 6)
// method: "map_reduce", "abstractive", or "extract"
func (c *Client) Compress(ctx context.Context, contextStr string, targetTokens int, method string) (*CompressionResult, error) {
	if contextStr == "" {
		return nil, fmt.Errorf("compress: context is empty")
	}

	if method == "" {
		method = "map_reduce"
	}

	c.logger.Debug("compressing context", "context_len", len(contextStr), "target_tokens", targetTokens, "method", method)

	req := &CompressRequest{
		Context:      contextStr,
		TargetTokens: int32(targetTokens),
		Method:       method,
		TaskType:     "context_compression",
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.Compress(ctx, req)
	if err != nil {
		c.logger.Error("compress RPC failed", "err", err, "context_len", len(contextStr))
		return nil, fmt.Errorf("llmsvc.Compress: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("compress service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.Compress: service error: %s", resp.Error)
	}

	c.logger.Debug("compression succeeded",
		"original_tokens", resp.OriginalTokens,
		"compressed_tokens", resp.CompressedTokens,
		"ratio", resp.CompressionRatio)

	return &CompressionResult{
		CompressedContext: resp.CompressedContext,
		OriginalTokens:    resp.OriginalTokens,
		CompressedTokens:  resp.CompressedTokens,
		CompressionRatio:  resp.CompressionRatio,
	}, nil
}

// DetectIntent calls the llm-svc DetectIntent RPC for Stage 1 of retrieval.
// Task T046: Classify user intent (find_expert, find_document, etc.)
// Returns intent type with confidence score and extracted attributes.
func (c *Client) DetectIntent(ctx context.Context, query string, contextStr string) (*IntentDetectionResult, error) {
	if query == "" {
		return nil, fmt.Errorf("detect_intent: query is empty")
	}

	c.logger.Debug("detecting intent", "query_len", len(query))

	req := &IntentRequest{
		Query:    query,
		Context:  contextStr,
		TaskType: "intent_detection",
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.DetectIntent(ctx, req)
	if err != nil {
		c.logger.Error("detect intent RPC failed", "err", err, "query_len", len(query))
		return nil, fmt.Errorf("llmsvc.DetectIntent: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("detect intent service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.DetectIntent: service error: %s", resp.Error)
	}

	c.logger.Debug("intent detection succeeded", "intent", resp.Intent, "confidence", resp.Confidence)
	return &IntentDetectionResult{
		Intent:     resp.Intent,
		Confidence: resp.Confidence,
		Attributes: resp.Attributes,
	}, nil
}

// Generate calls the llm-svc Generate RPC for Stage 7 answer generation.
// Task T046: Generate answer with citations
// Produces a final answer from context with optional source citations.
func (c *Client) Generate(ctx context.Context, query string, contextStr string, instructions string, temperature float32, maxTokens int) (*GeneratedAnswer, error) {
	if query == "" {
		return nil, fmt.Errorf("generate: query is empty")
	}

	if temperature < 0 || temperature > 2 {
		temperature = 0.7 // default
	}

	if maxTokens <= 0 {
		maxTokens = 2048 // default
	}

	c.logger.Debug("generating answer", "query_len", len(query), "context_len", len(contextStr), "max_tokens", maxTokens)

	req := &GenerateRequest{
		Query:            query,
		Context:          contextStr,
		Instructions:     instructions,
		Temperature:      temperature,
		MaxTokens:        int32(maxTokens),
		IncludeCitations: true,
		TaskType:         "answer_generation",
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.Generate(ctx, req)
	if err != nil {
		c.logger.Error("generate RPC failed", "err", err, "query_len", len(query))
		return nil, fmt.Errorf("llmsvc.Generate: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("generate service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.Generate: service error: %s", resp.Error)
	}

	c.logger.Debug("generation succeeded", "answer_len", len(resp.Answer), "citations", len(resp.Citations), "tokens_used", resp.TokensUsed)
	return &GeneratedAnswer{
		Answer:     resp.Answer,
		Citations:  resp.Citations,
		ModelName:  resp.ModelName,
		TokensUsed: resp.TokensUsed,
		LatencyMs:  resp.LatencyMs,
	}, nil
}

// Health checks the service's liveness.
func (c *Client) Health(ctx context.Context) (bool, error) {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.Health(ctx, &HealthRequest{})
	if err != nil {
		c.logger.Warn("health check failed", "err", err)
		return false, nil
	}

	healthy := resp.Status == "SERVING"
	if !healthy {
		c.logger.Warn("health check not serving", "status", resp.Status, "message", resp.Message)
	}
	return healthy, nil
}

// ListModels returns available models from llm-svc.
func (c *Client) ListModels(ctx context.Context, modelKind string) ([]ModelMetadata, error) {
	c.logger.Debug("listing models", "kind", modelKind)

	req := &ListModelsRequest{
		ModelKind: modelKind,
	}

	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
	}

	resp, err := c.GrpcClient.ListModels(ctx, req)
	if err != nil {
		c.logger.Error("list models RPC failed", "err", err, "kind", modelKind)
		return nil, fmt.Errorf("llmsvc.ListModels: %w", err)
	}

	if resp.Error != "" {
		c.logger.Error("list models service error", "service_error", resp.Error)
		return nil, fmt.Errorf("llmsvc.ListModels: service error: %s", resp.Error)
	}

	// Convert ProtoModelInfo to ModelMetadata
	models := make([]ModelMetadata, len(resp.Models))
	for i, m := range resp.Models {
		models[i] = ModelMetadata{
			Name:       m.Name,
			Kind:       m.Kind,
			Format:     m.Format,
			Dimensions: m.Dimensions,
			Version:    m.Version,
			IsLocal:    m.IsLocal,
			IsDefault:  m.IsDefault,
			Metadata:   m.Metadata,
		}
	}

	c.logger.Debug("list models succeeded", "count", len(models))
	return models, nil
}

