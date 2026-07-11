package feedback_test

import (
	"database/sql"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
)

func TestNewFeedbackStore(t *testing.T) {
	db := &sql.DB{}
	store := feedback.NewFeedbackStore(db)
	if store == nil {
		t.Fatal("expected store, got nil")
	}
}

// Feedback constants test — validate the types exist
func TestFeedbackTypes(t *testing.T) {
	tt := []struct {
		name  string
		ftype feedback.FeedbackType
	}{
		{"like", feedback.FeedbackLike},
		{"dislike", feedback.FeedbackDislike},
		{"flag", feedback.FeedbackFlag},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			if tc.ftype == "" {
				t.Error("expected non-empty FeedbackType")
			}
		})
	}
}
