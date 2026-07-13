package embedding

import (
	"context"
	"encoding/binary"
	"fmt"
	"log/slog"
	"math"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

// SvcClient wraps llmsvc.Client and implements EmbeddingRuntime.
// This is the production implementation that delegates all embeddings
// to the llm-svc microservice (T170).
type SvcClient struct {
	client    *llmsvc.Client
	modelName string
	taskType  string
}

// NewSvcClient creates a new embedding client backed by llm-svc.
// addr should be in the format "host:port" (e.g., "localhost:9090").
// modelName is the embedding model identifier (e.g., "text-embedding-3-small").
func NewSvcClient(addr string, modelName string) (*SvcClient, error) {
	client, err := llmsvc.NewClient(addr)
	if err != nil {
		return nil, fmt.Errorf("embedding.NewSvcClient: %w", err)
	}

	if modelName == "" {
		modelName = "text-embedding-3-small" // Default model
	}

	return &SvcClient{
		client:    client,
		modelName: modelName,
		taskType:  "search_document",
	}, nil
}

// NewSvcClientWithTLS creates a new embedding client with TLS support.
func NewSvcClientWithTLS(addr string, modelName string, tlsCertFile string) (*SvcClient, error) {
	client, err := llmsvc.NewClientWithTLS(addr, tlsCertFile)
	if err != nil {
		return nil, fmt.Errorf("embedding.NewSvcClientWithTLS: %w", err)
	}

	if modelName == "" {
		modelName = "text-embedding-3-small"
	}

	return &SvcClient{
		client:    client,
		modelName: modelName,
		taskType:  "search_document",
	}, nil
}

// Close closes the underlying gRPC connection.
func (sc *SvcClient) Close() error {
	return sc.client.Close()
}

// SetTaskType sets the task type hint for the embedding model.
// Valid values: "search_document", "search_query", "classify", "clustering"
func (sc *SvcClient) SetTaskType(taskType string) {
	if taskType != "" {
		sc.taskType = taskType
	}
}

// Embed implements EmbeddingRuntime by calling llm-svc.
// It converts the byte-serialized embeddings from llm-svc to [][]float32.
func (sc *SvcClient) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	// Call llm-svc Embed RPC
	embeddingBytes, err := sc.client.Embed(ctx, texts, sc.modelName)
	if err != nil {
		return nil, fmt.Errorf("embedding.SvcClient.Embed: %w", err)
	}

	// Convert byte-serialized embeddings to [][]float32
	embeddings := make([][]float32, len(embeddingBytes))
	for i, embBytes := range embeddingBytes {
		embedding, err := bytesToFloat32Slice(embBytes)
		if err != nil {
			slog.WarnContext(ctx, "failed to decode embedding", "index", i, "err", err)
			// Return error or continue with empty embedding
			return nil, fmt.Errorf("embedding.SvcClient.Embed: decode embedding %d: %w", i, err)
		}
		embeddings[i] = embedding
	}

	return embeddings, nil
}

// bytesToFloat32Slice converts a byte slice to a []float32.
// Assumes little-endian float32 encoding (standard for gRPC protobuf).
func bytesToFloat32Slice(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid embedding size: expected multiple of 4, got %d", len(data))
	}

	count := len(data) / 4
	result := make([]float32, count)
	for i := 0; i < count; i++ {
		bits := binary.LittleEndian.Uint32(data[i*4 : (i+1)*4])
		result[i] = math.Float32frombits(bits)
	}

	return result, nil
}

// Float32ToBytes converts a []float32 to a byte slice (for testing/serialization).
func Float32ToBytes(embedding []float32) []byte {
	data := make([]byte, len(embedding)*4)
	for i, f := range embedding {
		bits := math.Float32bits(f)
		binary.LittleEndian.PutUint32(data[i*4:(i+1)*4], bits)
	}
	return data
}
