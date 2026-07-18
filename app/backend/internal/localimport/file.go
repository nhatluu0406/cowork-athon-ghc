package localimport

import (
	"context"
	"database/sql"
	"os"
	"time"
)

// LocalFile represents an imported file from a local source.
type LocalFile struct {
	ID          string    `json:"id"`
	SourceID    string    `json:"source_id"`
	RelPath     string    `json:"rel_path"`
	FileName    string    `json:"file_name"`
	FileSize    int64     `json:"file_size"`
	Mtime       time.Time `json:"mtime"`
	MimeType    string    `json:"mime_type"`
	Encoding    *string   `json:"encoding,omitempty"`
	IsBinary    bool      `json:"is_binary"`
	ContentHash string    `json:"content_hash"`
	ChunkCount  int       `json:"chunk_count"`
	ImportedAt  time.Time `json:"imported_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ScanEntry is an in-memory snapshot of a file during filesystem walk.
type ScanEntry struct {
	RelPath   string
	FileName  string
	Size      int64
	Mtime     time.Time
	IsDir     bool
	IsSymlink bool
	Mode      os.FileMode
}

// DeltaAction classifies a file's change state.
type DeltaAction int

const (
	DeltaAdded DeltaAction = iota
	DeltaModified
	DeltaUnchanged
	DeltaDeleted
)

// DeltaResult is the output of delta classification.
type DeltaResult struct {
	Entry  ScanEntry
	Action DeltaAction
	Stored *LocalFile
}

// LocalFileStore handles database operations for local files.
type LocalFileStore struct {
	db *sql.DB
}

// NewLocalFileStore creates a new LocalFileStore.
func NewLocalFileStore(db *sql.DB) *LocalFileStore {
	return &LocalFileStore{db: db}
}

// Upsert creates or updates a local file record.
func (s *LocalFileStore) Upsert(ctx context.Context, f LocalFile) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO local_files (source_id, rel_path, file_name, file_size, mtime, mime_type, encoding, is_binary, content_hash, chunk_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (source_id, rel_path) DO UPDATE SET
		file_size = $4, mtime = $5, mime_type = $6, encoding = $7, is_binary = $8, content_hash = $9, chunk_count = $10, updated_at = now()`,
		f.SourceID, f.RelPath, f.FileName, f.FileSize, f.Mtime, f.MimeType, f.Encoding, f.IsBinary, f.ContentHash, f.ChunkCount,
	)
	return err
}

// GetByRelPath retrieves a local file by source and relative path.
func (s *LocalFileStore) GetByRelPath(ctx context.Context, sourceID, relPath string) (*LocalFile, error) {
	f := &LocalFile{}
	err := s.db.QueryRowContext(ctx,
		`SELECT id, source_id, rel_path, file_name, file_size, mtime, mime_type, encoding, is_binary, content_hash, chunk_count, imported_at, updated_at
		FROM local_files WHERE source_id = $1 AND rel_path = $2`,
		sourceID, relPath,
	).Scan(&f.ID, &f.SourceID, &f.RelPath, &f.FileName, &f.FileSize, &f.Mtime, &f.MimeType, &f.Encoding, &f.IsBinary, &f.ContentHash, &f.ChunkCount, &f.ImportedAt, &f.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return f, nil
}

// ListBySource retrieves all local files for a source.
func (s *LocalFileStore) ListBySource(ctx context.Context, sourceID string) ([]LocalFile, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, source_id, rel_path, file_name, file_size, mtime, mime_type, encoding, is_binary, content_hash, chunk_count, imported_at, updated_at
		FROM local_files WHERE source_id = $1`,
		sourceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []LocalFile
	for rows.Next() {
		f := LocalFile{}
		err := rows.Scan(&f.ID, &f.SourceID, &f.RelPath, &f.FileName, &f.FileSize, &f.Mtime, &f.MimeType, &f.Encoding, &f.IsBinary, &f.ContentHash, &f.ChunkCount, &f.ImportedAt, &f.UpdatedAt)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, rows.Err()
}

// Delete removes a local file record.
func (s *LocalFileStore) Delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM local_files WHERE id = $1`, id)
	return err
}

// DeltaResolver classifies files as Added/Modified/Unchanged/Deleted.
type DeltaResolver struct {
	store *LocalFileStore
}

// NewDeltaResolver creates a new DeltaResolver.
func NewDeltaResolver(store *LocalFileStore) *DeltaResolver {
	return &DeltaResolver{store: store}
}

// Classify determines the delta action for a scanned file.
func (r *DeltaResolver) Classify(ctx context.Context, sourceID string, entry ScanEntry) (DeltaResult, error) {
	stored, err := r.store.GetByRelPath(ctx, sourceID, entry.RelPath)
	if err != nil {
		return DeltaResult{}, err
	}

	if stored == nil {
		return DeltaResult{Entry: entry, Action: DeltaAdded}, nil
	}

	if stored.Mtime.Equal(entry.Mtime) && stored.FileSize == entry.Size {
		return DeltaResult{Entry: entry, Action: DeltaUnchanged, Stored: stored}, nil
	}

	return DeltaResult{Entry: entry, Action: DeltaModified, Stored: stored}, nil
}
