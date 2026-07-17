package retrieval_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

func TestNewReranker(t *testing.T) {
	r := retrieval.NewReranker()
	if r == nil {
		t.Fatal("expected reranker, got nil")
	}
}

func TestRerankerRank_OrdersByCombinedScore(t *testing.T) {
	r := retrieval.NewReranker()
	results := []map[string]interface{}{
		{"chunk_id": 1, "score": 0.2},                // low relevance
		{"chunk_id": 2, "score": 0.9},                // high relevance
		{"entity_id": "e1", "depth": int64(1)},       // graph result, shallow
		{"entity_id": "e2", "depth": int64(3)},       // graph result, deep
	}

	ranked := r.Rank(context.Background(), results)

	if len(ranked) != len(results) {
		t.Fatalf("expected %d results, got %d", len(results), len(ranked))
	}

	// chunk_id 2 (highest relevance) must rank above chunk_id 1 (lowest)
	posOf := func(key string, val interface{}) int {
		for i, res := range ranked {
			if res[key] == val {
				return i
			}
		}
		return -1
	}
	if posOf("chunk_id", 2) > posOf("chunk_id", 1) {
		t.Error("expected chunk_id=2 (score 0.9) to rank above chunk_id=1 (score 0.2)")
	}
	// shallower graph result (depth 1) should rank above deeper one (depth 3)
	if posOf("entity_id", "e1") > posOf("entity_id", "e2") {
		t.Error("expected entity e1 (depth 1) to rank above entity e2 (depth 3)")
	}

	// every result must have a combined_score attached
	for _, res := range ranked {
		if _, ok := res["combined_score"].(float64); !ok {
			t.Errorf("expected combined_score to be set on %v", res)
		}
	}
}
