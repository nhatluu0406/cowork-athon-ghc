package localimport

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/metadata"
	"github.com/rad-system/m365-knowledge-graph/internal/nlp"
	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// Processor orchestrates the import pipeline for a job.
type Processor struct {
	resolver         *DeltaResolver
	extractor        *Extractor
	chunker          *parsers.Chunker
	embedder         retrieval.EmbeddingRuntime
	embeddingStore   *embedding.Store // C2: persists chunk vectors (same store retrieval reads)
	embeddingModelID int64            // C2: the model id retrieval's SemanticSearch queries
	fileStore        *LocalFileStore
	sourceStore      *LocalSourceStore
	chunkStore       *metadata.ChunkStore
	jobStore         *ImportJobStore
	neo4jClient      *LocalNeo4jClient // T044: Neo4j operations for local documents
	nlpExtractor     *nlp.Extractor    // T046: NLP entity extraction
	logger           *slog.Logger
}

// NewProcessor creates a new Processor. embeddingStore + embeddingModelID may be nil/0 when no
// embedding runtime is configured (llm-svc absent); the processor then imports + chunks files
// without vectors and degrades gracefully (keyword search still works).
func NewProcessor(
	resolver *DeltaResolver,
	extractor *Extractor,
	chunker *parsers.Chunker,
	embedder retrieval.EmbeddingRuntime,
	embeddingStore *embedding.Store,
	embeddingModelID int64,
	fileStore *LocalFileStore,
	sourceStore *LocalSourceStore,
	chunkStore *metadata.ChunkStore,
	jobStore *ImportJobStore,
	neo4jClient *LocalNeo4jClient,
	nlpExtractor *nlp.Extractor,
	logger *slog.Logger,
) *Processor {
	return &Processor{
		resolver:         resolver,
		extractor:        extractor,
		chunker:          chunker,
		embedder:         embedder,
		embeddingStore:   embeddingStore,
		embeddingModelID: embeddingModelID,
		fileStore:        fileStore,
		sourceStore:      sourceStore,
		chunkStore:       chunkStore,
		jobStore:         jobStore,
		neo4jClient:      neo4jClient,
		nlpExtractor:     nlpExtractor,
		logger:           logger,
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

	// T044: Upsert LocalSource node in Neo4j
	if p.neo4jClient != nil {
		if err := p.neo4jClient.UpsertSource(ctx, source); err != nil {
			p.logger.Error("failed to upsert source to Neo4j", "error", err, "source_id", source.ID)
			// Non-fatal: continue with import even if Neo4j fails
		}
	}

	// M1: resolve the source root's real path once so per-file confinement compares
	// resolved-to-resolved (a root with symlinked components must not cause false rejections).
	resolvedRoot, err := filepath.EvalSymlinks(source.FolderPath)
	if err != nil {
		resolvedRoot = filepath.Clean(source.FolderPath)
	}

	// Create a scanner for this source
	scanner := NewScanner(*source)

	// Scan the source directory
	entries, errChan := scanner.Walk(ctx)

	progress := JobProgress{}
	scannedRelPaths := make(map[string]bool)

	// Process each scanned entry
	for entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errChan:
			if err != nil {
				// M5: do not log the raw walk error (may embed an absolute path); redacted only.
				absPath := filepath.Join(source.FolderPath, entry.RelPath)
				p.logger.Error("scan error", "source", source.ID, "file", RedactPath(absPath, source.FolderPath))
				if aerr := p.jobStore.AppendError(ctx, job.ID, fmt.Sprintf("scan: %s", RedactPath(absPath, source.FolderPath))); aerr != nil {
					p.logger.Error("failed to log error")
				}
				progress.FilesSkipped++
				continue
			}
		default:
		}

		// Track scanned files for delta detection
		scannedRelPaths[entry.RelPath] = true

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

		absPath := filepath.Join(source.FolderPath, entry.RelPath)

		// H1: bound memory — never read a file larger than MaxFileSize.
		if entry.Size > MaxFileSize {
			p.logger.Warn("file exceeds size cap; skipped", "file", RedactPath(absPath, source.FolderPath), "max_bytes", MaxFileSize)
			progress.FilesSkipped++
			continue
		}

		// M1: confinement — resolve symlinks/junctions and refuse anything that escapes the
		// source root, so a link inside the folder cannot read a file outside it.
		resolved, rerr := filepath.EvalSymlinks(absPath)
		if rerr != nil || !IsInsideRoot(resolved, resolvedRoot) {
			p.logger.Warn("path escaped source root or unresolvable; skipped", "file", RedactPath(absPath, source.FolderPath))
			progress.FilesSkipped++
			continue
		}

		// Extract text from file
		extractResult, err := p.extractor.Extract(ctx, absPath)
		if err != nil {
			// M5: NEVER log the raw OS error (it embeds the absolute path); redacted path + a
			// generic class only.
			p.logger.Error("extraction failed", "file", RedactPath(absPath, source.FolderPath))
			if aerr := p.jobStore.AppendError(ctx, job.ID, RedactPath(absPath, source.FolderPath)); aerr != nil {
				p.logger.Error("failed to log error")
			}
			progress.FilesSkipped++
			continue
		}

		if extractResult.IsBinary {
			progress.FilesBinary++
		}

		// Chunk the text BEFORE the file upsert so chunk_count is persisted (L1).
		chunks := p.chunker.ChunkText(extractResult.Text, "")

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
			ChunkCount:  len(chunks),
		}

		if extractResult.Encoding != "" {
			localFile.Encoding = &extractResult.Encoding
		}

		// For modified files, delete old chunks first (T029)
		if delta.Action == DeltaModified && delta.Stored != nil && p.chunkStore != nil {
			if err := p.deleteChunksByLocalFileID(ctx, delta.Stored.ID); err != nil {
				p.logger.Error("failed to delete old chunks", "file_id", delta.Stored.ID)
			}
		}

		// Store local file first to get its ID
		if err := p.fileStore.Upsert(ctx, localFile); err != nil {
			p.logger.Error("file upsert failed", "file", RedactPath(absPath, source.FolderPath))
			progress.FilesSkipped++
			continue
		}

		// Re-fetch the file to get its ID
		storedFile, err := p.fileStore.GetByRelPath(ctx, source.ID, entry.RelPath)
		if err != nil || storedFile == nil {
			p.logger.Error("file retrieval failed", "file", RedactPath(absPath, source.FolderPath))
			progress.FilesSkipped++
			continue
		}

		// T044: Upsert LocalDocument node in Neo4j for Added/Modified files
		if (delta.Action == DeltaAdded || delta.Action == DeltaModified) && p.neo4jClient != nil {
			if err := p.neo4jClient.UpsertDocument(ctx, storedFile); err != nil {
				p.logger.Error("failed to upsert document to Neo4j", "file_id", storedFile.ID)
				// Non-fatal: continue with import even if Neo4j fails
			}

			// T046: Extract entities using NLP and create MENTIONS relationships
			if p.nlpExtractor != nil && !extractResult.IsBinary {
				p.extractAndCreateMentions(ctx, storedFile.ID, extractResult.Text)
			}
		}

		// C1: store chunks against the LOCAL file id (file_id NULL, local_file_id set) — never
		// file_id=0, which violated the m365_files FK and dropped every local chunk. Returns the
		// new chunk ids so C2 can embed them.
		if len(chunks) > 0 && p.chunkStore != nil {
			chunkDataList := make([]metadata.ChunkData, len(chunks))
			for i, chunk := range chunks {
				chunkDataList[i] = metadata.ChunkData{
					ChunkIndex:  i,
					Text:        chunk.Text,
					ContentHash: computeHash([]byte(chunk.Text)),
					HeadingPath: chunk.HeadingPath,
				}
			}

			chunkIDs, err := p.chunkStore.CreateBatchLocal(ctx, storedFile.ID, chunkDataList)
			if err != nil {
				p.logger.Error("chunk insert failed", "file", RedactPath(absPath, source.FolderPath))
				progress.FilesSkipped++
				continue
			}

			// C2: embed the new chunks so local content is semantically searchable. Best-effort:
			// a nil embedder (no llm-svc) or an embed error never fails the import.
			p.embedChunks(ctx, chunkIDs, chunkDataList)
		}

		if delta.Action == DeltaAdded {
			progress.FilesAdded++
		} else if delta.Action == DeltaModified {
			progress.FilesModified++
		}

		// Update progress every 50 files
		if (progress.FilesAdded+progress.FilesModified)%50 == 0 {
			total := progress.FilesTotal
			if total > 0 {
				progress.ProgressPct = (progress.FilesAdded + progress.FilesModified) * 100 / total
			}
			if err := p.jobStore.UpdateProgress(ctx, job.ID, progress); err != nil {
				p.logger.Error("progress update failed", "error", err)
			}
		}
	}

	// Drain any remaining scan errors (M5: log a generic class only — a raw walk error can
	// embed an absolute path).
	for err := range errChan {
		if err != nil {
			p.logger.Error("scan error (post-processing)")
		}
	}

	// T028: Handle delta-deleted files (files in DB but not on disk)
	if err := p.handleDeletedFiles(ctx, source.ID, scannedRelPaths, job.ID, &progress); err != nil {
		p.logger.Error("failed to handle deleted files", "error", err)
	}

	// Update final stats
	progress.ProgressPct = 100
	if err := p.jobStore.UpdateProgress(ctx, job.ID, progress); err != nil {
		p.logger.Error("final progress update failed", "error", err)
	}

	// Mark job as completed
	if err := p.jobStore.UpdateStatus(ctx, job.ID, JobCompleted); err != nil {
		return err
	}

	p.logger.Info("import completed", "job_id", job.ID, "files_added", progress.FilesAdded, "files_modified", progress.FilesModified, "files_deleted", progress.FilesDeleted)
	return nil
}

// deleteChunksByLocalFileID deletes all chunks associated with a local file (T029).
func (p *Processor) deleteChunksByLocalFileID(ctx context.Context, localFileID string) error {
	return p.chunkStore.DeleteByLocalFileID(ctx, localFileID)
}

// handleDeletedFiles detects files in DB but not on disk and marks them as deleted (T028).
func (p *Processor) handleDeletedFiles(ctx context.Context, sourceID string, scannedRelPaths map[string]bool, jobID string, progress *JobProgress) error {
	// Get all files from DB for this source
	dbFiles, err := p.fileStore.ListBySource(ctx, sourceID)
	if err != nil {
		return fmt.Errorf("failed to list files from DB: %w", err)
	}

	// Find files that were in DB but not in current scan
	for _, dbFile := range dbFiles {
		if !scannedRelPaths[dbFile.RelPath] {
			// File was deleted from filesystem
			// T044: Delete the LocalDocument node from Neo4j
			if p.neo4jClient != nil {
				if err := p.neo4jClient.DeleteDocument(ctx, dbFile.ID); err != nil {
					p.logger.Error("failed to delete document from Neo4j", "error", err, "file_id", dbFile.ID)
					// Non-fatal: continue with cleanup even if Neo4j fails
				}
			}

			// Delete its chunks first
			if err := p.deleteChunksByLocalFileID(ctx, dbFile.ID); err != nil {
				p.logger.Error("failed to delete chunks for deleted file", "error", err, "file_id", dbFile.ID)
			}

			// Delete the local file record
			if err := p.fileStore.Delete(ctx, dbFile.ID); err != nil {
				p.logger.Error("failed to delete local file record", "error", err, "file_id", dbFile.ID)
				continue
			}

			progress.FilesDeleted++
			p.logger.Info("file marked as deleted", "file_id", dbFile.ID, "rel_path", dbFile.RelPath)
		}
	}

	return nil
}

// extractAndCreateMentions extracts entities from text and creates MENTIONS relationships in Neo4j (T046).
func (p *Processor) extractAndCreateMentions(ctx context.Context, localFileID string, text string) {
	if text == "" {
		return
	}

	// Extract entities from the document text
	extractionResult, err := p.nlpExtractor.Extract(ctx, text)
	if err != nil {
		p.logger.Error("entity extraction failed", "error", err, "file_id", localFileID)
		return
	}

	if extractionResult == nil || len(extractionResult.Entities) == 0 {
		return
	}

	// Create MENTIONS relationships for each extracted entity
	for _, entity := range extractionResult.Entities {
		if err := p.neo4jClient.CreateMentionsRelationship(ctx, localFileID, entity.Type, entity.Name, entity.Confidence); err != nil {
			p.logger.Error("failed to create MENTIONS relationship", "error", err, "file_id", localFileID, "entity", entity.Name)
			// Non-fatal: continue creating other relationships even if one fails
		}
	}
}

// embedChunks embeds the chunk texts and stores the vectors under the SAME embedding model that
// retrieval's SemanticSearch queries, so local content becomes semantically searchable. It is
// deliberately best-effort: when no embedder / embedding store / model is configured (e.g.
// llm-svc absent) it is a no-op, and any embed/store error is logged (non-secret) but never
// fails the import — the chunks are already persisted and remain keyword-searchable.
func (p *Processor) embedChunks(ctx context.Context, chunkIDs []int64, chunks []metadata.ChunkData) {
	if p.embedder == nil || p.embeddingStore == nil || p.embeddingModelID == 0 || len(chunkIDs) == 0 {
		return
	}
	texts := make([]string, len(chunks))
	for i, c := range chunks {
		texts[i] = c.Text
	}
	vecs, err := p.embedder.Embed(ctx, texts)
	if err != nil {
		p.logger.Warn("embedding failed for local chunks; stored without vectors", "count", len(chunkIDs))
		return
	}
	if len(vecs) != len(chunkIDs) {
		p.logger.Warn("embedding count mismatch; skipping vector store", "chunks", len(chunkIDs), "vecs", len(vecs))
		return
	}
	for i, id := range chunkIDs {
		if err := p.embeddingStore.SaveEmbedding(ctx, id, p.embeddingModelID, vecs[i]); err != nil {
			p.logger.Warn("failed to store embedding for local chunk")
			return
		}
	}
}

// computeHash returns the SHA-256 hash of data as a hex string.
func computeHash(data []byte) string {
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%x", hash)
}
