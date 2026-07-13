package feedback

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/lib/pq"
)

// ErrQueryNotFound is returned by Record when query_id does not reference an
// existing query_logs row (Postgres foreign_key_violation, SQLSTATE 23503).
var ErrQueryNotFound = errors.New("query_id not found")

type FeedbackType string

const (
	FeedbackLike    FeedbackType = "like"
	FeedbackDislike FeedbackType = "dislike"
	FeedbackFlag    FeedbackType = "flag"
)

type FeedbackEvent struct {
	ID           int64
	QueryID      int64
	UserID       string
	FeedbackType FeedbackType
	Comment      string
	CreatedAt    time.Time
}

type FeedbackStore struct {
	db *sql.DB
}

func NewFeedbackStore(db *sql.DB) *FeedbackStore {
	return &FeedbackStore{db: db}
}

func (fs *FeedbackStore) Record(ctx context.Context, queryID int64, userID string, feedbackType FeedbackType, comment string) (*FeedbackEvent, error) {
	query := `INSERT INTO feedback_events (query_id, user_id, feedback_type, comment, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		RETURNING id, query_id, user_id, feedback_type, comment, created_at`

	var fe FeedbackEvent
	err := fs.db.QueryRowContext(ctx, query, queryID, userID, string(feedbackType), comment).Scan(
		&fe.ID, &fe.QueryID, &fe.UserID, &fe.FeedbackType, &fe.Comment, &fe.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("%w: %d", ErrQueryNotFound, queryID)
		}
		// A violated FK on query_id surfaces as a *pq.Error (SQLSTATE 23503),
		// NOT sql.ErrNoRows — INSERT...RETURNING fails the statement outright
		// rather than returning zero rows. This is the actual error path a
		// nonexistent query_id takes; the sql.ErrNoRows branch above is
		// unreachable for this specific failure mode but kept for safety.
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23503" {
			return nil, fmt.Errorf("%w: %d", ErrQueryNotFound, queryID)
		}
		return nil, fmt.Errorf("feedback.Record: %w", err)
	}

	slog.InfoContext(ctx, "feedback recorded", "query_id", queryID, "type", feedbackType, "user_id", userID)
	return &fe, nil
}

func (fs *FeedbackStore) GetByQueryID(ctx context.Context, queryID int64) ([]*FeedbackEvent, error) {
	rows, err := fs.db.QueryContext(ctx, `
		SELECT id, query_id, user_id, feedback_type, comment, created_at
		FROM feedback_events
		WHERE query_id = $1
		ORDER BY created_at DESC
	`, queryID)
	if err != nil {
		return nil, fmt.Errorf("feedback.GetByQueryID: %w", err)
	}
	defer rows.Close()

	var events []*FeedbackEvent
	for rows.Next() {
		var fe FeedbackEvent
		if err := rows.Scan(&fe.ID, &fe.QueryID, &fe.UserID, &fe.FeedbackType, &fe.Comment, &fe.CreatedAt); err != nil {
			return nil, fmt.Errorf("feedback.GetByQueryID scan: %w", err)
		}
		events = append(events, &fe)
	}
	return events, rows.Err()
}

func (fs *FeedbackStore) GetRecentFeedback(ctx context.Context, limit int, offset int) ([]*FeedbackEvent, error) {
	rows, err := fs.db.QueryContext(ctx, `
		SELECT id, query_id, user_id, feedback_type, comment, created_at
		FROM feedback_events
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("feedback.GetRecentFeedback: %w", err)
	}
	defer rows.Close()

	var events []*FeedbackEvent
	for rows.Next() {
		var fe FeedbackEvent
		if err := rows.Scan(&fe.ID, &fe.QueryID, &fe.UserID, &fe.FeedbackType, &fe.Comment, &fe.CreatedAt); err != nil {
			return nil, fmt.Errorf("feedback.GetRecentFeedback scan: %w", err)
		}
		events = append(events, &fe)
	}
	return events, rows.Err()
}

func (fs *FeedbackStore) CountByType(ctx context.Context, feedbackType FeedbackType) (int64, error) {
	var count int64
	err := fs.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM feedback_events WHERE feedback_type = $1
	`, string(feedbackType)).Scan(&count)
	return count, err
}
