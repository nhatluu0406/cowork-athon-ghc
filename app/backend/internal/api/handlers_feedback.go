package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

type FeedbackRequest struct {
	QueryID      int64  `json:"query_id"`
	FeedbackType string `json:"feedback_type"` // like, dislike, flag
	Comment      string `json:"comment,omitempty"`
}

type FeedbackResponse struct {
	ID           int64  `json:"id"`
	QueryID      int64  `json:"query_id"`
	FeedbackType string `json:"feedback_type"`
	Comment      string `json:"comment"`
	CreatedAt    string `json:"created_at"`
}

type FeedbackStatsResponse struct {
	TotalLikes        int64   `json:"total_likes"`
	TotalDislikes     int64   `json:"total_dislikes"`
	TotalFlags        int64   `json:"total_flags"`
	LikePercentage    float64 `json:"like_percentage"`
	DislikePercentage float64 `json:"dislike_percentage"`
	FlagPercentage    float64 `json:"flag_percentage"`
	TrendSinceHours   int     `json:"trend_since_hours"`
}

func HandleFeedback(store *feedback.FeedbackStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req FeedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		// TODO: extract userID from JWT token in Authorization header
		userID := r.Header.Get("X-User-ID")
		if userID == "" {
			userID = "anonymous"
		}

		fe, err := store.Record(r.Context(), req.QueryID, userID, feedback.FeedbackType(req.FeedbackType), req.Comment)
		if err != nil {
			if errors.Is(err, feedback.ErrQueryNotFound) {
				http.Error(w, "query_id not found", http.StatusNotFound)
				return
			}
			http.Error(w, "feedback not recorded: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := FeedbackResponse{
			ID:           fe.ID,
			QueryID:      fe.QueryID,
			FeedbackType: string(fe.FeedbackType),
			Comment:      fe.Comment,
			CreatedAt:    fe.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func HandleFeedbackStats(analyzer *feedback.FeedbackAnalyzer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		sinceHours := 24
		if q := r.URL.Query().Get("since_hours"); q != "" {
			if h, err := strconv.Atoi(q); err == nil && h > 0 {
				sinceHours = h
			}
		}

		stats, err := analyzer.GetStats(r.Context(), sinceHours)
		if err != nil {
			http.Error(w, "failed to get stats: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := FeedbackStatsResponse{
			TotalLikes:        stats.TotalLikes,
			TotalDislikes:     stats.TotalDislikes,
			TotalFlags:        stats.TotalFlags,
			LikePercentage:    stats.LikePercentage,
			DislikePercentage: stats.DislikePercentage,
			FlagPercentage:    stats.FlagPercentage,
			TrendSinceHours:   stats.TrendSinceHours,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}
