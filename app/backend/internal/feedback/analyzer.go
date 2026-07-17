package feedback

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type FeedbackStats struct {
	TotalLikes        int64
	TotalDislikes     int64
	TotalFlags        int64
	LikePercentage    float64
	DislikePercentage float64
	FlagPercentage    float64
	TrendSinceHours   int
}

type LowConfidenceHotspot struct {
	EntityID              string
	RelationshipType      string
	TargetEntityID        string
	Confidence            float64
	FeedbackScore         float64
	NegativeFeedbackCount int64
	LastReevaluated       time.Time
}

type FeedbackAnalyzer struct {
	db *sql.DB
}

func NewFeedbackAnalyzer(db *sql.DB) *FeedbackAnalyzer {
	return &FeedbackAnalyzer{db: db}
}

func (fa *FeedbackAnalyzer) GetStats(ctx context.Context, sinceHours int) (*FeedbackStats, error) {
	query := `
		SELECT
			COALESCE(SUM(CASE WHEN feedback_type = 'like' THEN 1 ELSE 0 END), 0) as likes,
			COALESCE(SUM(CASE WHEN feedback_type = 'dislike' THEN 1 ELSE 0 END), 0) as dislikes,
			COALESCE(SUM(CASE WHEN feedback_type = 'flag' THEN 1 ELSE 0 END), 0) as flags,
			COUNT(*) as total
		FROM feedback_events
		WHERE created_at > NOW() - INTERVAL '1 hour' * $1
	`

	var likes, dislikes, flags, total int64
	err := fa.db.QueryRowContext(ctx, query, sinceHours).Scan(&likes, &dislikes, &flags, &total)
	if err != nil {
		return nil, fmt.Errorf("feedback.GetStats: %w", err)
	}

	stats := &FeedbackStats{
		TotalLikes:      likes,
		TotalDislikes:   dislikes,
		TotalFlags:      flags,
		TrendSinceHours: sinceHours,
	}

	if total > 0 {
		stats.LikePercentage = float64(likes) / float64(total) * 100
		stats.DislikePercentage = float64(dislikes) / float64(total) * 100
		stats.FlagPercentage = float64(flags) / float64(total) * 100
	}

	slog.InfoContext(ctx, "feedback stats computed", "total", total, "likes", likes, "dislikes", dislikes, "flags", flags)
	return stats, nil
}

func (fa *FeedbackAnalyzer) IdentifyLowConfidenceHotspots(ctx context.Context, confidenceThreshold float64) ([]*LowConfidenceHotspot, error) {
	query := `
		SELECT
			ec.entity_id,
			ec.relationship_type,
			ec.target_entity_id,
			ec.confidence,
			COALESCE(ec.feedback_score, 0) as feedback_score,
			COUNT(CASE WHEN fe.feedback_type = 'dislike' OR fe.feedback_type = 'flag' THEN 1 END) as negative_feedback,
			COALESCE(ec.last_reevaluated, ec.created_at) as last_reevaluated
		FROM extraction_confidence ec
		LEFT JOIN feedback_events fe ON fe.query_id IN (
			SELECT id FROM query_logs
			WHERE query_text LIKE CONCAT('%', ec.entity_id, '%')
		)
		WHERE ec.confidence < $1
		GROUP BY ec.id, ec.entity_id, ec.relationship_type, ec.target_entity_id, ec.confidence, ec.feedback_score, ec.last_reevaluated
		ORDER BY ec.confidence ASC, negative_feedback DESC
		LIMIT 100
	`

	rows, err := fa.db.QueryContext(ctx, query, confidenceThreshold)
	if err != nil {
		return nil, fmt.Errorf("feedback.IdentifyLowConfidenceHotspots: %w", err)
	}
	defer rows.Close()

	var hotspots []*LowConfidenceHotspot
	for rows.Next() {
		var h LowConfidenceHotspot
		if err := rows.Scan(&h.EntityID, &h.RelationshipType, &h.TargetEntityID, &h.Confidence, &h.FeedbackScore, &h.NegativeFeedbackCount, &h.LastReevaluated); err != nil {
			return nil, fmt.Errorf("feedback.IdentifyLowConfidenceHotspots scan: %w", err)
		}
		hotspots = append(hotspots, &h)
	}

	slog.InfoContext(ctx, "low confidence hotspots identified", "count", len(hotspots), "threshold", confidenceThreshold)
	return hotspots, rows.Err()
}

func (fa *FeedbackAnalyzer) GetTrendByDay(ctx context.Context, days int) (map[string]map[FeedbackType]int64, error) {
	query := `
		SELECT
			DATE(created_at) as day,
			feedback_type,
			COUNT(*) as count
		FROM feedback_events
		WHERE created_at > NOW() - INTERVAL '1 day' * $1
		GROUP BY DATE(created_at), feedback_type
		ORDER BY day DESC, feedback_type
	`

	rows, err := fa.db.QueryContext(ctx, query, days)
	if err != nil {
		return nil, fmt.Errorf("feedback.GetTrendByDay: %w", err)
	}
	defer rows.Close()

	trends := make(map[string]map[FeedbackType]int64)
	for rows.Next() {
		var day time.Time
		var feedbackType string
		var count int64
		if err := rows.Scan(&day, &feedbackType, &count); err != nil {
			return nil, fmt.Errorf("feedback.GetTrendByDay scan: %w", err)
		}

		dayStr := day.Format("2006-01-02")
		if trends[dayStr] == nil {
			trends[dayStr] = make(map[FeedbackType]int64)
		}
		trends[dayStr][FeedbackType(feedbackType)] = count
	}

	return trends, rows.Err()
}
