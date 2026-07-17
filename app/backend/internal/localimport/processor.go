package localimport

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/rad-system/m365-knowledge-graph/internal/metadata"
	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// Processor orchestrates the import pipeline for a job.
type Processor struct {
	resolver    *DeltaResolver
	extractor   *Extractor
	chunker     *parsers.Chunker
	embedder    retrieval.EmbeddingRuntime
	fileStore   *LocalFileStore
	sourceStore *LocalSourceStore
	chunkStore  *metadata.ChunkStore
	jobStore    *ImportJobStore
	logger      *slog.Logger
}

// NewProcessor creates a new Processor.
func NewProcessor(
	resolver *DeltaResolver,
	extractor *Extractor,
	chunker *parsers.Chunker,
	embedder retrieval.EmbeddingRuntime,
	fileStore *LocalFileStore,
	sourceStore *LocalSourceStore,
	chunkStore *metadata.ChunkStore,
	jobStore *ImportJobStore,
	logger *slog.Logger,
) *Processor {
	return &Processor{
		resolver:    resolver,
		extractor:   extractor,
		chunker:     chunker,
		embedder:    embedder,
		fileStore:   fileStore,
		sourceStore: sourceStore,
		chunkStore:  chunkStore,
		jobStore:    jobStore,
		logger:      logger,
	}
}

// Run executes the import for a job.
func (p *Processor) Run(ctx context.Context, job *ImportJob) error {
	// Mark job as running
	if err := p.jobStore.UpdateStatus(ctx, job.ID, JobRunning); err != nil {
		return err
	}

	// Get the source for this job
	source, err := p.sourceStore.Get(ctx, job.SourceID)
	if err != nil {
		return fmt.Errorf("failed to get source: %w", err)
	}
	if source == nil {
		return fmt.Errorf("source not found: %s", job.SourceID)
	}

	// Create a scanner for this source
	scanner := NewScanner(*source)

	// Scan the source directory
	entries, errChan := scanner.Walk(ctx)

	progress := JobProgress{}
	var filesToDelete []string

	// Process each scanned entry
	for entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errChan:
			if err != nil {
				p.logger.Error("scan error", "error", err, "source", source.ID)
				if err := p.jobStore.AppendError(ctx, job.ID, fmt.Sprintf("scan: %s", RedactPath(entry.RelPath, source.FolderPath))); err != nil {
					p.logger.Error("failed to log error", "error", err)
				}
				progress.FilesSkipped++
				continue
			}
		default:
		}

		// Classify file change state
		delta, err := p.resolver.Classify(ctx, source.ID, entry)
		if err != nil {
			p.logger.Error("delta classification failed", "error", err, "file", entry.RelPath)
			progress.FilesSkipped++
			continue
		}

		progress.FilesTotal++

		if delta.Action == DeltaUnchanged {
			progress.FilesSkipped++
			continue
		}

		if delta.Action == DeltaDeleted {
			filesToDelete = append(filesToDelete, delta.Stored.ID)
			progress.FilesDeleted++
			continue
		}

		// Extract text from file
		absPath := filepath.Join(source.FolderPath, entry.RelPath)
		extractResult, err := p.extractor.Extract(ctx, absPath)
		if err != nil {
			p.logger.Error("extraction error", "error", err, "file", RedactPath(absPath, source.FolderPath))
			if err := p.jobStore.AppendError(ctx, job.ID, RedactPath(absPath, source.FolderPath)); err != nil {
				p.logger.Error("failed to log error", "error", err)
			}
			progress.FilesSkipped++
			continue
		}

		if extractResult.IsBinary {
			progress.FilesBinary++
		}

		// Build LocalFile record
		localFile := LocalFile{
			SourceID:    source.ID,
			RelPath:     entry.RelPath,
			FileName:    entry.FileName,
			FileSize:    entry.Size,
			Mtime:       entry.Mtime,
			MimeType:    "application/octet-stream",
			Encoding:    nil,
			IsBinary:    extractResult.IsBinary,
			ContentHash: computeHash([]byte(extractResult.Text)),
			ChunkCount:  0,
		}

		if extractResult.Encoding != "" {
			localFile.Encoding = &extractResult.Encoding
		}

		// Store local file first to get its ID
		if err := p.fileStore.Upsert(ctx, localFile); err != nil {
			p.logger.Error("file upsert failed", "error", err, "file", entry.RelPath)
			progress.FilesSkipped++
			continue
		}

		// Re-fetch the file to get its ID
		storedFile, err := p.fileStore.GetByRelPath(ctx, source.ID, entry.RelPath)
		if err != nil {
			p.logger.Error("file retrieval failed", "error", err, "file", entry.RelPath)
			progress.FilesSkipped++
			continue
		}

		// Chunk the text
		chunks := p.chunker.ChunkText(extractResult.Text, "")
		storedFile.ChunkCount = len(chunks)

		// Store chunks and embeddings
		// TODO: For now, we skip chunk storage; will be implemented in phase 3
		// This is where we'd insert into chunks table with local_file_id
		// and call embedder.Embed() for the chunk texts

		if delta.Action == DeltaAdded {
			progress.FilesAdded++
		} else if delta.Action == DeltaModified {
			progress.FilesModified++
		}

		// Update progress every 50 files
		if (progress.FilesAdded + progress.FilesModified) % 50 == 0 {
			total := progress.FilesTotal
			if total > 0 {
				progress.ProgressPct = (progress.FilesAdded + progress.FilesModified) * 100 / total
			}
			if err := p.jobStore.UpdateProgress(ctx, job.ID, progress); err != nil {
				p.logger.Error("progress update failed", "error", err)
			}
		}
	}

	// Check error channel for any remaining errors
	for err := range errChan {
		if err != nil {
			p.logger.Error("scan error (post-processing)", "error", err)
		}
	}

	// Delete files marked for deletion
	for _, fileID := range filesToDelete {
		if err := p.fileStore.Delete(ctx, fileID); err != nil {
			p.logger.Error("file deletion failed", "error", err, "file_id", fileID)
		}
	}

	// Update final stats
	progress.ProgressPct = 100
	if err := p.jobStore.UpdateProgress(ctx, job.ID, progress); err != nil {
		p.logger.Error("final progress update failed", "error", err)
	}

	// Update source stats
	if err := p.jobStore.UpdateProgress(ctx, job.ID, progress); err != nil {
		p.logger.Error("stats update failed", "error", err)
	}

	// Mark job as completed
	if err := p.jobStore.UpdateStatus(ctx, job.ID, JobCompleted); err != nil {
		return err
	}

	p.logger.Info("import completed", "job_id", job.ID, "files_added", progress.FilesAdded, "files_modified", progress.FilesModified, "files_deleted", progress.FilesDeleted)
	return nil
}

// computeHash returns the SHA-256 hash of data as a hex string.
func computeHash(data []byte) string {
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%x", hash)
}
