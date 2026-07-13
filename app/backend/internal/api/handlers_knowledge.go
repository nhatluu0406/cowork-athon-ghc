package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/graph"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

type KnowledgeQueryRequest struct {
	Query string `json:"query"`
	Lang  string `json:"lang,omitempty"`
}

type KnowledgeQueryResponse struct {
	Answer    string        `json:"answer"`
	Sources   []interface{} `json:"sources,omitempty"`
	Entities  []interface{} `json:"entities,omitempty"`
	Intent    string        `json:"intent"`
	LatencyMs int           `json:"latency_ms"`
}

// HandleKnowledgeQuery wires the real 8-stage Retriever (tasks.md Group D)
// into the /api/knowledge/query endpoint. UserID is the verified subject of
// the caller's JWT (Authorization: Bearer <token>) — never a client-supplied
// header, which would let any caller impersonate any user for Stage-0
// permission filtering.
func HandleKnowledgeQuery(retriever *retrieval.Retriever, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := requireUserID(w, r, jwtAuth)
		if !ok {
			return
		}

		var req KnowledgeQueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		result, err := retriever.Query(r.Context(), retrieval.QueryRequest{Query: req.Query, UserID: userID})
		if err != nil {
			http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := KnowledgeQueryResponse{
			Answer:    result.Answer,
			Sources:   result.Sources,
			Entities:  result.Entities,
			Intent:    result.Intent,
			LatencyMs: result.LatencyMs,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// HandleEntities wires GET /api/entities to real Neo4j entity queries with
// Stage-0 permission-scope filtering (tasks.md T186). Optional query params:
// `type` (entity/node label filter), `limit` (default 100, max 1000). UserID
// is the verified subject of the caller's JWT (see HandleKnowledgeQuery).
func HandleEntities(qb *graph.QueryBuilder, permFilter *retrieval.PermissionFilter, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := requireUserID(w, r, jwtAuth)
		if !ok {
			return
		}

		entityType := r.URL.Query().Get("type")
		limit := 100
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}

		// Stage-0 permission filtering per INVARIANT-1: resolve the file IDs
		// this user is allowed to see before touching the graph.
		allowedFileIDs, err := permFilter.Filter(r.Context(), userID)
		if err != nil {
			http.Error(w, "permission filter failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if allowedFileIDs == nil {
			// nil slice from Filter means "zero rows" (not "scoping
			// disabled") — treat as an explicit empty allow-list so
			// ListEntities returns [] rather than unscoped results.
			allowedFileIDs = []int{}
		}

		entities, err := qb.ListEntities(r.Context(), entityType, allowedFileIDs, limit)
		if err != nil {
			http.Error(w, "failed to query entities: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if entities == nil {
			entities = []map[string]interface{}{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(entities)
	}
}

// HandleEntityDetail wires GET /api/entities/{id} to a real Neo4j entity +
// neighbor query (tasks.md T186). The entity ID is taken from the last path
// segment (router mounts this at the "/api/entities/" prefix). Requires a
// valid caller JWT; unlike HandleEntities/ListEntities, this endpoint does
// not yet scope the returned entity/neighbors by allowedFileIDs (a
// single-entity lookup by ID, so that scoping needs to be added to
// GetEntityByID/GetNeighbors as a follow-up) — authentication is the
// interim mitigation so the endpoint is at least not fully open.
func HandleEntityDetail(qb *graph.QueryBuilder, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if _, ok := requireUserID(w, r, jwtAuth); !ok {
			return
		}

		entityID := entityIDFromPath(r.URL.Path)
		if entityID == "" {
			http.Error(w, "entity id is required", http.StatusBadRequest)
			return
		}

		detail, err := qb.GetEntityByID(r.Context(), entityID)
		if err != nil {
			http.Error(w, "failed to query entity: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if detail == nil {
			http.Error(w, "entity not found", http.StatusNotFound)
			return
		}

		neighbors, err := qb.GetNeighbors(r.Context(), entityID, 1)
		if err != nil {
			http.Error(w, "failed to query relationships: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if neighbors == nil {
			neighbors = []map[string]interface{}{}
		}

		resp := map[string]interface{}{
			"id":            detail.ID,
			"type":          detail.Type,
			"properties":    detail.Props,
			"relationships": neighbors,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// entityIDFromPath extracts the trailing path segment, e.g.
// "/api/entities/42" -> "42".
func entityIDFromPath(path string) string {
	for len(path) > 0 && path[len(path)-1] == '/' {
		path = path[:len(path)-1]
	}
	idx := -1
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ""
	}
	segment := path[idx+1:]
	if segment == "entities" {
		return ""
	}
	return segment
}
