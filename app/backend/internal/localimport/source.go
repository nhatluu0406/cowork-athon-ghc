package localimport

import (
	"context"
	"database/sql"
	"time"

	"github.com/lib/pq"
)

// LocalSource represents a configured local folder as a document source.
type LocalSource struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	FolderPath    string     `json:"folder_path"`
	Recursive     bool       `json:"recursive"`
	IncludeExt    []string   `json:"include_ext,omitempty"`
	ExcludeExt    []string   `json:"exclude_ext,omitempty"`
	HiddenFiles   bool       `json:"hidden_files"`
	FollowSymlinks bool      `json:"follow_symlinks"`
	MaxDepth      int        `json:"max_depth"`
	Enabled       bool       `json:"enabled"`
	Status        string     `json:"status"` // "active" | "unavailable"
	LastSyncAt    *time.Time `json:"last_sync_at,omitempty"`
	FileCount     int        `json:"file_count"`
	TotalSize     int64      `json:"total_size"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// CreateSourceRequest is the request body for POST /api/local/sources.
type CreateSourceRequest struct {
	Name           string   `json:"name"`
	FolderPath     string   `json:"folder_path"`
	Recursive      bool     `json:"recursive,omitempty"`
	IncludeExt     []string `json:"include_ext,omitempty"`
	ExcludeExt     []string `json:"exclude_ext,omitempty"`
	HiddenFiles    bool     `json:"hidden_files,omitempty"`
	FollowSymlinks bool     `json:"follow_symlinks,omitempty"`
	MaxDepth       int      `json:"max_depth,omitempty"`
}

// PatchSourceRequest is the request body for PATCH /api/local/sources/{id}.
type PatchSourceRequest struct {
	Name           *string  `json:"name,omitempty"`
	Recursive      *bool    `json:"recursive,omitempty"`
	IncludeExt     []string `json:"include_ext,omitempty"`
	ExcludeExt     []string `json:"exclude_ext,omitempty"`
	HiddenFiles    *bool    `json:"hidden_files,omitempty"`
	FollowSymlinks *bool    `json:"follow_symlinks,omitempty"`
	MaxDepth       *int     `json:"max_depth,omitempty"`
	Enabled        *bool    `json:"enabled,omitempty"`
}

// LocalSourceStore handles database operations for local sources.
type LocalSourceStore struct {
	db *sql.DB
}

// NewLocalSourceStore creates a new LocalSourceStore.
func NewLocalSourceStore(db *sql.DB) *LocalSourceStore {
	return &LocalSourceStore{db: db}
}

// Create creates a new local source in the database.
func (s *LocalSourceStore) Create(ctx context.Context, req CreateSourceRequest) (*LocalSource, error) {
	source := &LocalSource{
		Name:           req.Name,
		FolderPath:     req.FolderPath,
		Recursive:      req.Recursive,
		IncludeExt:     req.IncludeExt,
		ExcludeExt:     req.ExcludeExt,
		HiddenFiles:    req.HiddenFiles,
		FollowSymlinks: req.FollowSymlinks,
		MaxDepth:       req.MaxDepth,
		Enabled:        true,
		Status:         "active",
		FileCount:      0,
		TotalSize:      0,
	}
	if source.MaxDepth == 0 {
		source.MaxDepth = 100
	}

	err := s.db.QueryRowContext(ctx,
		`INSERT INTO local_sources
		(name, folder_path, recursive, include_ext, exclude_ext, hidden_files, follow_symlinks, max_depth, enabled, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
		RETURNING id, created_at, updated_at`,
		source.Name, source.FolderPath, source.Recursive, pq.Array(source.IncludeExt), pq.Array(source.ExcludeExt),
		source.HiddenFiles, source.FollowSymlinks, source.MaxDepth, source.Enabled, source.Status,
	).Scan(&source.ID, &source.CreatedAt, &source.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return source, nil
}

// Get retrieves a local source by ID.
func (s *LocalSourceStore) Get(ctx context.Context, id string) (*LocalSource, error) {
	source := &LocalSource{}
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, folder_path, recursive, include_ext, exclude_ext, hidden_files, follow_symlinks, max_depth,
		enabled, status, last_sync_at, file_count, total_size, created_at, updated_at
		FROM local_sources WHERE id = $1`,
		id,
	).Scan(
		&source.ID, &source.Name, &source.FolderPath, &source.Recursive, pq.Array(&source.IncludeExt), pq.Array(&source.ExcludeExt),
		&source.HiddenFiles, &source.FollowSymlinks, &source.MaxDepth, &source.Enabled, &source.Status,
		&source.LastSyncAt, &source.FileCount, &source.TotalSize, &source.CreatedAt, &source.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return source, nil
}

// List retrieves all local sources.
func (s *LocalSourceStore) List(ctx context.Context) ([]LocalSource, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, folder_path, recursive, include_ext, exclude_ext, hidden_files, follow_symlinks, max_depth,
		enabled, status, last_sync_at, file_count, total_size, created_at, updated_at
		FROM local_sources ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sources []LocalSource
	for rows.Next() {
		source := LocalSource{}
		err := rows.Scan(
			&source.ID, &source.Name, &source.FolderPath, &source.Recursive, pq.Array(&source.IncludeExt), pq.Array(&source.ExcludeExt),
			&source.HiddenFiles, &source.FollowSymlinks, &source.MaxDepth, &source.Enabled, &source.Status,
			&source.LastSyncAt, &source.FileCount, &source.TotalSize, &source.CreatedAt, &source.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

// Update updates a local source configuration.
func (s *LocalSourceStore) Update(ctx context.Context, id string, patch PatchSourceRequest) (*LocalSource, error) {
	source, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if patch.Name != nil {
		source.Name = *patch.Name
	}
	if patch.Recursive != nil {
		source.Recursive = *patch.Recursive
	}
	if len(patch.IncludeExt) > 0 {
		source.IncludeExt = patch.IncludeExt
	}
	if len(patch.ExcludeExt) > 0 {
		source.ExcludeExt = patch.ExcludeExt
	}
	if patch.HiddenFiles != nil {
		source.HiddenFiles = *patch.HiddenFiles
	}
	if patch.FollowSymlinks != nil {
		source.FollowSymlinks = *patch.FollowSymlinks
	}
	if patch.MaxDepth != nil && *patch.MaxDepth > 0 {
		source.MaxDepth = *patch.MaxDepth
	}
	if patch.Enabled != nil {
		source.Enabled = *patch.Enabled
	}

	_, err = s.db.ExecContext(ctx,
		`UPDATE local_sources SET name = $1, recursive = $2, include_ext = $3, exclude_ext = $4,
		hidden_files = $5, follow_symlinks = $6, max_depth = $7, enabled = $8, updated_at = now()
		WHERE id = $9`,
		source.Name, source.Recursive, pq.Array(source.IncludeExt), pq.Array(source.ExcludeExt),
		source.HiddenFiles, source.FollowSymlinks, source.MaxDepth, source.Enabled, id,
	)
	if err != nil {
		return nil, err
	}

	source.UpdatedAt = time.Now()
	return source, nil
}

// Delete deletes a local source and cascades to import_jobs and local_files.
func (s *LocalSourceStore) Delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM local_sources WHERE id = $1`, id)
	return err
}

// UpdateStats updates file count and total size for a source.
func (s *LocalSourceStore) UpdateStats(ctx context.Context, id string, fileCount int, totalSize int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE local_sources SET file_count = $1, total_size = $2, last_sync_at = now(), updated_at = now() WHERE id = $3`,
		fileCount, totalSize, id,
	)
	return err
}

// SetStatus updates the status of a source.
func (s *LocalSourceStore) SetStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE local_sources SET status = $1, updated_at = now() WHERE id = $2`,
		status, id,
	)
	return err
}
