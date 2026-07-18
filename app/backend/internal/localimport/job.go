package localimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"
)

// ErrJobAlreadyActive is returned by Create when a queued/running job already exists for the
// source (enforced by the partial unique index in migration 006). Callers map it to HTTP 409.
var ErrJobAlreadyActive = errors.New("an import job is already active for this source")

type JobStatus string

const (
	JobQueued    JobStatus = "queued"
	JobRunning   JobStatus = "running"
	JobCompleted JobStatus = "completed"
	JobFailed    JobStatus = "failed"
	JobStale     JobStatus = "stale"
)

// ImportJob represents a single import execution for a source.
type ImportJob struct {
	ID            string     `json:"id"`
	SourceID      string     `json:"source_id"`
	Status        JobStatus  `json:"status"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
	FilesTotal    int        `json:"files_total"`
	FilesAdded    int        `json:"files_added"`
	FilesModified int        `json:"files_modified"`
	FilesDeleted  int        `json:"files_deleted"`
	FilesSkipped  int        `json:"files_skipped"`
	FilesBinary   int        `json:"files_binary"`
	Errors        []string   `json:"errors,omitempty"`
	ProgressPct   int        `json:"progress_pct"`
	CreatedAt     time.Time  `json:"created_at"`
}

// JobProgress tracks progress metrics during import.
type JobProgress struct {
	FilesTotal    int
	FilesAdded    int
	FilesModified int
	FilesDeleted  int
	FilesSkipped  int
	FilesBinary   int
	ProgressPct   int
}

// ImportJobStore handles database operations for import jobs.
type ImportJobStore struct {
	db *sql.DB
}

// NewImportJobStore creates a new ImportJobStore.
func NewImportJobStore(db *sql.DB) *ImportJobStore {
	return &ImportJobStore{db: db}
}

// Create creates a new import job for a source.
func (s *ImportJobStore) Create(ctx context.Context, sourceID string) (*ImportJob, error) {
	job := &ImportJob{
		SourceID:   sourceID,
		Status:     JobQueued,
		FilesTotal: 0,
	}
	err := s.db.QueryRowContext(ctx,
		`INSERT INTO import_jobs (source_id, status, created_at)
		VALUES ($1, $2, now())
		RETURNING id, created_at`,
		sourceID, JobQueued,
	).Scan(&job.ID, &job.CreatedAt)
	if err != nil {
		// A unique_violation (23505) means the partial unique index rejected a second
		// active job for this source — surface it as the typed conflict, not a raw 500.
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, ErrJobAlreadyActive
		}
		return nil, err
	}
	return job, nil
}

// Get retrieves an import job by ID.
func (s *ImportJobStore) Get(ctx context.Context, id string) (*ImportJob, error) {
	job := &ImportJob{}
	var errors pq.StringArray
	err := s.db.QueryRowContext(ctx,
		`SELECT id, source_id, status, started_at, finished_at, files_total, files_added, files_modified,
		files_deleted, files_skipped, files_binary, error_messages, progress_pct, created_at
		FROM import_jobs WHERE id = $1`,
		id,
	).Scan(
		&job.ID, &job.SourceID, (*string)(&job.Status), &job.StartedAt, &job.FinishedAt, &job.FilesTotal,
		&job.FilesAdded, &job.FilesModified, &job.FilesDeleted, &job.FilesSkipped, &job.FilesBinary,
		&errors, &job.ProgressPct, &job.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	job.Errors = errors
	return job, nil
}

// List retrieves import jobs with optional filtering by source_id, status, and pagination.
// sourceID and status are optional filters; limit and offset are for pagination (default limit=50, offset=0).
func (s *ImportJobStore) List(ctx context.Context, sourceID *string, status *string, limit *int, offset *int) ([]ImportJob, error) {
	var query string
	var args []interface{}
	argIndex := 1

	query = `SELECT id, source_id, status, started_at, finished_at, files_total, files_added, files_modified,
		files_deleted, files_skipped, files_binary, error_messages, progress_pct, created_at
		FROM import_jobs WHERE 1=1`

	if sourceID != nil && *sourceID != "" {
		query += fmt.Sprintf(" AND source_id = $%d", argIndex)
		args = append(args, *sourceID)
		argIndex++
	}

	if status != nil && *status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, *status)
		argIndex++
	}

	query += " ORDER BY created_at DESC"

	// Default pagination values
	pageLimit := 50
	pageOffset := 0
	if limit != nil && *limit > 0 && *limit <= 1000 {
		pageLimit = *limit
	}
	if offset != nil && *offset >= 0 {
		pageOffset = *offset
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, pageLimit, pageOffset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []ImportJob
	for rows.Next() {
		job := ImportJob{}
		var errors pq.StringArray
		err := rows.Scan(
			&job.ID, &job.SourceID, (*string)(&job.Status), &job.StartedAt, &job.FinishedAt, &job.FilesTotal,
			&job.FilesAdded, &job.FilesModified, &job.FilesDeleted, &job.FilesSkipped, &job.FilesBinary,
			&errors, &job.ProgressPct, &job.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		job.Errors = errors
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

// UpdateStatus updates the status of an import job.
func (s *ImportJobStore) UpdateStatus(ctx context.Context, id string, status JobStatus) error {
	var startedAt, finishedAt *time.Time
	if status == JobRunning {
		now := time.Now()
		startedAt = &now
	} else if status == JobCompleted || status == JobFailed || status == JobStale {
		now := time.Now()
		finishedAt = &now
	}

	_, err := s.db.ExecContext(ctx,
		`UPDATE import_jobs SET status = $1, started_at = COALESCE($2, started_at), finished_at = COALESCE($3, finished_at) WHERE id = $4`,
		status, startedAt, finishedAt, id,
	)
	return err
}

// UpdateProgress updates the progress metrics of an import job.
func (s *ImportJobStore) UpdateProgress(ctx context.Context, id string, progress JobProgress) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE import_jobs SET files_total = $1, files_added = $2, files_modified = $3,
		files_deleted = $4, files_skipped = $5, files_binary = $6, progress_pct = $7
		WHERE id = $8`,
		progress.FilesTotal, progress.FilesAdded, progress.FilesModified,
		progress.FilesDeleted, progress.FilesSkipped, progress.FilesBinary, progress.ProgressPct, id,
	)
	return err
}

// AppendError appends an error message to a job's error log (capped at 100 entries).
func (s *ImportJobStore) AppendError(ctx context.Context, id string, errMsg string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE import_jobs SET error_messages = CASE
		WHEN array_length(error_messages, 1) IS NULL THEN ARRAY[$1]
		WHEN array_length(error_messages, 1) < 100 THEN array_append(error_messages, $1)
		ELSE error_messages
		END WHERE id = $2`,
		errMsg, id,
	)
	return err
}

// HasRunning checks if there is an ACTIVE (queued OR running) import job for a source. Checking
// queued too closes the gap where a job sits in `queued` until a worker flips it to `running`:
// a second sync in that window would otherwise see "no running job" and enqueue a duplicate.
func (s *ImportJobStore) HasRunning(ctx context.Context, sourceID string) (*ImportJob, error) {
	job := &ImportJob{}
	var errs pq.StringArray
	err := s.db.QueryRowContext(ctx,
		`SELECT id, source_id, status, started_at, finished_at, files_total, files_added, files_modified,
		files_deleted, files_skipped, files_binary, error_messages, progress_pct, created_at
		FROM import_jobs WHERE source_id = $1 AND status IN ($2, $3) LIMIT 1`,
		sourceID, JobQueued, JobRunning,
	).Scan(
		&job.ID, &job.SourceID, (*string)(&job.Status), &job.StartedAt, &job.FinishedAt, &job.FilesTotal,
		&job.FilesAdded, &job.FilesModified, &job.FilesDeleted, &job.FilesSkipped, &job.FilesBinary,
		&errs, &job.ProgressPct, &job.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	job.Errors = errs
	return job, nil
}

// MarkStaleJobs marks any running jobs as stale at startup.
func (s *ImportJobStore) MarkStaleJobs(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE import_jobs SET status = $1, finished_at = now() WHERE status = $2`,
		JobStale, JobRunning,
	)
	return err
}
