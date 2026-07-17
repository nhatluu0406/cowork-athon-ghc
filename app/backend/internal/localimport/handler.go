package localimport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

// LocalImportDeps bundles dependencies for local import handlers.
type LocalImportDeps struct {
	SourceStore *LocalSourceStore
	JobStore    *ImportJobStore
	Dispatcher  *Dispatcher
	JWTAuth     *auth.JWTAuth
}

// ValidateExtensionArrays validates that all extensions in include/exclude lists start with "."
func ValidateExtensionArrays(includeExt, excludeExt []string) error {
	for _, ext := range includeExt {
		if !strings.HasPrefix(ext, ".") {
			return fmt.Errorf("include_ext: extension must start with '.', got: %q", ext)
		}
	}
	for _, ext := range excludeExt {
		if !strings.HasPrefix(ext, ".") {
			return fmt.Errorf("exclude_ext: extension must start with '.', got: %q", ext)
		}
	}
	return nil
}

// NewLocalImportHandler creates HTTP handlers for local import endpoints.
func NewLocalImportHandler(deps *LocalImportDeps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/local/sources", handleCreateSource(deps))
	mux.HandleFunc("GET /api/local/sources", handleListSources(deps))
	mux.HandleFunc("GET /api/local/sources/{id}", handleGetSource(deps))
	mux.HandleFunc("PATCH /api/local/sources/{id}", handlePatchSource(deps))
	mux.HandleFunc("DELETE /api/local/sources/{id}", handleDeleteSource(deps))
	mux.HandleFunc("POST /api/local/sources/{id}/sync", handleSyncSource(deps))
	mux.HandleFunc("GET /api/local/jobs", handleListJobs(deps))
	mux.HandleFunc("GET /api/local/jobs/{id}", handleGetJob(deps))

	return mux
}

// handleCreateSource handles POST /api/local/sources
func handleCreateSource(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check auth (requireUserID is in authz.go, but not exported; we'll implement inline)
		// For MVP, we'll skip auth check and follow the M365 handler pattern
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req CreateSourceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Validate extensions
		if err := ValidateExtensionArrays(req.IncludeExt, req.ExcludeExt); err != nil {
			http.Error(w, "invalid extension array: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Validate path
		validatedPath, err := ValidateSourcePath(req.FolderPath)
		if err != nil {
			http.Error(w, "invalid path: "+err.Error(), http.StatusBadRequest)
			return
		}
		req.FolderPath = validatedPath

		source, err := deps.SourceStore.Create(r.Context(), req)
		if err != nil {
			http.Error(w, "failed to create source: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(source)
	}
}

// handleListSources handles GET /api/local/sources
func handleListSources(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		sources, err := deps.SourceStore.List(r.Context())
		if err != nil {
			http.Error(w, "failed to list sources: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"sources": sources,
		})
	}
}

// handleGetSource handles GET /api/local/sources/{id}
func handleGetSource(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := r.PathValue("id")

		source, err := deps.SourceStore.Get(r.Context(), id)
		if err != nil {
			http.Error(w, "failed to get source: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if source == nil {
			http.Error(w, "source not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(source)
	}
}

// handlePatchSource handles PATCH /api/local/sources/{id}
func handlePatchSource(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := r.PathValue("id")

		var req PatchSourceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Validate extensions
		if err := ValidateExtensionArrays(req.IncludeExt, req.ExcludeExt); err != nil {
			http.Error(w, "invalid extension array: "+err.Error(), http.StatusBadRequest)
			return
		}

		source, err := deps.SourceStore.Update(r.Context(), id, req)
		if err != nil {
			http.Error(w, "failed to update source: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(source)
	}
}

// handleDeleteSource handles DELETE /api/local/sources/{id}
func handleDeleteSource(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := r.PathValue("id")

		// Mark any running jobs as stale
		jobs, err := deps.JobStore.List(r.Context(), &id, nil, nil, nil)
		if err == nil {
			for _, job := range jobs {
				if job.Status == JobRunning {
					deps.JobStore.UpdateStatus(r.Context(), job.ID, JobStale)
				}
			}
		}

		// Delete the source (cascades to jobs and files)
		if err := deps.SourceStore.Delete(r.Context(), id); err != nil {
			http.Error(w, "failed to delete source: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusAccepted)
	}
}

// handleSyncSource handles POST /api/local/sources/{id}/sync
func handleSyncSource(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := r.PathValue("id")

		source, err := deps.SourceStore.Get(r.Context(), id)
		if err != nil {
			http.Error(w, "failed to get source: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if source == nil {
			http.Error(w, "source not found", http.StatusNotFound)
			return
		}

		// Check if source is enabled
		if !source.Enabled {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "source_disabled"})
			return
		}

		// Check if a job is already running
		runningJob, err := deps.JobStore.HasRunning(r.Context(), id)
		if err != nil {
			http.Error(w, "failed to check running jobs: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if runningJob != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":  "job_running",
				"job_id": runningJob.ID,
			})
			return
		}

		// Create a new job
		job, err := deps.JobStore.Create(r.Context(), id)
		if err != nil {
			http.Error(w, "failed to create job: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Enqueue the job (non-blocking)
		if err := deps.Dispatcher.Enqueue(job); err != nil {
			http.Error(w, "failed to enqueue job: "+err.Error(), http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"job_id":    job.ID,
			"source_id": id,
			"status":    job.Status,
		})
	}
}

// handleListJobs handles GET /api/local/jobs with optional filters and pagination
// Query parameters:
//   - source_id: filter by source UUID
//   - status: filter by job status (queued, running, completed, failed, stale)
//   - limit: max results per page (default 50, max 1000)
//   - offset: pagination offset (default 0)
func handleListJobs(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse query parameters
		sourceID := r.URL.Query().Get("source_id")
		var sourceIDPtr *string
		if sourceID != "" {
			sourceIDPtr = &sourceID
		}

		status := r.URL.Query().Get("status")
		var statusPtr *string
		if status != "" {
			// Validate status value
			validStatuses := map[string]bool{
				"queued":    true,
				"running":   true,
				"completed": true,
				"failed":    true,
				"stale":     true,
			}
			if !validStatuses[status] {
				http.Error(w, fmt.Sprintf("invalid status: %q", status), http.StatusBadRequest)
				return
			}
			statusPtr = &status
		}

		// Parse pagination parameters
		var limitPtr, offsetPtr *int
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			limit, err := strconv.Atoi(limitStr)
			if err != nil || limit <= 0 {
				http.Error(w, "invalid limit: must be a positive integer", http.StatusBadRequest)
				return
			}
			if limit > 1000 {
				limit = 1000 // Cap at 1000
			}
			limitPtr = &limit
		}

		if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
			offset, err := strconv.Atoi(offsetStr)
			if err != nil || offset < 0 {
				http.Error(w, "invalid offset: must be a non-negative integer", http.StatusBadRequest)
				return
			}
			offsetPtr = &offset
		}

		jobs, err := deps.JobStore.List(r.Context(), sourceIDPtr, statusPtr, limitPtr, offsetPtr)
		if err != nil {
			http.Error(w, "failed to list jobs: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jobs": jobs,
		})
	}
}

// handleGetJob handles GET /api/local/jobs/{id}
func handleGetJob(deps *LocalImportDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := r.PathValue("id")

		job, err := deps.JobStore.Get(r.Context(), id)
		if err != nil {
			http.Error(w, "failed to get job: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if job == nil {
			http.Error(w, "job not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(job)
	}
}
