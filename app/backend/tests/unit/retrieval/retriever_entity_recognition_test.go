package retrieval_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// mockEntityRecognizer returns hardcoded recognized entities (for testing without Neo4j).
type mockEntityRecognizer struct {
	entities []retrieval.RecognizedEntity
}

func (m *mockEntityRecognizer) RecognizeEntities(ctx context.Context, query string) ([]retrieval.RecognizedEntity, error) {
	return m.entities, nil
}

// mockReranker returns results unchanged.
type mockReranker struct{}

func (m *mockReranker) Rank(ctx context.Context, results []map[string]interface{}) []map[string]interface{} {
	return results
}

// mockContextPacker returns a single result as-is.
type mockContextPacker struct{}

func (m *mockContextPacker) Pack(ctx context.Context, results []map[string]interface{}, tokenBudget int) []map[string]interface{} {
	if len(results) == 0 {
		return results
	}
	return results[:1] // Just return the first result
}

// mockAnswerGenerator returns a canned answer and empty sources.
type mockAnswerGenerator struct{}

func (m *mockAnswerGenerator) Generate(ctx context.Context, query string, packed []map[string]interface{}) (string, []interface{}) {
	return "test answer", []interface{}{}
}

// TestRetrieverReturnsEntitiesWithoutDocumentAccess ensures that entity
// recognition runs and returns results even when the user has no document
// permissions (empty allowedFiles). This validates the fix for T3.2 integration
// test failure (REQ-205 Phase 3).
func TestRetrieverReturnsEntitiesWithoutDocumentAccess(t *testing.T) {
	ctx := context.Background()
	db := &sql.DB{} // mock DB

	// Create mocks for all stages. In a real test, these would be real implementations
	// (e.g., against live Neo4j), but for unit testing the fix to entity recognition,
	// we just need to verify that the Retriever calls entity recognition even with
	// empty allowedFiles from the permission filter.

	// Mock permission filter that returns empty allowedFiles (user has no document access).
	permFilter := retrieval.NewPermissionFilter(db) // Will return [] since DB is empty

	// Mock entity recognizer that returns a test entity.
	recognizer := retrieval.NewQueryEntityRecognizerWithProvider(&mockQueryEntityRecognizer{
		entities: []retrieval.RecognizedEntity{
			{ID: "proj1", Type: "Project", Name: "TestProject"},
		},
	})

	// Create retriever using the proper constructor.
	retriever := retrieval.NewRetriever(
		db,
		permFilter,
		retrieval.NewIntentDetector(),
		recognizer,
		nil, // SemanticSearch (will be skipped with empty allowedFiles)
		nil, // GraphExpander (not needed for this test)
		&mockReranker{},
		&mockContextPacker{},
		&mockAnswerGenerator{},
	)

	resp, err := retriever.Query(ctx, retrieval.QueryRequest{
		Query:  "What is TestProject?",
		UserID: "test-user-no-docs",
	})
	if err != nil {
		t.Fatalf("retriever.Query failed: %v", err)
	}

	// The key assertion: even though the user has no document permissions,
	// entities should be returned from Stage 2 entity recognition.
	if len(resp.Entities) == 0 {
		t.Error("expected entities to be returned even without document access, got empty list")
	}
	foundProject := false
	for _, e := range resp.Entities {
		if m, ok := e.(map[string]interface{}); ok && m["name"] == "TestProject" {
			foundProject = true
			break
		}
	}
	if !foundProject {
		t.Errorf("expected Stage 2 to recognize TestProject, got %v", resp.Entities)
	}
}

// mockQueryEntityRecognizer implements the EntityRecognitionProvider interface
// for testing without requiring a real Neo4j connection.
type mockQueryEntityRecognizer struct {
	entities []retrieval.RecognizedEntity
}

func (m *mockQueryEntityRecognizer) RecognizeEntities(ctx context.Context, query string) ([]retrieval.RecognizedEntity, error) {
	return m.entities, nil
}
