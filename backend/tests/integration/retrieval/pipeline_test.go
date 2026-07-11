// +build integration

package retrieval

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// fixedEmbedder returns the same vector for every text — deterministic
// cosine similarity makes assertions exact instead of flaky.
type fixedEmbedder struct{ vec []float32 }

func (f fixedEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = f.vec
	}
	return out, nil
}

// fakeLLM captures the prompt it was called with so tests can assert the
// real context assembled by upstream stages (semantic search, graph
// expansion, context packing) actually reached the "LLM" — not just that a
// canned string echoed back unconditionally.
type fakeLLM struct {
	response       string
	capturedPrompt *string
}

func (f fakeLLM) Complete(ctx context.Context, prompt string) (string, error) {
	if f.capturedPrompt != nil {
		*f.capturedPrompt = prompt
	}
	return f.response, nil
}

// searchAdapter bridges embedding.Store's ScoredChunk to retrieval's
// ScoredChunkResult (same shape, distinct named types across packages —
// mirrors cmd/routes.go's similaritySearcherAdapter for test purposes).
type searchAdapter struct{ store *embedding.Store }

func (a searchAdapter) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error) {
	results, err := a.store.SearchSimilar(ctx, modelID, queryVec, topK)
	if err != nil {
		return nil, err
	}
	out := make([]retrieval.ScoredChunkResult, len(results))
	for i, r := range results {
		out[i] = retrieval.ScoredChunkResult{ChunkID: r.ChunkID, Score: r.Score}
	}
	return out, nil
}

// TestFullExtractionGraphQueryFlow (T063): validates the real 8-stage
// pipeline end-to-end against live PostgreSQL + Neo4j — semantic search
// finds a seeded chunk, query NER recognizes a seeded graph entity, graph
// expansion finds its relationship, and the answer generator (a fake LLM
// here, to avoid a network dependency in CI) produces a non-empty answer.
func TestFullExtractionGraphQueryFlow(t *testing.T) {
	marker := fmt.Sprintf("t063-%d", time.Now().UnixNano())
	db := setupTestDB(t)
	defer db.Close()
	neoDriver := setupTestNeo4j(t)
	defer neoDriver.Close(context.Background())
	defer cleanupTestFixtures(t, db, marker)

	ctx := context.Background()

	// --- Seed PostgreSQL: file, chunk, permission, embedding ---
	var fileID, chunkID int64
	err := db.QueryRowContext(ctx,
		`INSERT INTO m365_files (source_type, source_id, file_name, file_type, last_modified)
		 VALUES ('onedrive', $1, 'projectx.docx', 'docx', now()) RETURNING id`,
		marker+"-file").Scan(&fileID)
	if err != nil {
		t.Fatalf("insert m365_files: %v", err)
	}

	err = db.QueryRowContext(ctx,
		`INSERT INTO chunks (file_id, chunk_index, text, content_hash)
		 VALUES ($1, 0, $2, $3) RETURNING id`,
		fileID, marker+" Alice leads ProjectX using Go.", marker+"-chunk").Scan(&chunkID)
	if err != nil {
		t.Fatalf("insert chunks: %v", err)
	}

	testUser := marker + "-user"
	if _, err := db.ExecContext(ctx,
		`INSERT INTO permission_cache (user_id, file_id, permission) VALUES ($1, $2, 'read')`,
		testUser, fileID); err != nil {
		t.Fatalf("insert permission_cache: %v", err)
	}

	embedStore := embedding.NewStore(db)
	modelID, err := embedStore.EnsureModel(ctx, "test-model", marker, 8)
	if err != nil {
		t.Fatalf("EnsureModel: %v", err)
	}
	fixedVec := []float32{1, 0, 0, 0, 0, 0, 0, 0}
	if err := embedStore.SaveEmbedding(ctx, chunkID, modelID, fixedVec); err != nil {
		t.Fatalf("SaveEmbedding: %v", err)
	}

	// --- Seed Neo4j: Person -[:OWNS]-> Project, uniquely named per marker ---
	personName := marker + "-Alice"
	projectName := marker + "-ProjectX"
	session := neoDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	_, err = session.Run(ctx, `
		MERGE (p:Person {displayName: $person})
		MERGE (proj:Project {name: $project})
		MERGE (p)-[:OWNS]->(proj)
	`, map[string]interface{}{"person": personName, "project": projectName})
	session.Close(ctx)
	if err != nil {
		t.Fatalf("seed Neo4j: %v", err)
	}
	defer func() {
		s := neoDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
		s.Run(ctx, `MATCH (n) WHERE n.displayName = $person OR n.name = $project DETACH DELETE n`,
			map[string]interface{}{"person": personName, "project": projectName})
		s.Close(ctx)
	}()

	// --- Build the real pipeline ---
	var capturedPrompt string
	retriever := retrieval.NewRetriever(
		db,
		retrieval.NewPermissionFilter(db),
		retrieval.NewIntentDetector(),
		retrieval.NewQueryEntityRecognizer(neoDriver),
		retrieval.NewSemanticSearch(db, fixedEmbedder{vec: fixedVec}, searchAdapter{store: embedStore}, modelID),
		retrieval.NewGraphExpander(neoDriver),
		retrieval.NewReranker(),
		retrieval.NewContextPacker(),
		retrieval.NewAnswerGenerator(fakeLLM{response: "canned answer", capturedPrompt: &capturedPrompt}),
	)

	// The query text mentions ONLY the project — Stage 2 (query NER) matches
	// entities whose name literally appears in the query, so it should
	// recognize ProjectX but NOT Alice (Alice is reachable only via Stage 3
	// graph expansion from ProjectX, which surfaces in the packed context,
	// not in QueryResponse.Entities — see retriever.go's Query method).
	resp, err := retriever.Query(ctx, retrieval.QueryRequest{
		Query:  "Who leads " + projectName + "?",
		UserID: testUser,
	})
	if err != nil {
		t.Fatalf("retriever.Query failed: %v", err)
	}

	if resp.Intent != "find_expert" {
		t.Errorf("expected intent 'find_expert' for a 'who' question, got %q", resp.Intent)
	}
	if resp.Answer == "" {
		t.Error("expected non-empty answer")
	}
	if len(resp.Sources) == 0 {
		t.Error("expected at least one cited source from the seeded chunk")
	}
	if len(resp.Entities) == 0 {
		t.Error("expected at least one recognized entity from Stage 2 NER")
	}
	foundProject := false
	for _, e := range resp.Entities {
		if m, ok := e.(map[string]interface{}); ok && m["name"] == projectName {
			foundProject = true
		}
	}
	if !foundProject {
		t.Errorf("expected Stage 2 to recognize %q (the entity actually named in the query), got %v", projectName, resp.Entities)
	}
	if resp.LatencyMs < 0 {
		t.Errorf("expected non-negative latency, got %d", resp.LatencyMs)
	}

	// The real, rigorous check: did the actual chunk text seeded above
	// (found via real cosine-similarity semantic search, real permission
	// filtering, and real context packing) reach the LLM prompt? This
	// verifies the whole non-mock pipeline's data flow, not just that a
	// canned string was echoed back.
	if !strings.Contains(capturedPrompt, "Alice leads ProjectX using Go.") {
		t.Errorf("expected LLM prompt to contain the seeded chunk text via real semantic search + context packing, got prompt: %q", capturedPrompt)
	}

	// Direct Stage-3 verification: graph expansion from the Stage-2-recognized
	// ProjectX entity should reach Alice via the seeded OWNS relationship.
	recognizer := retrieval.NewQueryEntityRecognizer(neoDriver)
	recognized, err := recognizer.Recognize(ctx, projectName)
	if err != nil {
		t.Fatalf("Recognize: %v", err)
	}
	expander := retrieval.NewGraphExpander(neoDriver)
	expander.SetSeeds(recognized)
	expanded := expander.Expand(ctx, nil)
	foundPersonViaGraph := false
	for _, r := range expanded {
		if r["name"] == personName {
			foundPersonViaGraph = true
		}
	}
	if !foundPersonViaGraph {
		t.Errorf("expected Stage 3 graph expansion from %q to reach %q via OWNS, got %v", projectName, personName, expanded)
	}
}
