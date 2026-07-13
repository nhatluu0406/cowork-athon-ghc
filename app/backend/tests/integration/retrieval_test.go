//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// TestRetrievalPipelineIntegration validates that retrieval stages wire together correctly
func TestRetrievalPipelineIntegration(t *testing.T) {
	ctx := context.Background()

	// Test intent detector stage
	intents := retrieval.NewIntentDetector()
	if intents == nil {
		t.Fatal("expected IntentDetector, got nil")
	}

	// Test that stages can be sequenced (contract check, not end-to-end execution)
	query := "who is the project lead"
	intent := intents.Detect(ctx, query)
	if intent == "" {
		t.Fatal("expected non-empty intent")
	}

	t.Logf("detected intent: %s", intent)

	// Full integration would require live LanceDB, Neo4j for graph expansion, live reranker
	// This test validates wiring/construction, not behavioral guarantees with real data
}
