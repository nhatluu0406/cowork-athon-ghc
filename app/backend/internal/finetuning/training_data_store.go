package finetuning

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type TrainingDataStoreImpl struct {
	db *sql.DB
}

func NewTrainingDataStore(db *sql.DB) *TrainingDataStoreImpl {
	return &TrainingDataStoreImpl{db: db}
}

func (tds *TrainingDataStoreImpl) ExportTrainingPairs(ctx context.Context, since time.Time) ([]*TrainingData, error) {
	query := `
		SELECT
			ql.query_text,
			fe.feedback_type,
			'You are an expert Q&A assistant for enterprise knowledge graphs. Answer questions based on provided context.' as system_prompt,
			COALESCE((
				SELECT STRING_AGG(c.text, ' ' ORDER BY c.chunk_index)
				FROM chunks c
				WHERE c.id IN (
					SELECT source_chunk_id FROM extraction_confidence
					WHERE entity_id = (SELECT entity_id FROM extraction_confidence LIMIT 1)
					LIMIT 3
				)
			), 'No context available') as context_text
		FROM feedback_events fe
		JOIN query_logs ql ON fe.query_id = ql.id
		WHERE fe.created_at > $1
		AND fe.feedback_type IN ('like', 'dislike')
		ORDER BY fe.created_at DESC
		LIMIT 500
	`

	rows, err := tds.db.QueryContext(ctx, query, since)
	if err != nil {
		return nil, fmt.Errorf("training_data_store.ExportTrainingPairs: %w", err)
	}
	defer rows.Close()

	var pairs []*TrainingData
	for rows.Next() {
		var query, feedbackType, system, context string
		if err := rows.Scan(&query, &feedbackType, &system, &context); err != nil {
			return nil, fmt.Errorf("training_data_store.ExportTrainingPairs scan: %w", err)
		}

		// Build synthetic answer from context + feedback signal
		answer := fmt.Sprintf("Based on the provided context: %s\n\nThis is a %s response.", context, feedbackType)

		pair := &TrainingData{
			System:    system,
			UserQuery: query,
			Answer:    answer,
			Positive:  feedbackType == "like",
		}
		pairs = append(pairs, pair)
	}

	slog.InfoContext(ctx, "training pairs exported", "count", len(pairs), "since", since)
	return pairs, rows.Err()
}

// GetFeedbackStats returns feedback volume metrics
func (tds *TrainingDataStoreImpl) GetFeedbackStats(ctx context.Context, days int) (map[string]interface{}, error) {
	query := `
		SELECT
			SUM(CASE WHEN feedback_type = 'like' THEN 1 ELSE 0 END) as likes,
			SUM(CASE WHEN feedback_type = 'dislike' THEN 1 ELSE 0 END) as dislikes,
			COUNT(*) as total
		FROM feedback_events
		WHERE created_at > NOW() - INTERVAL '1 day' * $1
	`

	var likes, dislikes, total sql.NullInt64
	err := tds.db.QueryRowContext(ctx, query, days).Scan(&likes, &dislikes, &total)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("training_data_store.GetFeedbackStats: %w", err)
	}

	stats := make(map[string]interface{})
	if likes.Valid {
		stats["likes"] = likes.Int64
	}
	if dislikes.Valid {
		stats["dislikes"] = dislikes.Int64
	}
	if total.Valid {
		stats["total"] = total.Int64
	}

	return stats, nil
}
