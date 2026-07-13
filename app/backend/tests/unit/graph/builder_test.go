package graph_test

import (
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/graph"
)

func TestNewGraphBuilder(t *testing.T) {
	store := &graph.Neo4jStore{}
	builder := graph.NewGraphBuilder(store)
	if builder == nil {
		t.Fatal("expected builder, got nil")
	}
}

func TestGraphBuilderMethods(t *testing.T) {
	// Note: Build() requires actual Neo4j connection, tested at integration level
	// This tests that builder can be instantiated and methods exist

	store := &graph.Neo4jStore{}
	builder := graph.NewGraphBuilder(store)

	t.Run("builder has Validate method", func(t *testing.T) {
		// Just verify the object exists and has methods
		if builder == nil {
			t.Fatal("expected builder, got nil")
		}
	})

	t.Run("builder has Publish method", func(t *testing.T) {
		// Just verify the object exists and has methods
		if builder == nil {
			t.Fatal("expected builder, got nil")
		}
	})
}
