package feedback

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

type TrainingPair struct {
	QueryText       string                 `json:"query_text"`
	FeedbackType    string                 `json:"feedback_type"`
	Answer          string                 `json:"answer"`
	Citation        string                 `json:"citation"`
	IsPositive      bool                   `json:"is_positive"`
	ConfidenceScore float64                `json:"confidence_score"`
	Metadata        map[string]interface{} `json:"metadata"`
}

type Exporter struct {
	db *sql.DB
}

func NewExporter(db *sql.DB) *Exporter {
	return &Exporter{db: db}
}

func (e *Exporter) ExportTrainingPairs(ctx context.Context, sinceTime time.Time) ([]*TrainingPair, error) {
	query := `
		SELECT
			ql.query_text,
			fe.feedback_type,
			ql.id,
			fe.created_at
		FROM feedback_events fe
		JOIN query_logs ql ON fe.query_id = ql.id
		WHERE fe.created_at > $1
		AND (fe.feedback_type = 'like' OR fe.feedback_type = 'dislike' OR fe.feedback_type = 'flag')
		ORDER BY fe.created_at DESC
	`

	rows, err := e.db.QueryContext(ctx, query, sinceTime)
	if err != nil {
		return nil, fmt.Errorf("feedback.ExportTrainingPairs: %w", err)
	}
	defer rows.Close()

	var pairs []*TrainingPair
	for rows.Next() {
		var queryText, feedbackType string
		var queryID int64
		var createdAt time.Time

		if err := rows.Scan(&queryText, &feedbackType, &queryID, &createdAt); err != nil {
			return nil, fmt.Errorf("feedback.ExportTrainingPairs scan: %w", err)
		}

		pair := &TrainingPair{
			QueryText:    queryText,
			FeedbackType: feedbackType,
			IsPositive:   feedbackType == "like",
			Metadata: map[string]interface{}{
				"query_id":  queryID,
				"timestamp": createdAt.Unix(),
			},
		}
		pairs = append(pairs, pair)
	}

	slog.InfoContext(ctx, "training pairs exported", "count", len(pairs), "since", sinceTime)
	return pairs, rows.Err()
}

func (e *Exporter) ExportAsJSONL(ctx context.Context, pairs []*TrainingPair) ([]byte, error) {
	var result []byte
	for _, pair := range pairs {
		data, err := json.Marshal(pair)
		if err != nil {
			return nil, fmt.Errorf("feedback.ExportAsJSONL marshal: %w", err)
		}
		result = append(result, data...)
		result = append(result, '\n')
	}

	slog.InfoContext(ctx, "training pairs exported as JSONL", "count", len(pairs), "bytes", len(result))
	return result, nil
}

func (e *Exporter) ExportAsCSV(ctx context.Context, pairs []*TrainingPair) ([]byte, error) {
	result := []byte("query_text,feedback_type,is_positive,confidence_score,query_id,timestamp\n")

	for _, pair := range pairs {
		queryID := pair.Metadata["query_id"]
		timestamp := pair.Metadata["timestamp"]

		line := fmt.Sprintf("\"%s\",%s,%v,%f,%v,%v\n",
			escapeCSV(pair.QueryText),
			pair.FeedbackType,
			pair.IsPositive,
			pair.ConfidenceScore,
			queryID,
			timestamp,
		)
		result = append(result, []byte(line)...)
	}

	slog.InfoContext(ctx, "training pairs exported as CSV", "count", len(pairs), "bytes", len(result))
	return result, nil
}

func escapeCSV(s string) string {
	result := ""
	for _, r := range s {
		if r == '"' {
			result += "\"\""
		} else {
			result += string(r)
		}
	}
	return result
}

func (e *Exporter) GetExportStats(ctx context.Context, sinceTime time.Time) (map[string]interface{}, error) {
	query := `
		SELECT
			COUNT(*) as total_pairs,
			SUM(CASE WHEN fe.feedback_type = 'like' THEN 1 ELSE 0 END) as positive_pairs,
			SUM(CASE WHEN fe.feedback_type IN ('dislike', 'flag') THEN 1 ELSE 0 END) as negative_pairs,
			COUNT(DISTINCT fe.user_id) as unique_users,
			COUNT(DISTINCT fe.query_id) as unique_queries
		FROM feedback_events fe
		WHERE fe.created_at > $1
	`

	var totalPairs, positivePairs, negativePairs, uniqueUsers, uniqueQueries sql.NullInt64

	err := e.db.QueryRowContext(ctx, query, sinceTime).Scan(&totalPairs, &positivePairs, &negativePairs, &uniqueUsers, &uniqueQueries)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("feedback.GetExportStats: %w", err)
	}

	stats := make(map[string]interface{})
	if totalPairs.Valid {
		stats["total_pairs"] = totalPairs.Int64
	}
	if positivePairs.Valid {
		stats["positive_pairs"] = positivePairs.Int64
	}
	if negativePairs.Valid {
		stats["negative_pairs"] = negativePairs.Int64
	}
	if uniqueUsers.Valid {
		stats["unique_users"] = uniqueUsers.Int64
	}
	if uniqueQueries.Valid {
		stats["unique_queries"] = uniqueQueries.Int64
	}

	return stats, nil
}
