package feedback

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type ReevaluationCandidate struct {
	EntityID          string
	RelationshipType  string
	TargetEntityID    string
	SourceChunkID     int
	CurrentConfidence float64
	FeedbackScore     float64
}

type Improver struct {
	db *sql.DB
}

func NewImprover(db *sql.DB) *Improver {
	return &Improver{db: db}
}

func (i *Improver) SelectCandidatesForReevaluation(ctx context.Context, confidenceThreshold float64, maxAge time.Duration) ([]*ReevaluationCandidate, error) {
	query := `
		SELECT
			ec.entity_id,
			ec.relationship_type,
			ec.target_entity_id,
			COALESCE((
				SELECT chunk_id FROM extraction_confidence
				WHERE entity_id = ec.entity_id
				AND relationship_type = ec.relationship_type
				LIMIT 1
			), 0) as source_chunk_id,
			ec.confidence,
			COALESCE(ec.feedback_score, 0) as feedback_score
		FROM extraction_confidence ec
		WHERE ec.confidence < $1
		AND (ec.last_reevaluated IS NULL OR ec.last_reevaluated < NOW() - INTERVAL '1 second' * $2)
		ORDER BY ec.confidence ASC, ec.feedback_score DESC
		LIMIT 100
	`

	rows, err := i.db.QueryContext(ctx, query, confidenceThreshold, int64(maxAge.Seconds()))
	if err != nil {
		return nil, fmt.Errorf("feedback.SelectCandidatesForReevaluation: %w", err)
	}
	defer rows.Close()

	var candidates []*ReevaluationCandidate
	for rows.Next() {
		var c ReevaluationCandidate
		if err := rows.Scan(&c.EntityID, &c.RelationshipType, &c.TargetEntityID, &c.SourceChunkID, &c.CurrentConfidence, &c.FeedbackScore); err != nil {
			return nil, fmt.Errorf("feedback.SelectCandidatesForReevaluation scan: %w", err)
		}
		candidates = append(candidates, &c)
	}

	slog.InfoContext(ctx, "reevaluation candidates selected", "count", len(candidates), "threshold", confidenceThreshold)
	return candidates, rows.Err()
}

func (i *Improver) UpdateConfidence(ctx context.Context, entityID, relationshipType, targetEntityID string, newConfidence float64) error {
	query := `
		UPDATE extraction_confidence
		SET confidence = $1, last_reevaluated = NOW()
		WHERE entity_id = $2 AND relationship_type = $3 AND target_entity_id = $4
	`

	result, err := i.db.ExecContext(ctx, query, newConfidence, entityID, relationshipType, targetEntityID)
	if err != nil {
		return fmt.Errorf("feedback.UpdateConfidence: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("feedback.UpdateConfidence rows affected: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("feedback.UpdateConfidence: no rows updated for %s/%s/%s", entityID, relationshipType, targetEntityID)
	}

	slog.InfoContext(ctx, "confidence updated", "entity", entityID, "rel_type", relationshipType, "new_confidence", newConfidence)
	return nil
}

func (i *Improver) RecordFeedbackScore(ctx context.Context, entityID, relationshipType, targetEntityID string, score float64) error {
	query := `
		UPDATE extraction_confidence
		SET feedback_score = $1
		WHERE entity_id = $2 AND relationship_type = $3 AND target_entity_id = $4
	`

	_, err := i.db.ExecContext(ctx, query, score, entityID, relationshipType, targetEntityID)
	if err != nil {
		return fmt.Errorf("feedback.RecordFeedbackScore: %w", err)
	}

	return nil
}

func (i *Improver) GetReevaluationStats(ctx context.Context) (map[string]interface{}, error) {
	query := `
		SELECT
			COUNT(*) as total_edges,
			SUM(CASE WHEN confidence < 0.5 THEN 1 ELSE 0 END) as low_confidence_edges,
			SUM(CASE WHEN confidence < 0.7 THEN 1 ELSE 0 END) as medium_confidence_edges,
			AVG(confidence) as avg_confidence,
			AVG(CASE WHEN feedback_score IS NOT NULL THEN feedback_score END) as avg_feedback_score,
			MAX(last_reevaluated) as last_reevaluation
		FROM extraction_confidence
	`

	var totalEdges sql.NullInt64
	var lowConfEdges sql.NullInt64
	var mediumConfEdges sql.NullInt64
	var avgConf sql.NullFloat64
	var avgFeedback sql.NullFloat64
	var lastReeval sql.NullTime

	err := i.db.QueryRowContext(ctx, query).Scan(&totalEdges, &lowConfEdges, &mediumConfEdges, &avgConf, &avgFeedback, &lastReeval)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("feedback.GetReevaluationStats: %w", err)
	}

	stats := make(map[string]interface{})
	if totalEdges.Valid {
		stats["total_edges"] = totalEdges.Int64
	}
	if lowConfEdges.Valid {
		stats["low_confidence_edges"] = lowConfEdges.Int64
	}
	if mediumConfEdges.Valid {
		stats["medium_confidence_edges"] = mediumConfEdges.Int64
	}
	if avgConf.Valid {
		stats["avg_confidence"] = avgConf.Float64
	}
	if avgFeedback.Valid {
		stats["avg_feedback_score"] = avgFeedback.Float64
	}
	if lastReeval.Valid {
		stats["last_reevaluation"] = lastReeval.Time
	}

	return stats, nil
}
