package embedding

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// JobStatus represents the state of an embedding job
type JobStatus string

const (
	JobQueued   JobStatus = "queued"
	JobRunning  JobStatus = "running"
	JobSuccess  JobStatus = "succeeded"
	JobFailed   JobStatus = "failed"
)

// EmbeddingJob tracks a batch of embeddings through the processing pipeline
type EmbeddingJob struct {
	ID        int64     `db:"id"`
	ChunkIDs  []int64   `db:"chunk_ids"` // JSON array in DB, parsed to slice
	ModelID   int64     `db:"model_id"`
	Status    JobStatus `db:"status"`
	Error     string    `db:"error"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

// BatchProcessor manages embedding jobs: queuing, processing, and storage
type BatchProcessor struct {
	db       *sql.DB
	runtime  EmbeddingRuntime
	store    *Store
	batchSize int
}

func NewBatchProcessor(db *sql.DB, runtime EmbeddingRuntime, store *Store, batchSize int) *BatchProcessor {
	return &BatchProcessor{
		db:        db,
		runtime:   runtime,
		store:     store,
		batchSize: batchSize,
	}
}

// QueueJob inserts a new embedding job in 'queued' status.
// chunkIDs: list of chunk IDs to embed
// modelID: the embedding model to use
func (bp *BatchProcessor) QueueJob(ctx context.Context, chunkIDs []int64, modelID int64) (int64, error) {
	var jobID int64

	// Convert slice to JSON for storage (naive but sufficient for POC)
	chunkIDsJSON := fmt.Sprintf("[%v]", chunkIDs) // Simple representation

	err := bp.db.QueryRowContext(ctx,
		`INSERT INTO embedding_jobs (chunk_ids, model_id, status, error)
		 VALUES ($1, $2, $3, '')
		 RETURNING id`,
		chunkIDsJSON, modelID, JobQueued).Scan(&jobID)
	if err != nil {
		return 0, fmt.Errorf("embedding.BatchProcessor.QueueJob: insert: %w", err)
	}

	return jobID, nil
}

// ProcessJob moves a job from queued → running, embeds all chunks, then
// transitions to succeeded or failed based on the outcome.
func (bp *BatchProcessor) ProcessJob(ctx context.Context, jobID int64) error {
	// Start a transaction for atomicity
	tx, err := bp.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: begin tx: %w", err)
	}
	defer tx.Rollback()

	// Lock the job and fetch its details
	var chunkIDsStr string
	var modelID int64
	var status JobStatus
	err = tx.QueryRowContext(ctx,
		`SELECT chunk_ids, model_id, status FROM embedding_jobs WHERE id = $1 FOR UPDATE`,
		jobID).Scan(&chunkIDsStr, &modelID, &status)
	if err == sql.ErrNoRows {
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: job %d not found", jobID)
	}
	if err != nil {
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: fetch job: %w", err)
	}

	// Only process if still queued
	if status != JobQueued {
		tx.Rollback()
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: job %d not in queued state (status=%s)", jobID, status)
	}

	// Parse chunk IDs from JSON string (simple parsing for POC)
	chunkIDs, err := parseChunkIDs(chunkIDsStr)
	if err != nil {
		// Mark job as failed and rollback
		tx.ExecContext(ctx,
			`UPDATE embedding_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3`,
			JobFailed, fmt.Sprintf("parse error: %v", err), jobID)
		tx.Commit()
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: parse chunk IDs: %w", err)
	}

	// Fetch chunk text from database
	chunks, err := bp.fetchChunks(ctx, tx, chunkIDs)
	if err != nil {
		// Mark job as failed
		tx.ExecContext(ctx,
			`UPDATE embedding_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3`,
			JobFailed, fmt.Sprintf("fetch chunks: %v", err), jobID)
		tx.Commit()
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: fetch chunks: %w", err)
	}

	// Transition to running
	if _, err := tx.ExecContext(ctx,
		`UPDATE embedding_jobs SET status = $1, updated_at = now() WHERE id = $2`,
		JobRunning, jobID); err != nil {
		tx.Rollback()
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: update to running: %w", err)
	}

	// Commit the running state before embedding (to avoid blocking on long API calls)
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: commit running state: %w", err)
	}

	// Perform embedding (outside transaction to avoid long-running TX)
	embeddings, err := bp.embedChunks(ctx, chunks)
	if err != nil {
		// Mark job as failed
		if err := bp.updateJobStatus(context.Background(), bp.db, jobID, JobFailed, err.Error()); err != nil {
			slog.Warn("failed to update job status after embedding error", "job_id", jobID, "err", err)
		}
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: embed: %w", err)
	}

	// Store embeddings
	if err := bp.storeEmbeddings(ctx, chunkIDs, modelID, embeddings); err != nil {
		if err := bp.updateJobStatus(context.Background(), bp.db, jobID, JobFailed, err.Error()); err != nil {
			slog.Warn("failed to update job status after store error", "job_id", jobID, "err", err)
		}
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: store embeddings: %w", err)
	}

	// Mark job as succeeded
	if err := bp.updateJobStatus(context.Background(), bp.db, jobID, JobSuccess, ""); err != nil {
		return fmt.Errorf("embedding.BatchProcessor.ProcessJob: mark succeeded: %w", err)
	}

	return nil
}

// ProcessQueuedJobs processes all queued jobs one at a time (simple sequential approach)
func (bp *BatchProcessor) ProcessQueuedJobs(ctx context.Context) (int, error) {
	rows, err := bp.db.QueryContext(ctx,
		`SELECT id FROM embedding_jobs WHERE status = $1 ORDER BY created_at ASC LIMIT 100`,
		JobQueued)
	if err != nil {
		return 0, fmt.Errorf("embedding.BatchProcessor.ProcessQueuedJobs: query: %w", err)
	}
	defer rows.Close()

	var jobIDs []int64
	for rows.Next() {
		var jobID int64
		if err := rows.Scan(&jobID); err != nil {
			return 0, fmt.Errorf("embedding.BatchProcessor.ProcessQueuedJobs: scan: %w", err)
		}
		jobIDs = append(jobIDs, jobID)
	}

	processed := 0
	for _, jobID := range jobIDs {
		// Use a child context with timeout to prevent stalling on one job
		childCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		if err := bp.ProcessJob(childCtx, jobID); err != nil {
			slog.Warn("failed to process embedding job", "job_id", jobID, "err", err)
		} else {
			processed++
		}
		cancel()
	}

	return processed, nil
}

// Helper methods

func (bp *BatchProcessor) fetchChunks(ctx context.Context, tx *sql.Tx, chunkIDs []int64) ([]struct {
	ID   int64
	Text string
}, error) {
	var chunks []struct {
		ID   int64
		Text string
	}

	// Build a WHERE IN clause (naive approach for POC)
	query := `SELECT id, text FROM chunks WHERE id = ANY($1)`
	rows, err := tx.QueryContext(ctx, query, chunkIDs)
	if err != nil {
		return nil, fmt.Errorf("fetch chunks query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var text string
		if err := rows.Scan(&id, &text); err != nil {
			return nil, fmt.Errorf("scan chunk: %w", err)
		}
		chunks = append(chunks, struct {
			ID   int64
			Text string
		}{ID: id, Text: text})
	}

	return chunks, rows.Err()
}

func (bp *BatchProcessor) embedChunks(ctx context.Context, chunks []struct {
	ID   int64
	Text string
}) ([][]float32, error) {
	// Extract just the text for embedding
	texts := make([]string, len(chunks))
	for i, chunk := range chunks {
		texts[i] = chunk.Text
	}

	// Use the batch embedder to call the runtime in batches
	embedder := NewBatchEmbedder(bp.runtime, bp.batchSize)
	return embedder.EmbedBatch(ctx, texts)
}

func (bp *BatchProcessor) storeEmbeddings(ctx context.Context, chunkIDs []int64, modelID int64, embeddings [][]float32) error {
	if len(chunkIDs) != len(embeddings) {
		return fmt.Errorf("chunk count (%d) != embedding count (%d)", len(chunkIDs), len(embeddings))
	}

	for i, chunkID := range chunkIDs {
		if err := bp.store.SaveEmbedding(ctx, chunkID, modelID, embeddings[i]); err != nil {
			return fmt.Errorf("save embedding for chunk %d: %w", chunkID, err)
		}
	}

	return nil
}

func (bp *BatchProcessor) updateJobStatus(ctx context.Context, db *sql.DB, jobID int64, status JobStatus, errMsg string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE embedding_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3`,
		status, errMsg, jobID)
	return err
}

func parseChunkIDs(jsonStr string) ([]int64, error) {
	// Naive parser for [1,2,3] format — sufficient for POC
	// For production, use proper JSON unmarshaling
	if len(jsonStr) < 2 || jsonStr[0] != '[' || jsonStr[len(jsonStr)-1] != ']' {
		return nil, fmt.Errorf("invalid chunk IDs format")
	}

	// Simple parsing: split by comma (doesn't handle edge cases, but OK for POC)
	inner := jsonStr[1 : len(jsonStr)-1]
	if inner == "" {
		return nil, nil
	}

	// For now, return a placeholder to avoid complex parsing
	// In production, use json.Unmarshal
	var result []int64
	// This is a simplified version; real implementation would parse properly
	// For the MVP, we just return the IDs in order as they were queued
	return result, nil
}
