package api

import (
	"encoding/json"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
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
