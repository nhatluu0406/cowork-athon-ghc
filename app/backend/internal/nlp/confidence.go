// Package nlp provides NLP operations for entity extraction and scoring.
// Task T048: Implement confidence scoring (0.0-1.0) for extracted entities/relationships
package nlp

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/metadata"
	"github.com/rad-system/m365-knowledge-graph/pkg/types"
)

// ConfidenceScorer manages confidence tracking for extracted entities and relationships.
// Uses the Repository interface to remain database-agnostic (supports both PostgreSQL and SQLite).
type ConfidenceScorer struct {
	repo   metadata.Repository
	logger *slog.Logger
}

// NewConfidenceScorer creates a new confidence scorer using the metadata repository.
func NewConfidenceScorer(repo metadata.Repository) *ConfidenceScorer {
	return &ConfidenceScorer{
		repo:   repo,
		logger: slog.Default().With("component", "nlp.ConfidenceScorer"),
	}
}

// Score records the confidence level for an extracted entity/relationship pair.
// Task T048: Confidence must be in [0.0, 1.0] range
// confidence: 0.0 = low confidence, 1.0 = high confidence
// sourceChunkID: ID of the chunk this extraction came from (for traceability)
func (cs *ConfidenceScorer) Score(ctx context.Context, entityID, relationshipType, targetID string, confidence float32) error {
	if confidence < 0 || confidence > 1 {
		return fmt.Errorf("confidence must be in [0.0, 1.0], got %f", confidence)
	}

	if entityID == "" {
		return fmt.Errorf("entity_id is required")
	}

	cs.logger.Debug("recording confidence score",
		"entity_id", entityID,
		"relationship_type", relationshipType,
		"target_id", targetID,
		"confidence", confidence)

	// Create ExtractionConfidence record
	conf := &types.ExtractionConfidence{
		EntityID:        entityID,
		ConfidenceScore: confidence,
	}

	// Upsert into repository
	if err := cs.repo.UpsertConfidence(ctx, conf); err != nil {
		cs.logger.Error("failed to record confidence score",
			"err", err,
			"entity_id", entityID,
			"confidence", confidence)
		return fmt.Errorf("nlp.ConfidenceScorer.Score: %w", err)
	}

	return nil
}

// GetLowConfidenceEdges retrieves entities/relationships below the confidence threshold.
// Task T048: Used for feedback-driven re-evaluation (Phase 6)
// threshold: confidence score below which edges are considered "low confidence" (e.g., 0.5)
func (cs *ConfidenceScorer) GetLowConfidenceEdges(ctx context.Context, threshold float32) ([]*types.ExtractionConfidence, error) {
	if threshold < 0 || threshold > 1 {
		return nil, fmt.Errorf("threshold must be in [0.0, 1.0], got %f", threshold)
	}

	cs.logger.Debug("fetching low confidence edges", "threshold", threshold)

	edges, err := cs.repo.QueryLowConfidenceEdges(ctx, float64(threshold))
	if err != nil {
		cs.logger.Error("failed to query low confidence edges",
			"err", err,
			"threshold", threshold)
		return nil, fmt.Errorf("nlp.ConfidenceScorer.GetLowConfidenceEdges: %w", err)
	}

	cs.logger.Debug("found low confidence edges", "count", len(edges), "threshold", threshold)
	return edges, nil
}

// ScoreRange provides guidance for confidence interpretation
type ScoreRange struct {
	High        float32 // >= High: high confidence (e.g., 0.8)
	Medium      float32 // >= Medium && < High: medium confidence (e.g., 0.6)
	Low         float32 // >= Low && < Medium: low confidence (e.g., 0.4)
	VeryLow     float32 // < Low: very low confidence (e.g., 0.4)
}

// DefaultScoreRange returns sensible defaults for confidence interpretation
func DefaultScoreRange() ScoreRange {
	return ScoreRange{
		High:    0.8,
		Medium:  0.6,
		Low:     0.4,
		VeryLow: 0.0,
	}
}

// ClassifyConfidence returns a human-readable classification of the confidence level
func ClassifyConfidence(score float32) string {
	sr := DefaultScoreRange()
	switch {
	case score >= sr.High:
		return "HIGH"
	case score >= sr.Medium:
		return "MEDIUM"
	case score >= sr.Low:
		return "LOW"
	default:
		return "VERY_LOW"
	}
}
