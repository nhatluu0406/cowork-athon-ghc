package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rad-system/m365-knowledge-graph/internal/graph"
)

// HandleGraphNodes wires GET /api/graph/nodes to real Neo4j entity queries
// (tasks.md T185). Optional query params: `label` (node label filter),
// `limit` (default 100, max 1000).
func HandleGraphNodes(qb *graph.QueryBuilder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		label := r.URL.Query().Get("label")
		limit := parseLimit(r, 100)

		nodes, err := qb.ListNodes(r.Context(), label, limit)
		if err != nil {
			http.Error(w, "failed to query nodes: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if nodes == nil {
			nodes = []map[string]interface{}{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(nodes)
	}
}

// HandleGraphEdges wires GET /api/graph/edges to real Neo4j relationship
// queries (tasks.md T185). Optional query params: `type` (relationship type
// filter), `limit` (default 100, max 1000).
func HandleGraphEdges(qb *graph.QueryBuilder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		relType := r.URL.Query().Get("type")
		limit := parseLimit(r, 100)

		edges, err := qb.ListEdges(r.Context(), relType, limit)
		if err != nil {
			http.Error(w, "failed to query edges: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if edges == nil {
			edges = []map[string]interface{}{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(edges)
	}
}

// HandleGraphPath wires GET /api/graph/path?from=<id>&to=<id> to a real
// Neo4j shortest-path query (tasks.md T185). Optional `max_depth` (default 2,
// clamped 1-3 by QueryBuilder.FindPath).
func HandleGraphPath(qb *graph.QueryBuilder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		from := r.URL.Query().Get("from")
		to := r.URL.Query().Get("to")
		if from == "" || to == "" {
			http.Error(w, "both 'from' and 'to' query params are required", http.StatusBadRequest)
			return
		}

		maxDepth := 2
		if v := r.URL.Query().Get("max_depth"); v != "" {
			if d, err := strconv.Atoi(v); err == nil {
				maxDepth = d
			}
		}

		path, err := qb.FindPath(r.Context(), from, to, maxDepth)
		if err != nil {
			http.Error(w, "failed to query path: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := map[string]interface{}{
			"paths": []interface{}{},
		}
		if len(path) > 0 {
			resp["paths"] = []interface{}{path}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// HandleStatsOverview wires GET /api/stats/overview to real counts (tasks.md
// T185): documents/chunks/recent_queries from PostgreSQL, entities/
// relationships from Neo4j.
func HandleStatsOverview(qb *graph.QueryBuilder, db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		ctx := r.Context()

		var documents, recentQueries int64
		if db != nil {
			_ = db.QueryRowContext(ctx, `SELECT count(*) FROM m365_files`).Scan(&documents)
			_ = db.QueryRowContext(ctx, `SELECT count(*) FROM query_logs WHERE created_at > now() - interval '24 hours'`).Scan(&recentQueries)
		}

		var entities, relationships int64
		var err error
		if qb != nil {
			entities, err = qb.CountAllNodes(ctx)
			if err != nil {
				http.Error(w, "failed to query entity count: "+err.Error(), http.StatusInternalServerError)
				return
			}

			relationships, err = qb.GetRelationshipCount(ctx)
			if err != nil {
				http.Error(w, "failed to query relationship count: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		resp := map[string]interface{}{
			"documents":      documents,
			"entities":       entities,
			"relationships":  relationships,
			"recent_queries": recentQueries,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func parseLimit(r *http.Request, def int) int {
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
