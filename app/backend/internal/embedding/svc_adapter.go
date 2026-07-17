package embedding

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

// SvcAdapter wraps llmsvc.Client and provides both EmbeddingRuntime
// and LLMClient interfaces for seamless integration with existing code.
// This allows embedding and generation workflows to use llm-svc without
// changing the interfaces that stages.go and nlp.Extractor expect.
type SvcAdapter struct {
	client    *llmsvc.Client
	modelName string
	genModel  string
}

// NewSvcAdapter creates a new adapter wrapping an llmsvc.Client.
// addr should be in the format "host:port" (e.g., "llm-svc:9090").
// modelName is the embedding model identifier.
// genModel is the generative model identifier (for Complete/LLM calls).
func NewSvcAdapter(addr string, modelName string, genModel string) (*SvcAdapter, error) {
	client, err := llmsvc.NewClient(addr)
	if err != nil {
		return nil, fmt.Errorf("embedding.NewSvcAdapter: %w", err)
	}

	if modelName == "" {
		modelName = "text-embedding-3-small"
	}
	if genModel == "" {
		genModel = "gpt-3.5-turbo" // Default generative model
	}

	return &SvcAdapter{
		client:    client,
		modelName: modelName,
		genModel:  genModel,
	}, nil
}

// NewSvcAdapterWithTLS creates a new adapter with TLS support.
func NewSvcAdapterWithTLS(addr string, modelName string, genModel string, tlsCertFile string) (*SvcAdapter, error) {
	client, err := llmsvc.NewClientWithTLS(addr, tlsCertFile)
	if err != nil {
		return nil, fmt.Errorf("embedding.NewSvcAdapterWithTLS: %w", err)
	}

	if modelName == "" {
		modelName = "text-embedding-3-small"
	}
	if genModel == "" {
		genModel = "gpt-3.5-turbo"
	}

	return &SvcAdapter{
		client:    client,
		modelName: modelName,
		genModel:  genModel,
	}, nil
}

// Close closes the underlying gRPC connection.
func (sa *SvcAdapter) Close() error {
	return sa.client.Close()
}

// ============================================================================
// EmbeddingRuntime interface implementation (for semantic search)
// ============================================================================

// Embed implements EmbeddingRuntime by calling llm-svc.
// It converts the byte-serialized embeddings from llm-svc to [][]float32.
func (sa *SvcAdapter) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	// Call llm-svc Embed RPC
	embeddingBytes, err := sa.client.Embed(ctx, texts, sa.modelName)
	if err != nil {
		return nil, fmt.Errorf("embedding.SvcAdapter.Embed: %w", err)
	}

	// Convert byte-serialized embeddings to [][]float32
	embeddings := make([][]float32, len(embeddingBytes))
	for i, embBytes := range embeddingBytes {
		embedding, err := bytesToFloat32Slice(embBytes)
		if err != nil {
			slog.WarnContext(ctx, "failed to decode embedding", "index", i, "err", err)
			return nil, fmt.Errorf("embedding.SvcAdapter.Embed: decode embedding %d: %w", i, err)
		}
		embeddings[i] = embedding
	}

	return embeddings, nil
}

// ============================================================================
// LLMClient interface implementation (for generation/completion)
// ============================================================================

// Complete implements the LLMClient interface used by answer generation.
// It calls llm-svc.Generate to produce answers.
func (sa *SvcAdapter) Complete(ctx context.Context, prompt string) (string, error) {
	if prompt == "" {
		return "", fmt.Errorf("complete: prompt is empty")
	}

	// Parse the prompt as context (for now, treat it as context)
	// In a more sophisticated design, we'd parse out query, context, etc.
	resp, err := sa.client.Generate(ctx, "", prompt, "", 0.7, 2048)
	if err != nil {
		return "", fmt.Errorf("embedding.SvcAdapter.Complete: %w", err)
	}

	return resp.Answer, nil
}

// GenerateWithQuery calls llm-svc.Generate with explicit query and context.
// This is a convenience method for direct access to the Generate RPC.
func (sa *SvcAdapter) GenerateWithQuery(ctx context.Context, query string, context string, instructions string) (string, error) {
	resp, err := sa.client.Generate(ctx, query, context, instructions, 0.7, 2048)
	if err != nil {
		return "", fmt.Errorf("embedding.SvcAdapter.GenerateWithQuery: %w", err)
	}
	return resp.Answer, nil
}

// ============================================================================
// NLP Extractor support (for entity/relationship extraction)
// ============================================================================

// ExtractEntities calls llm-svc.ExtractEntities for NER.
// Returns results compatible with nlp.Extractor's extraction model.
func (sa *SvcAdapter) ExtractEntities(ctx context.Context, text string, taskMode string) (*llmsvc.NERResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract_entities: text is empty")
	}

	return sa.client.ExtractEntities(ctx, text, taskMode, "")
}

// ============================================================================
// Reranking support (for Stage 5 of retrieval)
// ============================================================================

// Rerank calls llm-svc.Rerank to score documents against a query.
func (sa *SvcAdapter) Rerank(ctx context.Context, query string, documents []llmsvc.DocumentForReranking) ([]llmsvc.ScoredDocument, error) {
	return sa.client.Rerank(ctx, query, documents, "")
}

// ============================================================================
// Compression support (for Stage 6 of retrieval)
// ============================================================================

// Compress calls llm-svc.Compress to reduce context size.
func (sa *SvcAdapter) Compress(ctx context.Context, context string, targetTokens int, method string) (*llmsvc.CompressionResult, error) {
	return sa.client.Compress(ctx, context, targetTokens, method)
}

// GetLLMSvcClient returns the underlying llmsvc.Client for direct RPC calls.
// This is used by components that need specialized methods (T172-T176).
func (sa *SvcAdapter) GetLLMSvcClient() *llmsvc.Client {
	return sa.client
}
