package finetuning

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

type FineTuningJob struct {
	ID                 int64
	ModelType          string
	BaseModel          string
	TrainingPairsCount int64
	Status             string
	AnthropicJobID     string
	ErrorMessage       string
	StartedAt          *time.Time
	CompletedAt        *time.Time
	CreatedAt          time.Time
}

type JobStore interface {
	CreateJob(ctx context.Context, job *FineTuningJob) error
	GetJobByID(ctx context.Context, jobID int64) (*FineTuningJob, error)
	UpdateJobStatus(ctx context.Context, jobID int64, status, anthropicJobID, errorMsg string) error
	ListPendingJobs(ctx context.Context) ([]*FineTuningJob, error)
}

type FineTuningOrchestrator struct {
	db                *sql.DB
	versioning        *Versioning
	anthropic         *AnthropicClient
	trainingDataStore TrainingDataStore // interface for exporting pairs
}

type TrainingDataStore interface {
	ExportTrainingPairs(ctx context.Context, since time.Time) ([]*TrainingData, error)
}

func NewFineTuningOrchestrator(db *sql.DB, versioning *Versioning, anthropic *AnthropicClient, trainingStore TrainingDataStore) *FineTuningOrchestrator {
	return &FineTuningOrchestrator{
		db:                db,
		versioning:        versioning,
		anthropic:         anthropic,
		trainingDataStore: trainingStore,
	}
}

// ScheduleFineTuningJob creates a new fine-tuning job if conditions are met
func (fo *FineTuningOrchestrator) ScheduleFineTuningJob(ctx context.Context, modelType, baseModel string, minPairs int64) (*FineTuningJob, error) {
	// Export training pairs
	pairs, err := fo.trainingDataStore.ExportTrainingPairs(ctx, time.Now().AddDate(0, -1, 0))
	if err != nil {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: export pairs: %w", err)
	}

	if int64(len(pairs)) < minPairs {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: insufficient pairs (have %d, need %d)", len(pairs), minPairs)
	}

	slog.InfoContext(ctx, "scheduling fine-tuning job", "model_type", modelType, "pairs", len(pairs))

	// Create version record
	versionTag := fmt.Sprintf("v%d-%d", time.Now().Unix(), len(pairs))
	version, err := fo.versioning.Create(ctx, modelType, baseModel, versionTag, int64(len(pairs)))
	if err != nil {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: create version: %w", err)
	}

	// Create fine-tuning job
	jobReq := FineTuningJobRequest{
		Model:        baseModel,
		TrainingData: pairs,
	}

	anthropicJobID, err := fo.anthropic.CreateFineTuningJob(ctx, jobReq)
	if err != nil {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: create anthropic job: %w", err)
	}

	// Update version with Anthropic job ID
	err = fo.versioning.UpdateJobID(ctx, version.ID, anthropicJobID)
	if err != nil {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: update job ID: %w", err)
	}

	// Create job record
	job := &FineTuningJob{
		ModelType:          modelType,
		BaseModel:          baseModel,
		TrainingPairsCount: int64(len(pairs)),
		Status:             "queued",
		AnthropicJobID:     anthropicJobID,
	}

	err = fo.createJob(ctx, job)
	if err != nil {
		return nil, fmt.Errorf("orchestrator.ScheduleFineTuningJob: create job: %w", err)
	}

	slog.InfoContext(ctx, "fine-tuning job scheduled", "job_id", anthropicJobID, "version_id", version.ID)
	return job, nil
}

// PollAndCompleteJobs polls in-flight jobs and completes them
func (fo *FineTuningOrchestrator) PollAndCompleteJobs(ctx context.Context) error {
	jobs, err := fo.listPendingJobs(ctx)
	if err != nil {
		return fmt.Errorf("orchestrator.PollAndCompleteJobs: list pending: %w", err)
	}

	for _, job := range jobs {
		anthropicJob, err := fo.anthropic.PollFineTuningJob(ctx, job.AnthropicJobID)
		if err != nil {
			slog.ErrorContext(ctx, "failed to poll job", "job_id", job.AnthropicJobID, "error", err)
			continue
		}

		switch anthropicJob.Status {
		case "completed":
			// Mark job as complete in our DB
			err := fo.updateJobStatus(ctx, job.ID, "completed", job.AnthropicJobID, "")
			if err != nil {
				slog.ErrorContext(ctx, "failed to update job status", "job_id", job.ID, "error", err)
				continue
			}

			slog.InfoContext(ctx, "fine-tuning job completed", "job_id", job.AnthropicJobID, "model_id", anthropicJob.ModelID)

		case "failed":
			err := fo.updateJobStatus(ctx, job.ID, "failed", job.AnthropicJobID, anthropicJob.Error)
			if err != nil {
				slog.ErrorContext(ctx, "failed to update job status", "job_id", job.ID, "error", err)
				continue
			}

			slog.ErrorContext(ctx, "fine-tuning job failed", "job_id", job.AnthropicJobID, "error", anthropicJob.Error)

		case "queued", "running":
			// Still in progress, continue
			slog.DebugContext(ctx, "fine-tuning job in progress", "job_id", job.AnthropicJobID, "status", anthropicJob.Status)
		}
	}

	return nil
}

// Helper functions

func (fo *FineTuningOrchestrator) createJob(ctx context.Context, job *FineTuningJob) error {
	query := `
		INSERT INTO fine_tuning_jobs (model_type, base_model, training_pairs_count, status, anthropic_job_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`

	err := fo.db.QueryRowContext(ctx, query, job.ModelType, job.BaseModel, job.TrainingPairsCount, job.Status, job.AnthropicJobID).Scan(&job.ID, &job.CreatedAt)
	if err != nil {
		return fmt.Errorf("orchestrator.createJob: %w", err)
	}

	return nil
}

func (fo *FineTuningOrchestrator) listPendingJobs(ctx context.Context) ([]*FineTuningJob, error) {
	query := `
		SELECT id, model_type, base_model, training_pairs_count, status, anthropic_job_id, error_message, started_at, completed_at, created_at
		FROM fine_tuning_jobs
		WHERE status IN ('queued', 'running')
		ORDER BY created_at DESC
	`

	rows, err := fo.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("orchestrator.listPendingJobs: %w", err)
	}
	defer rows.Close()

	var jobs []*FineTuningJob
	for rows.Next() {
		var (
			job          FineTuningJob
			errorMessage sql.NullString
			startedAt    sql.NullTime
			completedAt  sql.NullTime
		)
		if err := rows.Scan(&job.ID, &job.ModelType, &job.BaseModel, &job.TrainingPairsCount, &job.Status,
			&job.AnthropicJobID, &errorMessage, &startedAt, &completedAt, &job.CreatedAt); err != nil {
			return nil, fmt.Errorf("orchestrator.listPendingJobs scan: %w", err)
		}

		if errorMessage.Valid {
			job.ErrorMessage = errorMessage.String
		}
		if startedAt.Valid {
			job.StartedAt = &startedAt.Time
		}
		if completedAt.Valid {
			job.CompletedAt = &completedAt.Time
		}

		jobs = append(jobs, &job)
	}

	return jobs, rows.Err()
}

func (fo *FineTuningOrchestrator) updateJobStatus(ctx context.Context, jobID int64, status, anthropicJobID, errorMsg string) error {
	query := `
		UPDATE fine_tuning_jobs
		SET status = $1, anthropic_job_id = $2, error_message = $3, completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
		WHERE id = $4
	`

	_, err := fo.db.ExecContext(ctx, query, status, anthropicJobID, errorMsg, jobID)
	if err != nil {
		return fmt.Errorf("orchestrator.updateJobStatus: %w", err)
	}

	return nil
}
