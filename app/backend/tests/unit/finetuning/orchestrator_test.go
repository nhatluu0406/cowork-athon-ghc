package finetuning_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
	test "github.com/rad-system/m365-knowledge-graph/tests/unit"
)

// fakeTrainingDataStore implements the TrainingDataStore interface for testing
type fakeTrainingDataStore struct {
	pairs []*finetuning.TrainingData
	err   error
}

func (f *fakeTrainingDataStore) ExportTrainingPairs(ctx context.Context, since time.Time) ([]*finetuning.TrainingData, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.pairs, nil
}

// TestScheduleFineTuningJob_Success tests successful job scheduling
func TestScheduleFineTuningJob_Success(t *testing.T) {
	db := test.SetupTestDB(t)
	defer test.TeardownTestDB(t, db)

	v := finetuning.NewVersioning(db)
	store := &fakeTrainingDataStore{
		pairs: []*finetuning.TrainingData{
			{System: "test", UserQuery: "q1", Answer: "a1", Positive: true},
			{System: "test", UserQuery: "q2", Answer: "a2", Positive: true},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/v1/beta/model-ids/models/claude-opus-4-8/fine_tuning_jobs" {
			resp := finetuning.FineTuningJobResponse{
				ID:        "job-123",
				Status:    "queued",
				ModelID:   "claude-opus-4-8",
				CreatedAt: "2026-07-11T00:00:00Z",
				UpdatedAt: "2026-07-11T00:00:00Z",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	ac := finetuning.NewAnthropicClientWithBaseURL("test-key", server.URL)
	orch := finetuning.NewFineTuningOrchestrator(db, v, ac, store)

	job, err := orch.ScheduleFineTuningJob(context.Background(), "answer_generator", "claude-opus-4-8", 1)
	if err != nil {
		t.Fatalf("ScheduleFineTuningJob failed: %v", err)
	}

	if job == nil {
		t.Fatal("Job should not be nil")
	}
	if job.Status != "queued" {
		t.Errorf("Job status should be 'queued', got '%s'", job.Status)
	}
	if job.AnthropicJobID != "job-123" {
		t.Errorf("Job ID mismatch: %s", job.AnthropicJobID)
	}
	if job.TrainingPairsCount != 2 {
		t.Errorf("Training pairs count should be 2, got %d", job.TrainingPairsCount)
	}
}

// TestScheduleFineTuningJob_InsufficientPairs tests rejection when not enough training pairs
func TestScheduleFineTuningJob_InsufficientPairs(t *testing.T) {
	db := test.SetupTestDB(t)
	defer test.TeardownTestDB(t, db)

	v := finetuning.NewVersioning(db)
	store := &fakeTrainingDataStore{
		pairs: []*finetuning.TrainingData{
			{System: "test", UserQuery: "q1", Answer: "a1", Positive: true},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "should not be called", http.StatusInternalServerError)
	}))
	defer server.Close()

	ac := finetuning.NewAnthropicClientWithBaseURL("test-key", server.URL)
	orch := finetuning.NewFineTuningOrchestrator(db, v, ac, store)

	job, err := orch.ScheduleFineTuningJob(context.Background(), "answer_generator", "claude-opus-4-8", 10)
	if err == nil {
		t.Fatal("Should return error for insufficient pairs")
	}
	if job != nil {
		t.Fatal("Job should be nil when error returned")
	}
}

// TestPollAndCompleteJobs_MarksCompleted tests polling completes a job
func TestPollAndCompleteJobs_MarksCompleted(t *testing.T) {
	db := test.SetupTestDB(t)
	defer test.TeardownTestDB(t, db)

	v := finetuning.NewVersioning(db)

	_, err := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 10)
	if err != nil {
		t.Fatalf("Failed to create version: %v", err)
	}

	_, err = db.ExecContext(context.Background(), `
		INSERT INTO fine_tuning_jobs (model_type, base_model, training_pairs_count, status, anthropic_job_id)
		VALUES ('answer_generator', 'claude-opus-4-8', 10, 'queued', 'job-456')
	`)
	if err != nil {
		t.Fatalf("Failed to insert job: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/v1/beta/fine_tuning_jobs/job-456" {
			resp := finetuning.FineTuningJobResponse{
				ID:          "job-456",
				Status:      "completed",
				ModelID:     "claude-opus-4-8-ft-12345",
				CreatedAt:   "2026-07-11T00:00:00Z",
				UpdatedAt:   "2026-07-11T01:00:00Z",
				CompletedAt: "2026-07-11T01:00:00Z",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	ac := finetuning.NewAnthropicClientWithBaseURL("test-key", server.URL)
	orch := finetuning.NewFineTuningOrchestrator(db, v, ac, nil)

	err = orch.PollAndCompleteJobs(context.Background())
	if err != nil {
		t.Fatalf("PollAndCompleteJobs failed: %v", err)
	}

	var status string
	var completedAt interface{}
	err = db.QueryRowContext(context.Background(), `
		SELECT status, completed_at FROM fine_tuning_jobs WHERE anthropic_job_id = 'job-456'
	`).Scan(&status, &completedAt)
	if err != nil {
		t.Fatalf("Failed to query job: %v", err)
	}

	if status != "completed" {
		t.Errorf("Job status should be 'completed', got '%s'", status)
	}
	if completedAt == nil {
		t.Error("completed_at should be set")
	}
}

// TestPollAndCompleteJobs_MarksFailed tests polling marks a job as failed
func TestPollAndCompleteJobs_MarksFailed(t *testing.T) {
	db := test.SetupTestDB(t)
	defer test.TeardownTestDB(t, db)

	v := finetuning.NewVersioning(db)

	_, err := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 10)
	if err != nil {
		t.Fatalf("Failed to create version: %v", err)
	}

	_, err = db.ExecContext(context.Background(), `
		INSERT INTO fine_tuning_jobs (model_type, base_model, training_pairs_count, status, anthropic_job_id)
		VALUES ('answer_generator', 'claude-opus-4-8', 10, 'running', 'job-789')
	`)
	if err != nil {
		t.Fatalf("Failed to insert job: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/v1/beta/fine_tuning_jobs/job-789" {
			resp := finetuning.FineTuningJobResponse{
				ID:        "job-789",
				Status:    "failed",
				Error:     "out of memory",
				CreatedAt: "2026-07-11T00:00:00Z",
				UpdatedAt: "2026-07-11T01:00:00Z",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	ac := finetuning.NewAnthropicClientWithBaseURL("test-key", server.URL)
	orch := finetuning.NewFineTuningOrchestrator(db, v, ac, nil)

	err = orch.PollAndCompleteJobs(context.Background())
	if err != nil {
		t.Fatalf("PollAndCompleteJobs failed: %v", err)
	}

	var status, errorMsg string
	err = db.QueryRowContext(context.Background(), `
		SELECT status, error_message FROM fine_tuning_jobs WHERE anthropic_job_id = 'job-789'
	`).Scan(&status, &errorMsg)
	if err != nil {
		t.Fatalf("Failed to query job: %v", err)
	}

	if status != "failed" {
		t.Errorf("Job status should be 'failed', got '%s'", status)
	}
	if errorMsg != "out of memory" {
		t.Errorf("Error message should be 'out of memory', got '%s'", errorMsg)
	}
}

// TestPollAndCompleteJobs_StillRunning tests polling skips running jobs
func TestPollAndCompleteJobs_StillRunning(t *testing.T) {
	db := test.SetupTestDB(t)
	defer test.TeardownTestDB(t, db)

	v := finetuning.NewVersioning(db)

	_, err := v.Create(context.Background(), "answer_generator", "claude-opus-4-8", "v1.0.0-test", 10)
	if err != nil {
		t.Fatalf("Failed to create version: %v", err)
	}

	_, err = db.ExecContext(context.Background(), `
		INSERT INTO fine_tuning_jobs (model_type, base_model, training_pairs_count, status, anthropic_job_id)
		VALUES ('answer_generator', 'claude-opus-4-8', 10, 'queued', 'job-999')
	`)
	if err != nil {
		t.Fatalf("Failed to insert job: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/v1/beta/fine_tuning_jobs/job-999" {
			resp := finetuning.FineTuningJobResponse{
				ID:        "job-999",
				Status:    "running",
				CreatedAt: "2026-07-11T00:00:00Z",
				UpdatedAt: "2026-07-11T00:30:00Z",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer server.Close()

	ac := finetuning.NewAnthropicClientWithBaseURL("test-key", server.URL)
	orch := finetuning.NewFineTuningOrchestrator(db, v, ac, nil)

	err = orch.PollAndCompleteJobs(context.Background())
	if err != nil {
		t.Fatalf("PollAndCompleteJobs failed: %v", err)
	}

	var status string
	var completedAt interface{}
	err = db.QueryRowContext(context.Background(), `
		SELECT status, completed_at FROM fine_tuning_jobs WHERE anthropic_job_id = 'job-999'
	`).Scan(&status, &completedAt)
	if err != nil {
		t.Fatalf("Failed to query job: %v", err)
	}

	if status != "queued" {
		t.Errorf("Job status should remain 'queued', got '%s'", status)
	}
	if completedAt != nil {
		t.Error("completed_at should not be set for running job")
	}
}
