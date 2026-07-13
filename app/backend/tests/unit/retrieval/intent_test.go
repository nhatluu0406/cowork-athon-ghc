package retrieval_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

func TestNewIntentDetector(t *testing.T) {
	id := retrieval.NewIntentDetector()
	if id == nil {
		t.Fatal("expected intent detector, got nil")
	}
}

func TestIntentDetectorDetect(t *testing.T) {
	tt := []struct {
		name     string
		query    string
		expected string
	}{
		{"expert question", "who is the lead", "find_expert"},
		{"document question", "find the document", "find_document"},
		{"project question", "project status", "find_project_info"},
		{"general question", "what is 2+2", "general_question"},
	}

	id := retrieval.NewIntentDetector()
	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			intent := id.Detect(context.Background(), tc.query)
			if intent != tc.expected {
				t.Errorf("expected %s, got %s", tc.expected, intent)
			}
		})
	}
}
