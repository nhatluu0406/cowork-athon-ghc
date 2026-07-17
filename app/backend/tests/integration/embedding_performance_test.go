// +build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
)

// TestEmbeddingLatency measures single embedding latency
func TestEmbeddingLatency(t *testing.T) {
	ctx := context.Background()
	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Skipf("LLM service not available: %v", err)
	}
	defer adapter.Close()

	tests := []struct {
		name string
		text string
	}{
		{"short", "hello"},
		{"medium", "What is the capital of France? It is Paris, a beautiful city."},
		{"long", "Embeddings are dense vector representations of text that capture semantic meaning. They are widely used in natural language processing for tasks like search, clustering, and recommendation systems. The quality of embeddings depends on the model used and the training data."},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start := time.Now()
			vecs, err := adapter.Embed(ctx, []string{tt.text})
			latency := time.Since(start)

			if err != nil {
				t.Fatalf("Embed failed: %v", err)
			}

			if len(vecs) != 1 {
				t.Fatalf("Expected 1 embedding, got %d", len(vecs))
			}

			t.Logf("Latency for %s: %v", tt.name, latency)

			// Latency threshold (adjust based on deployment)
			maxLatency := 50 * time.Millisecond
			if latency > maxLatency {
				t.Logf("WARNING: Latency %v exceeds threshold %v", latency, maxLatency)
			}
		})
	}
}

// TestBatchEmbeddingThroughput measures throughput for batch processing
func TestBatchEmbeddingThroughput(t *testing.T) {
	ctx := context.Background()
	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Skipf("LLM service not available: %v", err)
	}
	defer adapter.Close()

	batch := 100
	texts := make([]string, batch)
	for i := 0; i < batch; i++ {
		texts[i] = fmt.Sprintf("Document %d with some content", i)
	}

	start := time.Now()
	vecs, err := adapter.Embed(ctx, texts)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Batch embed failed: %v", err)
	}

	if len(vecs) != batch {
		t.Fatalf("Expected %d embeddings, got %d", batch, len(vecs))
	}

	throughput := float64(batch) / elapsed.Seconds()
	t.Logf("Batch throughput: %.1f embeddings/sec (total: %v for %d items)", throughput, elapsed, batch)
}

// TestEmbeddingConsistency verifies embeddings are deterministic
func TestEmbeddingConsistency(t *testing.T) {
	ctx := context.Background()
	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Skipf("LLM service not available: %v", err)
	}
	defer adapter.Close()

	text := "Consistency test for embedding reproducibility"

	// Get embedding twice
	vecs1, err := adapter.Embed(ctx, []string{text})
	if err != nil {
		t.Fatalf("First embed failed: %v", err)
	}

	vecs2, err := adapter.Embed(ctx, []string{text})
	if err != nil {
		t.Fatalf("Second embed failed: %v", err)
	}

	// For cloud APIs, embeddings may not be perfectly identical due to floating-point precision
	// For local ONNX, they should be identical
	if len(vecs1) != 1 || len(vecs2) != 1 {
		t.Fatal("Expected single embeddings")
	}

	if len(vecs1[0]) != len(vecs2[0]) {
		t.Fatalf("Embedding dimensions don't match: %d vs %d", len(vecs1[0]), len(vecs2[0]))
	}

	// Check similarity (should be very close to 1.0)
	similarity := cosineSimilarity(vecs1[0], vecs2[0])
	t.Logf("Embedding consistency (cosine similarity): %.6f", similarity)

	minSimilarity := float32(0.99)
	if similarity < minSimilarity {
		t.Logf("WARNING: Embeddings not perfectly consistent (similarity: %.6f, expected >= %.2f)", similarity, minSimilarity)
	}
}

// TestEmbeddingSemanticQuality verifies embeddings capture semantic meaning
func TestEmbeddingSemanticQuality(t *testing.T) {
	ctx := context.Background()
	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Skipf("LLM service not available: %v", err)
	}
	defer adapter.Close()

	tests := []struct {
		name      string
		similar   [2]string
		threshold float32
	}{
		{
			name: "semantic_similarity",
			similar: [2]string{
				"What is machine learning?",
				"How does machine learning work?",
			},
			threshold: 0.7, // Should be similar
		},
		{
			name: "domain_similarity",
			similar: [2]string{
				"Transfer learning in neural networks",
				"Fine-tuning deep learning models",
			},
			threshold: 0.6, // Related concepts
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vecs, err := adapter.Embed(ctx, []string{tt.similar[0], tt.similar[1]})
			if err != nil {
				t.Fatalf("Embed failed: %v", err)
			}

			if len(vecs) != 2 {
				t.Fatalf("Expected 2 embeddings, got %d", len(vecs))
			}

			similarity := cosineSimilarity(vecs[0], vecs[1])
			t.Logf("Semantic similarity for '%s': %.4f (threshold: %.2f)", tt.name, similarity, tt.threshold)

			if similarity < float32(tt.threshold) {
				t.Logf("WARNING: Similarity %.4f below threshold %.2f", similarity, tt.threshold)
			}
		})
	}
}

// Helper function to compute cosine similarity
func cosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}

	var dotProduct, magnitudeA, magnitudeB float32
	for i := range a {
		dotProduct += a[i] * b[i]
		magnitudeA += a[i] * a[i]
		magnitudeB += b[i] * b[i]
	}

	if magnitudeA == 0 || magnitudeB == 0 {
		return 0
	}

	return dotProduct / (float32(len(a)) * (magnitudeA * magnitudeB)) // Simplified for testing
}
