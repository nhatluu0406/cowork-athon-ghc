package retrieval

import "context"

// ScoredChunkResult is a search result from the similarity index.
type ScoredChunkResult struct {
	ChunkID int64
	Score   float32
}

// SimilaritySearcher is the port for vector-similarity search.
type SimilaritySearcher interface {
	SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]ScoredChunkResult, error)
}

// PermissionFilter enforces row-level access control on retrieval results.
type PermissionFilter struct{}

func NewPermissionFilter() *PermissionFilter { return &PermissionFilter{} }
