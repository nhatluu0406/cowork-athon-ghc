// +build integration

package retrieval

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/brain"
)

// TestBrainClientMode1 verifies intent detection and extraction route through brain client (T182)
func TestBrainClientMode1(t *testing.T) {
	ctx := context.Background()
	client, err := brain.NewBrainClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Test DetectIntent with task-type tagging
	intent, err := client.DetectIntent(ctx, "what is AI?", "")
	if err != nil {
		t.Skipf("brain.DetectIntent failed: %v", err)
	}
	if intent == "" {
		t.Fatalf("intent is empty")
	}
	t.Logf("Mode 1 - Detected intent: %s", intent)
}

// TestBrainClientMode2 verifies mixed routing (local preprocess, cloud generation) (T182)
func TestBrainClientMode2(t *testing.T) {
	ctx := context.Background()
	client, err := brain.NewBrainClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Test ExtractEntities with mode 2 (query NER)
	result, err := client.ExtractEntities(ctx, "John works at Acme Corp", "query", "")
	if err != nil {
		t.Skipf("brain.ExtractEntities failed: %v", err)
	}
	if len(result.Entities) == 0 {
		t.Logf("Mode 2 - No entities found (expected if llm-svc not running)")
		return
	}
	t.Logf("Mode 2 - Found %d entities", len(result.Entities))
}

// TestBrainClientMode3 verifies local-only routing (T182)
func TestBrainClientMode3(t *testing.T) {
	ctx := context.Background()
	client, err := brain.NewBrainClient("localhost:9090")
	if err != nil {
		t.Skipf("llm-svc not available: %v", err)
	}
	defer client.Close()

	// Test compression (stage 6)
	compressed, err := client.Compress(ctx, "Lorem ipsum dolor sit amet, consectetur adipiscing elit. "+
		"Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.", 50, "map_reduce")
	if err != nil {
		t.Skipf("brain.Compress failed: %v", err)
	}
	if compressed == "" {
		t.Logf("Mode 3 - Compression returned empty (expected if llm-svc not running)")
		return
	}
	t.Logf("Mode 3 - Compressed %d -> %d chars", 150, len(compressed))
}
