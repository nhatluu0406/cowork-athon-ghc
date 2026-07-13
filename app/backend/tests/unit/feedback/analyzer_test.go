package feedback_test

import (
	"database/sql"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

func TestNewFeedbackAnalyzer(t *testing.T) {
	db := &sql.DB{}
	analyzer := feedback.NewFeedbackAnalyzer(db)
	if analyzer == nil {
		t.Fatal("expected analyzer, got nil")
	}
}
