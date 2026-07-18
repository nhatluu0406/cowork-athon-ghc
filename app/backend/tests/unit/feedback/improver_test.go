package feedback_test

import (
	"database/sql"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

func TestNewImprover(t *testing.T) {
	db := &sql.DB{}
	improver := feedback.NewImprover(db)
	if improver == nil {
		t.Fatal("expected improver, got nil")
	}
}
