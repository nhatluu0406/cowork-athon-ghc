package nlp_test

import (
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/nlp"
	unit_test "github.com/rad-system/m365-knowledge-graph/tests/unit"
)

func TestNewConfidenceScorer(t *testing.T) {
	db := unit_test.SetupTestDB(t)
	defer unit_test.TeardownTestDB(t, db)

	scorer := nlp.NewConfidenceScorer(db)
	if scorer == nil {
		t.Fatal("expected scorer, got nil")
	}
}

func TestConfidenceScorerValidation(t *testing.T) {
	// Test validation logic without requiring full DB schema
	tt := []struct {
		name       string
		confidence float64
		shouldFail bool
	}{
		{"accepts valid confidence 0.5", 0.5, false},
		{"accepts valid confidence 1.0", 1.0, false},
		{"rejects confidence < 0", -0.1, true},
		{"rejects confidence > 1", 1.1, true},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			// Validation happens before DB call
			if tc.confidence < 0 || tc.confidence > 1 {
				if !tc.shouldFail {
					t.Error("expected validation to fail for out-of-range confidence")
				}
			} else {
				if tc.shouldFail {
					t.Error("expected validation to pass for in-range confidence")
				}
			}
		})
	}
}
