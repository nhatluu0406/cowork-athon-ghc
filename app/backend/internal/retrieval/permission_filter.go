package retrieval

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// PermissionFilter implements Stage 0 of the 8-stage retrieval pipeline.
// It filters results by the authenticated user's cached permissions (from
// permission_cache table populated during M365 ingestion).
//
// Per INVARIANT-1 (Correctness > Performance): permission filtering is
// enforced at retrieval time (stage 0), never as a post-filter on the final answer.
// This prevents leakage of access-denied information through error messages or
// response timing.
//
// Per spec.md §10 and contract.md §103: Every read endpoint is implicitly scoped
// by the caller's permission_cache entries. An empty permission set means the user
// has no access to any documents, which is returned as an empty result set (not
// an error).
type PermissionFilter struct {
	db *sql.DB
}

// NewPermissionFilter creates a new PermissionFilter with a database connection.
func NewPermissionFilter(db *sql.DB) *PermissionFilter {
	return &PermissionFilter{db: db}
}

// Filter returns the list of file IDs the user is permitted to access, based on
// the permission_cache table (populated during M365 delta sync). An empty slice
// indicates the user has no access to any documents.
//
// The permission cache staleness is tracked via last_sync_at timestamp. Currently,
// no explicit staleness check is enforced here (per spec.md §18.5, refresh is
// triggered on every delta sync cycle, maximum 5 minutes). Future versions may
// add a staleness threshold to trigger refresh.
func (pf *PermissionFilter) Filter(ctx context.Context, userID string) ([]int, error) {
	if userID == "" {
		return nil, fmt.Errorf("retrieval.PermissionFilter.Filter: userID is empty")
	}

	rows, err := pf.db.QueryContext(ctx,
		`SELECT file_id FROM permission_cache WHERE user_id = $1 ORDER BY file_id`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("retrieval.PermissionFilter.Filter: query permission_cache: %w", err)
	}
	defer rows.Close()

	var fileIDs []int
	for rows.Next() {
		var fid int
		if err := rows.Scan(&fid); err != nil {
			return nil, fmt.Errorf("retrieval.PermissionFilter.Filter: scan: %w", err)
		}
		fileIDs = append(fileIDs, fid)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("retrieval.PermissionFilter.Filter: iterate rows: %w", err)
	}

	slog.DebugContext(ctx, "permission filter",
		"user_id", userID, "allowed_files", len(fileIDs))
	return fileIDs, nil
}

// FilterWithStalenessCheck returns file IDs for the user, but only if the
// permission cache entries are not stale (not older than maxStaleness).
// This is a future enhancement for explicit staleness management.
// For now, refresh is implicit (on every delta sync cycle per spec.md §18.5).
func (pf *PermissionFilter) FilterWithStalenessCheck(ctx context.Context, userID string, maxStaleness time.Duration) ([]int, error) {
	if userID == "" {
		return nil, fmt.Errorf("retrieval.PermissionFilter.FilterWithStalenessCheck: userID is empty")
	}

	rows, err := pf.db.QueryContext(ctx,
		`SELECT file_id, last_sync_at FROM permission_cache WHERE user_id = $1 ORDER BY file_id`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("retrieval.PermissionFilter.FilterWithStalenessCheck: query permission_cache: %w", err)
	}
	defer rows.Close()

	var fileIDs []int
	now := time.Now()

	for rows.Next() {
		var fid int
		var lastSyncAt time.Time
		if err := rows.Scan(&fid, &lastSyncAt); err != nil {
			return nil, fmt.Errorf("retrieval.PermissionFilter.FilterWithStalenessCheck: scan: %w", err)
		}

		// Check if entry is stale
		if now.Sub(lastSyncAt) > maxStaleness {
			slog.WarnContext(ctx, "skipping stale permission entry",
				"user_id", userID, "file_id", fid, "age", now.Sub(lastSyncAt))
			continue
		}

		fileIDs = append(fileIDs, fid)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("retrieval.PermissionFilter.FilterWithStalenessCheck: iterate rows: %w", err)
	}

	slog.DebugContext(ctx, "permission filter (with staleness check)",
		"user_id", userID, "allowed_files", len(fileIDs), "max_staleness", maxStaleness)
	return fileIDs, nil
}
