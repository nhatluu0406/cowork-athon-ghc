package main

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
	"github.com/rad-system/m365-knowledge-graph/internal/graph"
	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/rad-system/m365-knowledge-graph/internal/nlp"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
	"github.com/rad-system/m365-knowledge-graph/internal/websocket"
)

// similaritySearcherAdapter adapts *embedding.Store (which returns
// []embedding.ScoredChunk) to retrieval.SimilaritySearcher (which expects
// []retrieval.ScoredChunkResult) — the two packages declare structurally
// identical but distinctly-named result types, so a value-level adapter is
// needed since Go doesn't implicitly convert named slice element types.
type similaritySearcherAdapter struct {
	store *embedding.Store
}

func (a similaritySearcherAdapter) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error) {
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

// registerRoutes mounts every handler group listed in
// specs/REQ-204-M365-001-m365-knowledge-graph/spec.md §13 onto the router.
//
// As of the 2026-07-11 Phase 10 remediation (tasks.md Group J, T184-T187),
// every handler below calls real backend logic — auth (Entra ID OIDC +
// JWT), Neo4j graph/entity queries with Stage-0 permission filtering, and
// M365 connection persistence/connector triggering. /api/knowledge/query
// was wired to the real Retriever earlier (Group D remediation).
func registerRoutes(router *api.Router, hub *websocket.Hub, feedbackStore *feedback.FeedbackStore, feedbackAnalyzer *feedback.FeedbackAnalyzer, retriever *retrieval.Retriever, entraAuth *auth.EntraIDAuth, jwtAuth *auth.JWTAuth, oauthRedirectURI, devUsername, devPassword string, queryBuilder *graph.QueryBuilder, statsDB *sql.DB, permFilter *retrieval.PermissionFilter, m365Deps *api.M365Deps, localImportDeps *localimport.LocalImportDeps, entityExtractDeps *api.EntityExtractDeps, extractor *nlp.Extractor, graphBuilder *graph.GraphBuilder) {
	// Health check
	router.Register("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Auth
	router.Register("/api/auth/login", api.HandleLogin(entraAuth, jwtAuth, oauthRedirectURI, devUsername, devPassword))
	router.Register("/api/auth/token/refresh", api.HandleRefreshToken(jwtAuth))

	// M365 connectors (T037-T040)
	// T037: POST /api/m365/connect — configure M365 connection
	// T040: GET /api/m365/sources — list connected M365 sources
	// T038: POST /api/m365/sync — trigger sync, returns 202 + WebSocket progress
	// T039: GET /api/m365/sync/status — get sync state for all sources
	m365Deps.Hub = hub // wire the WebSocket hub for sync progress broadcasts (T038)
	router.Register("/api/m365/connect", api.HandleM365Connect(m365Deps))
	router.Register("/api/m365/sources", api.HandleM365Sources(m365Deps))
	router.Register("/api/m365/sync", api.HandleM365Sync(m365Deps))
	router.Register("/api/m365/sync/status", api.HandleM365SyncStatus(m365Deps))

	// Local folder import (Phase 3 — US1)
	localImportHandler := localimport.NewLocalImportHandler(localImportDeps)
	router.Register("/api/local/sources", localImportHandler)
	router.Register("/api/local/sources/", localImportHandler)
	router.Register("/api/local/sync", localImportHandler)
	router.Register("/api/local/jobs", localImportHandler)
	router.Register("/api/local/jobs/", localImportHandler)

	// LLM config (dynamic configuration from service/src/provider)
	router.Register("/api/llm/config", api.HandleLLMConfig(statsDB, jwtAuth))         // POST: update config
	router.Register("/api/llm/config/current", api.HandleLLMConfigGet(statsDB, jwtAuth)) // GET: retrieve current config

	// Knowledge / Q&A + entities
	router.Register("/api/knowledge/query", api.HandleKnowledgeQuery(retriever, jwtAuth))
	router.Register("/api/entities", api.HandleEntities(queryBuilder, permFilter, jwtAuth))
	router.Register("/api/entities/", api.HandleEntityDetail(queryBuilder, jwtAuth))

	// Entity extraction (T056): POST /api/entities/extract to trigger NLP extraction
	if entityExtractDeps == nil {
		entityExtractDeps = &api.EntityExtractDeps{
			DB:              statsDB,
			Extractor:       extractor,
			GraphBuilder:    graphBuilder,
			Hub:             hub,
			ExtractionQueue: make(chan api.ExtractionTask, 100),
		}
	}
	router.Register("/api/entities/extract", api.HandleEntitiesExtract(entityExtractDeps, jwtAuth))

	// Graph
	router.Register("/api/graph/nodes", api.HandleGraphNodes(queryBuilder, permFilter, jwtAuth))
	router.Register("/api/graph/edges", api.HandleGraphEdges(queryBuilder, permFilter, jwtAuth))
	router.Register("/api/graph/path", api.HandleGraphPath(queryBuilder, jwtAuth))

	// Stats
	router.Register("/api/stats/overview", api.HandleStatsOverview(queryBuilder, statsDB))

	// Feedback (real store/analyzer wiring — Phase 4 code is solid, only
	// needed to be reachable per Group E remediation)
	router.Register("/api/feedback", api.HandleFeedback(feedbackStore))
	router.Register("/api/feedback/stats", api.HandleFeedbackStats(feedbackAnalyzer))

	// WebSocket
	router.Register("/ws", hub.ServeWS)
}
