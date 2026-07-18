package nlp

import (
	"context"
	"database/sql"
	"fmt"
)

type ConfidenceScorer struct {
	db *sql.DB
}

func NewConfidenceScorer(db *sql.DB) *ConfidenceScorer {
	return &ConfidenceScorer{db: db}
}

func (cs *ConfidenceScorer) Score(ctx context.Context, entityID, relationshipType, targetID string, confidence float64, sourceChunkID int) error {
	if confidence < 0 || confidence > 1 {
		return fmt.Errorf("confidence must be in [0, 1]")
	}

	_, err := cs.db.ExecContext(ctx,
		`INSERT INTO extraction_confidence (entity_id, relationship_type, target_entity_id, confidence, created_at)
		 VALUES ($1, $2, $3, $4, now())`,
		entityID, relationshipType, targetID, confidence)

	return err
}

func (cs *ConfidenceScorer) GetLowConfidenceEdges(ctx context.Context, threshold float64) ([]map[string]interface{}, error) {
	rows, err := cs.db.QueryContext(ctx,
		`SELECT entity_id, relationship_type, target_entity_id, confidence
		 FROM extraction_confidence WHERE confidence < $1`,
		threshold)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []map[string]interface{}
	for rows.Next() {
		var entityID, relType, targetID string
		var conf float64
		if err := rows.Scan(&entityID, &relType, &targetID, &conf); err != nil {
			return nil, err
		}
		edges = append(edges, map[string]interface{}{
			"entity_id":         entityID,
			"relationship_type": relType,
			"target_entity_id":  targetID,
			"confidence":        conf,
		})
	}

	return edges, rows.Err()
}
