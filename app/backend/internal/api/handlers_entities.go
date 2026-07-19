package api

import (
	"encoding/json"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

type ExtractEntitiesRequest struct {
	ChunkID int64  `json:"chunk_id"`
	Text    string `json:"text,omitempty"`
	FileID  string `json:"file_id,omitempty"`
	Mode    string `json:"mode,omitempty"`
}

type ExtractEntitiesResponse struct {
	Status            string        `json:"status"`
	ChunkID           int64         `json:"chunk_id"`
	Entities          []interface{} `json:"entities,omitempty"`
	RelationshipCount int           `json:"relationship_count,omitempty"`
	ExtractionMs      int           `json:"extraction_ms,omitempty"`
	TaskID            string        `json:"task_id,omitempty"`
}

// HandleEntitiesExtract handles POST /api/entities/extract for entity extraction
func HandleEntitiesExtract(deps *EntityExtractDeps, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		_, ok := requireUserID(w, r, jwtAuth)
		if !ok {
			return
		}

		var req ExtractEntitiesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.ChunkID <= 0 {
			http.Error(w, "chunk_id is required and must be > 0", http.StatusBadRequest)
			return
		}

		// Queue the extraction task
		if deps != nil && deps.ExtractionQueue != nil {
			deps.ExtractionQueue <- ExtractionTask{
				DocumentID: req.FileID,
				Content:    req.Text,
				Source:     "direct",
			}
		}

		resp := ExtractEntitiesResponse{
			Status:  "queued",
			ChunkID: req.ChunkID,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// HandleEntities lists entities
func HandleEntities(queryBuilder interface{}, permFilter interface{}, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		_, ok := requireUserID(w, r, jwtAuth)
		if !ok {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	}
}

// HandleEntityDetail gets entity details
func HandleEntityDetail(queryBuilder interface{}, jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		_, ok := requireUserID(w, r, jwtAuth)
		if !ok {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":   "entity-1",
			"type": "Entity",
		})
	}
}
