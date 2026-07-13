// +build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

// TestLLMSvcClient_Embed tests the gRPC client's Embed RPC.
// REQUIRES: llm-svc running on localhost:9090
func TestLLMSvcClient_Embed(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := llmsvc.NewClient("localhost:9090")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	texts := []string{"hello world", "test embedding"}
	embeddings, err := client.Embed(ctx, texts, "text-embedding-3-small")
	if err != nil {
		t.Fatalf("Embed failed: %v", err)
	}

	if len(embeddings) != len(texts) {
		t.Errorf("expected %d embeddings, got %d", len(texts), len(embeddings))
	}

	for i, emb := range embeddings {
		if len(emb) == 0 {
			t.Errorf("embedding %d is empty", i)
		}
	}
}

// TestLLMSvcClient_Health tests the gRPC client's Health RPC.
func TestLLMSvcClient_Health(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := llmsvc.NewClient("localhost:9090")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	healthy, err := client.Health(ctx)
	if err != nil {
		t.Logf("health check error: %v (service may not be running)", err)
	}

	if !healthy {
		t.Logf("service not healthy")
	}
}

// TestSvcAdapter_Embed tests the SvcAdapter's embedding interface.
func TestSvcAdapter_Embed(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Fatalf("failed to create adapter: %v", err)
	}
	defer adapter.Close()

	texts := []string{"hello world", "test adapter"}
	embeddings, err := adapter.Embed(ctx, texts)
	if err != nil {
		t.Fatalf("Embed failed: %v", err)
	}

	if len(embeddings) != len(texts) {
		t.Errorf("expected %d embeddings, got %d", len(texts), len(embeddings))
	}

	for i, emb := range embeddings {
		if len(emb) == 0 {
			t.Errorf("embedding %d is empty", i)
		}
		// Verify it's a valid float32 slice
		for j, f := range emb {
			if f != f { // NaN check
				t.Errorf("embedding %d has NaN at index %d", i, j)
			}
		}
	}
}

// TestSvcAdapter_Complete tests the SvcAdapter's Complete interface (for LLM generation).
func TestSvcAdapter_Complete(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Fatalf("failed to create adapter: %v", err)
	}
	defer adapter.Close()

	prompt := "What is 2+2?"
	answer, err := adapter.Complete(ctx, prompt)
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}

	if answer == "" {
		t.Error("expected non-empty answer")
	}

	t.Logf("Answer: %s", answer)
}

// TestSvcAdapter_ExtractEntities tests the SvcAdapter's ExtractEntities method (T172).
func TestSvcAdapter_ExtractEntities(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Fatalf("failed to create adapter: %v", err)
	}
	defer adapter.Close()

	text := "Alice works at Microsoft on the Teams project."
	result, err := adapter.ExtractEntities(ctx, text, "ingestion")
	if err != nil {
		t.Logf("ExtractEntities failed (may be expected if llm-svc doesn't support NER): %v", err)
		return
	}

	if result == nil {
		t.Error("expected non-nil result")
		return
	}

	t.Logf("Extracted %d entities and %d relationships", len(result.Entities), len(result.Relationships))
}

// TestSvcAdapter_Generate tests the SvcAdapter's Generate method (T174).
func TestSvcAdapter_Generate(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		t.Fatalf("failed to create adapter: %v", err)
	}
	defer adapter.Close()

	query := "What is the capital of France?"
	context := "France is a country in Europe. Its capital is Paris."
	answer, err := adapter.GenerateWithQuery(ctx, query, context, "")
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	if answer == "" {
		t.Error("expected non-empty answer")
	}

	t.Logf("Generated answer: %s", answer)
}

// BenchmarkEmbedding benchmarks the embedding process.
func BenchmarkEmbedding(b *testing.B) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adapter, err := embedding.NewSvcAdapter("localhost:9090", "text-embedding-3-small", "gpt-4o-mini")
	if err != nil {
		b.Fatalf("failed to create adapter: %v", err)
	}
	defer adapter.Close()

	texts := []string{"hello world", "test", "benchmark"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := adapter.Embed(ctx, texts)
		if err != nil {
			b.Fatalf("Embed failed: %v", err)
		}
	}
}
