// Package llmsvc provides a gRPC client wrapper for the llm-svc service.
// This is the ONLY LLM-provider touchpoint in the Go backend (m365-knowledge-graph).
// All LLM-related operations (embedding, reranking, NER, compression, intent detection, generation)
// route through this client to llm-svc, which decides local vs. cloud per NLP_MODE.
package llmsvc

import (
	"context"
	"fmt"
	"log/slog"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Client wraps the generated gRPC client for easier use.
type Client struct {
	GrpcClient LlmSvcClient
	conn       *grpc.ClientConn
}

// NewClient creates a new gRPC client connected to llm-svc.
// addr should be in the format "host:port" (e.g., "localhost:9090" or "llm-svc:9090").
func NewClient(addr string) (*Client, error) {
	if addr == "" {
		addr = "localhost:9090"
	}

	// Dial the gRPC service at addr
	// Using insecure credentials for now; in production, use TLS from config
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("llmsvc.NewClient: failed to dial %s: %w", addr, err)
	}

	grpcClient := NewLlmSvcClient(conn)

	return &Client{
		GrpcClient: grpcClient,
		conn:       conn,
	}, nil
}

// NewClientWithTLS creates a new gRPC client with TLS credentials.
func NewClientWithTLS(addr string, tlsCertFile string) (*Client, error) {
	if addr == "" {
		addr = "localhost:9090"
	}

	// TODO: Load TLS credentials from tlsCertFile
	// For now, use insecure credentials as fallback

	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("llmsvc.NewClientWithTLS: failed to dial %s: %w", addr, err)
	}

	grpcClient := NewLlmSvcClient(conn)

	return &Client{
		GrpcClient: grpcClient,
		conn:       conn,
	}, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// Embed calls the llm-svc Embed RPC to generate embeddings for texts.
func (c *Client) Embed(ctx context.Context, texts []string, modelName string) ([][]byte, error) {
	if len(texts) == 0 {
		return nil, fmt.Errorf("embed: no texts provided")
	}

	req := &EmbedRequest{
		Texts:     texts,
		ModelName: modelName,
	}

	resp, err := c.GrpcClient.Embed(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.Embed: %w", err)
	}

	if resp.Error != "" {
		return nil, fmt.Errorf("llmsvc.Embed: service error: %s", resp.Error)
	}

	return resp.Embeddings, nil
}

// Rerank calls the llm-svc Rerank RPC to score documents against a query.
func (c *Client) Rerank(ctx context.Context, query string, documents []DocumentForReranking, modelName string) ([]ScoredDocument, error) {
	if query == "" {
		return nil, fmt.Errorf("rerank: query is empty")
	}
	if len(documents) == 0 {
		return nil, fmt.Errorf("rerank: no documents provided")
	}

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
	}

	resp, err := c.GrpcClient.Rerank(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.Rerank: %w", err)
	}

	if resp.Error != "" {
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

	return results, nil
}

// ExtractEntities calls the llm-svc ExtractEntities RPC for NER.
func (c *Client) ExtractEntities(ctx context.Context, text string, taskMode string, schema string) (*NERResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract_entities: text is empty")
	}

	req := &ExtractRequest{
		Text:                 text,
		TaskMode:             taskMode,
		Schema:               schema,
		IncludeRelationships: true,
	}

	resp, err := c.GrpcClient.ExtractEntities(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.ExtractEntities: %w", err)
	}

	if resp.Error != "" {
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

	return &NERResult{
		Entities:      entities,
		Relationships: relationships,
		ModelName:     resp.ModelName,
	}, nil
}

// Compress calls the llm-svc Compress RPC to reduce context size.
func (c *Client) Compress(ctx context.Context, context string, targetTokens int, method string) (*CompressionResult, error) {
	if context == "" {
		return nil, fmt.Errorf("compress: context is empty")
	}

	req := &CompressRequest{
		Context:      context,
		TargetTokens: int32(targetTokens),
		Method:       method,
	}

	resp, err := c.GrpcClient.Compress(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.Compress: %w", err)
	}

	if resp.Error != "" {
		return nil, fmt.Errorf("llmsvc.Compress: service error: %s", resp.Error)
	}

	return &CompressionResult{
		CompressedContext: resp.CompressedContext,
		OriginalTokens:    resp.OriginalTokens,
		CompressedTokens:  resp.CompressedTokens,
		CompressionRatio:  resp.CompressionRatio,
	}, nil
}

// DetectIntent calls the llm-svc DetectIntent RPC for Stage 1 of retrieval.
func (c *Client) DetectIntent(ctx context.Context, query string, contextStr string) (*IntentDetectionResult, error) {
	if query == "" {
		return nil, fmt.Errorf("detect_intent: query is empty")
	}

	req := &IntentRequest{
		Query:   query,
		Context: contextStr,
	}

	resp, err := c.GrpcClient.DetectIntent(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.DetectIntent: %w", err)
	}

	if resp.Error != "" {
		return nil, fmt.Errorf("llmsvc.DetectIntent: service error: %s", resp.Error)
	}

	return &IntentDetectionResult{
		Intent:     resp.Intent,
		Confidence: resp.Confidence,
		Attributes: resp.Attributes,
	}, nil
}

// Generate calls the llm-svc Generate RPC for Stage 7 answer generation.
func (c *Client) Generate(ctx context.Context, query string, context string, instructions string, temperature float32, maxTokens int) (*GeneratedAnswer, error) {
	if query == "" {
		return nil, fmt.Errorf("generate: query is empty")
	}

	req := &GenerateRequest{
		Query:            query,
		Context:          context,
		Instructions:     instructions,
		Temperature:      temperature,
		MaxTokens:        int32(maxTokens),
		IncludeCitations: true,
	}

	resp, err := c.GrpcClient.Generate(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.Generate: %w", err)
	}

	if resp.Error != "" {
		return nil, fmt.Errorf("llmsvc.Generate: service error: %s", resp.Error)
	}

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
	resp, err := c.GrpcClient.Health(ctx, &HealthRequest{})
	if err != nil {
		slog.WarnContext(ctx, "health check failed", "err", err)
		return false, nil
	}

	return resp.Status == "SERVING", nil
}

// ListModels returns available models from llm-svc.
func (c *Client) ListModels(ctx context.Context, modelKind string) ([]ModelMetadata, error) {
	req := &ListModelsRequest{
		ModelKind: modelKind,
	}

	resp, err := c.GrpcClient.ListModels(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmsvc.ListModels: %w", err)
	}

	if resp.Error != "" {
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

	return models, nil
}

