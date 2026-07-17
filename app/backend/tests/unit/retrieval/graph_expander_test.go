package retrieval_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

func TestNewGraphExpander(t *testing.T) {
	ge := retrieval.NewGraphExpander(nil)
	if ge == nil {
		t.Fatal("expected graph expander, got nil")
	}
}

func TestGraphExpanderExpand_NoSeeds(t *testing.T) {
	// With no seeds set (SetSeeds not called, or called with an empty slice),
	// Expand must return nil safely without touching the (possibly nil)
	// Neo4j driver.
	ge := retrieval.NewGraphExpander(nil)
	results := ge.Expand(context.Background(), nil)
	if results != nil {
		t.Errorf("expected nil results with no seeds, got %v", results)
	}
}

func TestGraphExpanderSetSeeds(t *testing.T) {
	ge := retrieval.NewGraphExpander(nil)
	ge.SetSeeds([]retrieval.RecognizedEntity{{ID: "1", Type: "Person", Name: "Alice"}})
	// With seeds set but a nil driver, Expand would panic on session creation
	// if it tried to reach Neo4j — asserting SetSeeds itself doesn't panic is
	// the safe unit-level check here; full BFS behavior is covered by the
	// integration test (tests/integration/graph).
}
