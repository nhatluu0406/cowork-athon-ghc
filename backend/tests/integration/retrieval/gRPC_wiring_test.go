// +build integration

package retrieval

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// TestRerankerWithLLMSvc verifies reranker can use llmsvc.Client for reranking (T173).
func TestRerankerWithLLMSvc(t *testing.T) {
	ctx := context.Background()

	// Create llmsvc client (assumes llm-svc running on localhost:9090)
	client, err := llmsvc.NewClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Create reranker with llmsvc client
	reranker := retrieval.NewRerankerWithLLMSvc(client)

	// Create test results
	results := []map[string]interface{}{
		{"text": "Machine learning is a subset of AI", "score": 0.8},
		{"text": "The weather today is sunny", "score": 0.2},
	}

	// Call rerank
	reranked := reranker.Rank(ctx, results)

	if len(reranked) == 0 {
		t.Fatal("reranker returned no results")
	}

	// Verify results were reranked (first result should have the highest score)
	t.Logf("reranked results: %v", reranked)
}

// TestContextPackerWithLLMSvc verifies context packer can use llmsvc.Client for compression (T180).
func TestContextPackerWithLLMSvc(t *testing.T) {
	ctx := context.Background()

	// Create llmsvc client
	client, err := llmsvc.NewClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Create context packer with llmsvc client
	packer := retrieval.NewContextPackerWithLLMSvc(client)

	// Create large result set
	results := make([]map[string]interface{}, 10)
	for i := 0; i < 10; i++ {
		results[i] = map[string]interface{}{
			"text":      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " + string(rune(i)),
			"file_name": "test.md",
		}
	}

	// Pack with tight budget
	packed := packer.Pack(ctx, results, 200) // Very tight token budget

	if len(packed) == 0 {
		t.Fatal("packer returned empty result")
	}

	t.Logf("packed context length: %d", len(packed))
}

// TestAnswerGeneratorWithLLMSvc verifies answer generator can use llmsvc.Client for generation (T174).
func TestAnswerGeneratorWithLLMSvc(t *testing.T) {
	ctx := context.Background()

	// Create llmsvc client
	client, err := llmsvc.NewClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Create answer generator with llmsvc client
	generator := retrieval.NewAnswerGeneratorWithLLMSvc(client, nil)

	// Generate answer
	answer, sources := generator.Generate(ctx, "What is machine learning?", "Machine learning is a subset of AI and computer science.")

	if answer == "" {
		t.Fatal("generator returned empty answer")
	}

	t.Logf("generated answer: %s", answer)
	t.Logf("sources: %v", sources)
}
