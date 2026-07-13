package retrieval_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// mockEmbedder implements retrieval.EmbeddingRuntime for tests.
type mockEmbedder struct {
	vec []float32
	err error
}

func (m *mockEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if m.err != nil {
		return nil, m.err
	}
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = m.vec
	}
	return out, nil
}

// mockSearcher implements retrieval.SimilaritySearcher for tests.
type mockSearcher struct {
	results []retrieval.ScoredChunkResult
	err     error
}

func (m *mockSearcher) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.results, nil
}

func TestNewSemanticSearch(t *testing.T) {
	ss := retrieval.NewSemanticSearch(nil, nil, nil, 1)
	if ss == nil {
		t.Fatal("expected semantic search, got nil")
	}
}

func TestSemanticSearchSearch_NoEmbedder(t *testing.T) {
	// Without an embedder/searcher wired in, Search must return nil safely
	// rather than panic — this is the state before Group C (embeddings) is
	// fully connected in a given deployment.
	ss := retrieval.NewSemanticSearch(nil, nil, nil, 1)
	results := ss.Search(context.Background(), "test query", []int{1, 2, 3})
	if results != nil {
		t.Errorf("expected nil results with no embedder/searcher, got %v", results)
	}
}

func TestSemanticSearchSearch_EmbedderError(t *testing.T) {
	embedder := &mockEmbedder{err: context.DeadlineExceeded}
	searcher := &mockSearcher{}
	ss := retrieval.NewSemanticSearch(nil, embedder, searcher, 1)
	results := ss.Search(context.Background(), "test query", []int{1, 2, 3})
	if results != nil {
		t.Errorf("expected nil results on embedder error, got %v", results)
	}
}

func TestSemanticSearchSearch_NoAllowedFiles(t *testing.T) {
	// INVARIANT-1: an empty permission scope must yield zero results, not
	// fall open and search everything.
	embedder := &mockEmbedder{vec: []float32{1, 0, 0}}
	searcher := &mockSearcher{results: []retrieval.ScoredChunkResult{{ChunkID: 1, Score: 0.9}}}
	ss := retrieval.NewSemanticSearch(nil, embedder, searcher, 1)
	results := ss.Search(context.Background(), "test query", nil)
	if results != nil {
		t.Errorf("expected nil results with empty allowedFileIDs, got %v", results)
	}
}
