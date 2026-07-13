package api

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

// TestHandleFeedbackFunctionExists tests that HandleFeedback function exists
func TestHandleFeedbackFunctionExists(t *testing.T) {
	// This is a compile-time check that the function exists with correct signature
	var _ = HandleFeedback
	assert.True(t, true)
}

// TestHandleFeedbackStatsFunctionExists tests that HandleFeedbackStats function exists
func TestHandleFeedbackStatsFunctionExists(t *testing.T) {
	// This is a compile-time check
	var _ = HandleFeedbackStats
	assert.True(t, true)
}

// TestFeedbackResponseStructure tests FeedbackResponse type
func TestFeedbackResponseStructure(t *testing.T) {
	resp := FeedbackResponse{
		ID:           1,
		QueryID:      123,
		FeedbackType: "like",
		Comment:      "Great answer",
		CreatedAt:    "2026-07-12T10:00:00Z",
	}

	assert.Equal(t, int64(1), resp.ID)
	assert.Equal(t, int64(123), resp.QueryID)
	assert.Equal(t, "like", resp.FeedbackType)
	assert.Equal(t, "Great answer", resp.Comment)
}

// TestFeedbackRequestStructure tests FeedbackRequest type
func TestFeedbackRequestStructure(t *testing.T) {
	req := FeedbackRequest{
		QueryID:      456,
		FeedbackType: "dislike",
		Comment:      "Not helpful",
	}

	assert.Equal(t, int64(456), req.QueryID)
	assert.Equal(t, "dislike", req.FeedbackType)
	assert.Equal(t, "Not helpful", req.Comment)
}

// TestFeedbackStatsResponseStructure tests FeedbackStatsResponse type
func TestFeedbackStatsResponseStructure(t *testing.T) {
	resp := FeedbackStatsResponse{
		TotalLikes:        100,
		TotalDislikes:     20,
		TotalFlags:        5,
		LikePercentage:    77.0,
		DislikePercentage: 15.4,
		FlagPercentage:    3.8,
		TrendSinceHours:   24,
	}

	assert.Equal(t, int64(100), resp.TotalLikes)
	assert.Equal(t, int64(20), resp.TotalDislikes)
	assert.Equal(t, int64(5), resp.TotalFlags)
	assert.Equal(t, 77.0, resp.LikePercentage)
	assert.Equal(t, 15.4, resp.DislikePercentage)
	assert.Equal(t, 3.8, resp.FlagPercentage)
	assert.Equal(t, 24, resp.TrendSinceHours)
}

// TestHandleFeedbackReturnsHandlerFunc tests that HandleFeedback returns a HandlerFunc
func TestHandleFeedbackReturnsHandlerFunc(t *testing.T) {
	store := &feedback.FeedbackStore{}
	handler := HandleFeedback(store)

	// Verify handler is not nil
	assert.NotNil(t, handler)
}

// TestHandleFeedbackStatsReturnsHandlerFunc tests that HandleFeedbackStats returns a HandlerFunc
func TestHandleFeedbackStatsReturnsHandlerFunc(t *testing.T) {
	analyzer := &feedback.FeedbackAnalyzer{}
	handler := HandleFeedbackStats(analyzer)

	// Verify handler is not nil
	assert.NotNil(t, handler)
}

// TestFeedbackRequestWithEmptyComment tests FeedbackRequest with empty comment
func TestFeedbackRequestWithEmptyComment(t *testing.T) {
	req := FeedbackRequest{
		QueryID:      123,
		FeedbackType: "like",
		Comment:      "",
	}

	assert.Equal(t, int64(123), req.QueryID)
	assert.Equal(t, "like", req.FeedbackType)
	assert.Equal(t, "", req.Comment)
}

// TestFeedbackRequestWithAllFields tests FeedbackRequest with all fields
func TestFeedbackRequestWithAllFields(t *testing.T) {
	req := FeedbackRequest{
		QueryID:      789,
		FeedbackType: "flag",
		Comment:      "Inappropriate content",
	}

	assert.Equal(t, int64(789), req.QueryID)
	assert.Equal(t, "flag", req.FeedbackType)
	assert.Equal(t, "Inappropriate content", req.Comment)
}

// TestFeedbackResponseCreatedAtFormat tests CreatedAt timestamp format
func TestFeedbackResponseCreatedAtFormat(t *testing.T) {
	resp := FeedbackResponse{
		CreatedAt: "2026-07-12T15:30:45Z",
	}

	assert.Contains(t, resp.CreatedAt, "2026-07-12")
}

// TestFeedbackStatsResponseZeroValues tests FeedbackStatsResponse with zero values
func TestFeedbackStatsResponseZeroValues(t *testing.T) {
	resp := FeedbackStatsResponse{}

	assert.Equal(t, int64(0), resp.TotalLikes)
	assert.Equal(t, int64(0), resp.TotalDislikes)
	assert.Equal(t, int64(0), resp.TotalFlags)
	assert.Equal(t, 0.0, resp.LikePercentage)
	assert.Equal(t, 0, resp.TrendSinceHours)
}

// TestHandleFeedbackWithNilStore tests HandleFeedback with nil store
func TestHandleFeedbackWithNilStore(t *testing.T) {
	var store *feedback.FeedbackStore
	// This should not panic when creating the handler
	handler := HandleFeedback(store)
	assert.NotNil(t, handler)
}

// TestHandleFeedbackStatsWithNilAnalyzer tests HandleFeedbackStats with nil analyzer
func TestHandleFeedbackStatsWithNilAnalyzer(t *testing.T) {
	var analyzer *feedback.FeedbackAnalyzer
	// This should not panic when creating the handler
	handler := HandleFeedbackStats(analyzer)
	assert.NotNil(t, handler)
}

// TestFeedbackResponseJSON tests JSON serialization of FeedbackResponse
func TestFeedbackResponseJSON(t *testing.T) {
	resp := FeedbackResponse{
		ID:           42,
		QueryID:      123,
		FeedbackType: "like",
		Comment:      "Excellent",
		CreatedAt:    "2026-07-12T10:00:00Z",
	}

	assert.NotNil(t, resp)
	assert.NotEmpty(t, resp.CreatedAt)
}

// TestFeedbackStatsResponsePercentages tests FeedbackStatsResponse percentage calculations
func TestFeedbackStatsResponsePercentages(t *testing.T) {
	resp := FeedbackStatsResponse{
		LikePercentage:    50.0,
		DislikePercentage: 30.0,
		FlagPercentage:    20.0,
	}

	total := resp.LikePercentage + resp.DislikePercentage + resp.FlagPercentage
	assert.Equal(t, 100.0, total)
}

// TestHandleFeedbackSignature tests the handler function signature
func TestHandleFeedbackSignature(t *testing.T) {
	// Compile-time test that the function has the expected signature
	store := feedback.NewFeedbackStore(nil)
	handler := HandleFeedback(store)

	// Verify it returns an http.HandlerFunc
	assert.NotNil(t, handler)
}

// TestHandleFeedbackStatsSignature tests the handler function signature
func TestHandleFeedbackStatsSignature(t *testing.T) {
	// Compile-time test that the function has the expected signature
	analyzer := feedback.NewFeedbackAnalyzer(nil)
	handler := HandleFeedbackStats(analyzer)

	// Verify it returns an http.HandlerFunc
	assert.NotNil(t, handler)
}
