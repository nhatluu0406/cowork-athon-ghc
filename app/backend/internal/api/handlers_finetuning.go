package api

import (
	"encoding/json"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
)

type FineTuningStatusResponse struct {
	ActiveModel           *ModelVersionInfo   `json:"active_model"`
	PendingJobs           []FineTuningJobInfo `json:"pending_jobs"`
	RecentlyCompletedJobs []FineTuningJobInfo `json:"recently_completed_jobs"`
	ABTestStatus          *ABTestStatusInfo   `json:"ab_test_status,omitempty"`
}

type ModelVersionInfo struct {
	ID                 int64   `json:"id"`
	VersionTag         string  `json:"version_tag"`
	TrainingPairsCount int64   `json:"training_pairs_count"`
	ValidationAccuracy float64 `json:"validation_accuracy"`
	PromotedAt         string  `json:"promoted_at"`
}

type FineTuningJobInfo struct {
	ID                 int64  `json:"id"`
	ModelType          string `json:"model_type"`
	Status             string `json:"status"`
	AnthropicJobID     string `json:"anthropic_job_id"`
	TrainingPairsCount int64  `json:"training_pairs_count"`
	ErrorMessage       string `json:"error_message,omitempty"`
	CreatedAt          string `json:"created_at"`
}

type ABTestStatusInfo struct {
	CanaryCohortID    int64   `json:"canary_cohort_id"`
	ControlCohortID   int64   `json:"control_cohort_id"`
	CanaryAccuracy    float64 `json:"canary_accuracy"`
	ControlAccuracy   float64 `json:"control_accuracy"`
	CanaryLatencyMs   float64 `json:"canary_latency_ms"`
	ControlLatencyMs  float64 `json:"control_latency_ms"`
	CanaryQueryCount  int64   `json:"canary_query_count"`
	DaysRunning       int     `json:"days_running"`
	ReadyForPromotion bool    `json:"ready_for_promotion"`
}

type FineTuningMetricsResponse struct {
	ModelType       string               `json:"model_type"`
	VersionHistory  []*ModelVersionInfo  `json:"version_history"`
	ABTestResults   *ABTestMetricsDetail `json:"ab_test_results"`
	LatestJobStatus *FineTuningJobInfo   `json:"latest_job_status"`
}

type ABTestMetricsDetail struct {
	Canary              *CohortMetricsDetail `json:"canary"`
	Control             *CohortMetricsDetail `json:"control"`
	AccuracyImprovement float64              `json:"accuracy_improvement"`
	LatencyChange       float64              `json:"latency_change_pct"`
}

type CohortMetricsDetail struct {
	Name            string  `json:"name"`
	QueryCount      int64   `json:"query_count"`
	AvgAccuracy     float64 `json:"avg_accuracy"`
	AvgLatencyMs    float64 `json:"avg_latency_ms"`
	AvgTokenUsage   float64 `json:"avg_token_usage"`
	ThumbsUpCount   int64   `json:"thumbs_up_count"`
	ThumbsDownCount int64   `json:"thumbs_down_count"`
}

type PromoteModelRequest struct {
	VersionID int64 `json:"version_id"`
}

type PromoteModelResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	VersionID int64  `json:"version_id"`
}

func HandleFineTuningStatus(versioning *finetuning.Versioning, abTest *finetuning.ABTestManager, db interface{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Get active model version
		activeModel, err := versioning.GetActive(r.Context(), "answer_generator")
		var activeModelInfo *ModelVersionInfo
		if err == nil && activeModel != nil {
			activeModelInfo = &ModelVersionInfo{
				ID:                 activeModel.ID,
				VersionTag:         activeModel.VersionTag,
				TrainingPairsCount: activeModel.TrainingPairsCount,
				ValidationAccuracy: activeModel.ValidationAccuracy,
				PromotedAt:         activeModel.PromotedAt.Format("2006-01-02T15:04:05Z"),
			}
		}

		// TODO: Query pending jobs from database
		// TODO: Query A/B test status
		resp := FineTuningStatusResponse{
			ActiveModel:           activeModelInfo,
			PendingJobs:           []FineTuningJobInfo{},
			RecentlyCompletedJobs: []FineTuningJobInfo{},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func HandleFineTuningMetrics(versioning *finetuning.Versioning, abTest *finetuning.ABTestManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		modelType := r.URL.Query().Get("model_type")
		if modelType == "" {
			modelType = "answer_generator"
		}

		// TODO: Query model versions history
		// TODO: Query A/B test metrics
		// For now, return stub
		resp := FineTuningMetricsResponse{
			ModelType: modelType,
			VersionHistory: []*ModelVersionInfo{
				{
					ID:                 1,
					VersionTag:         "v1.0.0-20260711",
					TrainingPairsCount: 150,
					ValidationAccuracy: 0.92,
					PromotedAt:         "2026-07-11T10:00:00Z",
				},
			},
			ABTestResults: &ABTestMetricsDetail{
				Canary: &CohortMetricsDetail{
					Name:            "canary",
					QueryCount:      85,
					AvgAccuracy:     0.94,
					AvgLatencyMs:    28.5,
					AvgTokenUsage:   450,
					ThumbsUpCount:   68,
					ThumbsDownCount: 5,
				},
				Control: &CohortMetricsDetail{
					Name:            "control",
					QueryCount:      850,
					AvgAccuracy:     0.90,
					AvgLatencyMs:    27.0,
					AvgTokenUsage:   440,
					ThumbsUpCount:   612,
					ThumbsDownCount: 58,
				},
				AccuracyImprovement: 0.04,
				LatencyChange:       5.5,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func HandlePromoteModel(versioning *finetuning.Versioning) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// TODO: Verify admin authorization
		var req PromoteModelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		// Promote model version
		if err := versioning.Promote(r.Context(), req.VersionID); err != nil {
			http.Error(w, "promotion failed: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := PromoteModelResponse{
			Success:   true,
			Message:   "Model version promoted successfully",
			VersionID: req.VersionID,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func HandleRollbackModel(versioning *finetuning.Versioning) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// TODO: Verify admin authorization
		modelType := r.URL.Query().Get("model_type")
		if modelType == "" {
			http.Error(w, "model_type required", http.StatusBadRequest)
			return
		}

		// Rollback to previous version
		if err := versioning.Rollback(r.Context(), modelType); err != nil {
			http.Error(w, "rollback failed: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := map[string]interface{}{
			"success": true,
			"message": "Rolled back to previous model version",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func HandleModelList(versioning *finetuning.Versioning) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		modelType := r.URL.Query().Get("model_type")
		if modelType == "" {
			modelType = "answer_generator"
		}

		// TODO: Query versions
		resp := map[string]interface{}{
			"model_type": modelType,
			"versions": []map[string]interface{}{
				{
					"id":                  1,
					"version_tag":         "v1.0.0-20260711",
					"training_pairs":      150,
					"validation_accuracy": 0.92,
					"is_active":           true,
					"promoted_at":         "2026-07-11T10:00:00Z",
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}
