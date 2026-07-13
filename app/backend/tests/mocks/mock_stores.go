package mocks

import (
	"context"
	"fmt"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// MockFeedbackStore is a mock implementation of feedback.FeedbackStore
type MockFeedbackStore struct {
	RecordFunc              func(ctx context.Context, queryID int64, userID string, feedbackType feedback.FeedbackType, comment string) (*feedback.FeedbackEvent, error)
	GetByQueryIDFunc        func(ctx context.Context, queryID int64) ([]*feedback.FeedbackEvent, error)
	GetRecentFeedbackFunc   func(ctx context.Context, limit int, offset int) ([]*feedback.FeedbackEvent, error)
	GetFeedbackCountByType  func(ctx context.Context, ftype feedback.FeedbackType) (int64, error)
	RecordedFeedback        []*feedback.FeedbackEvent
}

func (m *MockFeedbackStore) Record(ctx context.Context, queryID int64, userID string, feedbackType feedback.FeedbackType, comment string) (*feedback.FeedbackEvent, error) {
	if m.RecordFunc != nil {
		return m.RecordFunc(ctx, queryID, userID, feedbackType, comment)
	}
	event := &feedback.FeedbackEvent{
		ID:           int64(len(m.RecordedFeedback) + 1),
		QueryID:      queryID,
		UserID:       userID,
		FeedbackType: feedbackType,
		Comment:      comment,
		CreatedAt:    time.Now(),
	}
	m.RecordedFeedback = append(m.RecordedFeedback, event)
	return event, nil
}

func (m *MockFeedbackStore) GetByQueryID(ctx context.Context, queryID int64) ([]*feedback.FeedbackEvent, error) {
	if m.GetByQueryIDFunc != nil {
		return m.GetByQueryIDFunc(ctx, queryID)
	}
	var result []*feedback.FeedbackEvent
	for _, fe := range m.RecordedFeedback {
		if fe.QueryID == queryID {
			result = append(result, fe)
		}
	}
	return result, nil
}

func (m *MockFeedbackStore) GetRecentFeedback(ctx context.Context, limit int, offset int) ([]*feedback.FeedbackEvent, error) {
	if m.GetRecentFeedbackFunc != nil {
		return m.GetRecentFeedbackFunc(ctx, limit, offset)
	}
	return m.RecordedFeedback, nil
}

// MockFeedbackAnalyzer is a mock implementation of feedback.FeedbackAnalyzer
type MockFeedbackAnalyzer struct {
	GetStatsFunc   func(ctx context.Context, sinceHours int) (*feedback.FeedbackStats, error)
	FindLowConfidenceFunc func(ctx context.Context, confidenceThreshold float64) ([]int64, error)
	StatsResult    *feedback.FeedbackStats
}

func (m *MockFeedbackAnalyzer) GetStats(ctx context.Context, sinceHours int) (*feedback.FeedbackStats, error) {
	if m.GetStatsFunc != nil {
		return m.GetStatsFunc(ctx, sinceHours)
	}
	if m.StatsResult != nil {
		return m.StatsResult, nil
	}
	return &feedback.FeedbackStats{
		TotalLikes:        10,
		TotalDislikes:     5,
		TotalFlags:        2,
		LikePercentage:    62.5,
		DislikePercentage: 31.25,
		FlagPercentage:    12.5,
		TrendSinceHours:   24,
	}, nil
}

func (m *MockFeedbackAnalyzer) FindLowConfidenceExtractions(ctx context.Context, confidenceThreshold float64) ([]int64, error) {
	if m.FindLowConfidenceFunc != nil {
		return m.FindLowConfidenceFunc(ctx, confidenceThreshold)
	}
	return []int64{1, 2, 3}, nil
}

// MockEmbeddingStore is a mock implementation of embedding.Store
type MockEmbeddingStore struct {
	EnsureModelFunc    func(ctx context.Context, name string, version string, dimensions int32) (int64, error)
	SaveEmbeddingFunc  func(ctx context.Context, chunkID int64, modelID int64, vector []float32) error
	SearchSimilarFunc  func(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]embedding.ScoredChunk, error)
	EmbeddingCache     map[string][]float32
}

func (m *MockEmbeddingStore) EnsureModel(ctx context.Context, name string, version string, dimensions int32) (int64, error) {
	if m.EnsureModelFunc != nil {
		return m.EnsureModelFunc(ctx, name, version, dimensions)
	}
	return 1, nil
}

func (m *MockEmbeddingStore) SaveEmbedding(ctx context.Context, chunkID int64, modelID int64, vector []float32) error {
	if m.SaveEmbeddingFunc != nil {
		return m.SaveEmbeddingFunc(ctx, chunkID, modelID, vector)
	}
	if m.EmbeddingCache == nil {
		m.EmbeddingCache = make(map[string][]float32)
	}
	// Simple cache key generation
	key := fmt.Sprintf("%d:%d", chunkID, modelID)
	m.EmbeddingCache[key] = vector
	return nil
}

func (m *MockEmbeddingStore) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]embedding.ScoredChunk, error) {
	if m.SearchSimilarFunc != nil {
		return m.SearchSimilarFunc(ctx, modelID, queryVec, topK)
	}
	return []embedding.ScoredChunk{
		{ChunkID: 1, Score: 0.95},
		{ChunkID: 2, Score: 0.87},
	}, nil
}

// MockRetriever is a mock implementation of retrieval.Retriever
type MockRetriever struct {
	QueryFunc   func(ctx context.Context, req *retrieval.QueryRequest) (*retrieval.QueryResponse, error)
	QueryResult *retrieval.QueryResponse
}

func (m *MockRetriever) Query(ctx context.Context, req *retrieval.QueryRequest) (*retrieval.QueryResponse, error) {
	if m.QueryFunc != nil {
		return m.QueryFunc(ctx, req)
	}
	if m.QueryResult != nil {
		return m.QueryResult, nil
	}
	return &retrieval.QueryResponse{
		Answer:    "Test answer",
		LatencyMs: 100,
	}, nil
}

// MockPermissionFilter is a mock implementation of retrieval.PermissionFilter
type MockPermissionFilter struct {
	FilterFunc func(ctx context.Context, userID string) ([]int64, error)
	AllowList  []int64
}

func (m *MockPermissionFilter) Filter(ctx context.Context, userID string) ([]int64, error) {
	if m.FilterFunc != nil {
		return m.FilterFunc(ctx, userID)
	}
	return m.AllowList, nil
}

// MockSimilaritySearcher is a mock implementation of retrieval.SimilaritySearcher
type MockSimilaritySearcher struct {
	SearchSimilarFunc func(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error)
}

func (m *MockSimilaritySearcher) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error) {
	if m.SearchSimilarFunc != nil {
		return m.SearchSimilarFunc(ctx, modelID, queryVec, topK)
	}
	return []retrieval.ScoredChunkResult{
		{ChunkID: 1, Score: 0.95},
	}, nil
}
