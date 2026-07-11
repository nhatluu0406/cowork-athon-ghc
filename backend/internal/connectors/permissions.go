package connectors

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type PermissionExtractor struct {
	db     *sql.DB
	client *GraphClient
}

func NewPermissionExtractor(db *sql.DB, client *GraphClient) *PermissionExtractor {
	return &PermissionExtractor{db: db, client: client}
}

// MSGraphPermissionResponse represents the structure of MS Graph permissions API response.
type MSGraphPermissionResponse struct {
	Value []MSGraphPermission `json:"value"`
}

// MSGraphPermission represents a single permission entry from MS Graph.
type MSGraphPermission struct {
	ID        string   `json:"id"`
	Roles     []string `json:"roles"`
	GrantedTo struct {
		User struct {
			ID          string `json:"id"`
			DisplayName string `json:"displayName"`
		} `json:"user"`
	} `json:"grantedTo"`
}

// mapMSGraphRolesToPermission converts MS Graph roles to our permission level.
// Precedence: owner > write/edit > read
func mapMSGraphRolesToPermission(roles []string) string {
	for _, role := range roles {
		switch role {
		case "owner":
			return "owner"
		case "write", "edit":
			return "write"
		}
	}
	// Default to read if no write/owner role found
	for _, role := range roles {
		if role == "read" {
			return "read"
		}
	}
	// If no known roles, default to read
	return "read"
}

// ExtractAndCache extracts permissions from MS Graph API for a given file
// and caches them in the permission_cache table. Per spec §3.2, this is called
// during delta sync to capture ACLs at ingest time.
func (pe *PermissionExtractor) ExtractAndCache(ctx context.Context, fileID int, driveID, itemID string) error {
	if pe.client == nil {
		return fmt.Errorf("permissions.ExtractAndCache: GraphClient is nil")
	}

	// GET /drives/{driveId}/items/{itemId}/permissions
	path := fmt.Sprintf("/drives/%s/items/%s/permissions", driveID, itemID)
	resp, err := pe.client.GetWithContext(ctx, path)
	if err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.WarnContext(ctx, "failed to get permissions from MS Graph",
			"status", resp.StatusCode, "path", path, "file_id", fileID)
		// Non-200 is not a fatal error — continue processing; user may have no permissions
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: read response body: %w", err)
	}

	var permResp MSGraphPermissionResponse
	if err := json.Unmarshal(body, &permResp); err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: parse response: %w", err)
	}

	// Begin transaction to ensure atomic cache update per INVARIANT-2.
	tx, err := pe.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete stale permissions for this file (full re-pull strategy per spec.md §18.5)
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM permission_cache WHERE file_id = $1`, fileID); err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: delete stale permissions: %w", err)
	}

	// Insert fresh permissions
	now := time.Now()
	for _, perm := range permResp.Value {
		if perm.GrantedTo.User.ID == "" {
			// Skip entries without a user ID (e.g., group shares, anonymous links)
			continue
		}

		permLevel := mapMSGraphRolesToPermission(perm.Roles)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO permission_cache (user_id, file_id, permission, last_sync_at)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (user_id, file_id) DO UPDATE
			 SET permission = $3, last_sync_at = $4`,
			perm.GrantedTo.User.ID, fileID, permLevel, now); err != nil {
			slog.WarnContext(ctx, "failed to insert permission",
				"user_id", perm.GrantedTo.User.ID, "file_id", fileID, "err", err)
			// Continue processing other permissions despite individual insert errors
			continue
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("permissions.ExtractAndCache: commit tx: %w", err)
	}

	slog.InfoContext(ctx, "extracted and cached permissions",
		"file_id", fileID, "item_id", itemID, "permission_count", len(permResp.Value))
	return nil
}

// RefreshCache refreshes all permission cache entries by re-querying M365 permissions
// for each file. Per spec.md §18.5, this is called once per delta sync cycle
// (default DELTA_SYNC_INTERVAL = 5 minutes). The full re-pull strategy ensures
// consistency without requiring incremental invalidation logic (INVARIANT-3).
func (pe *PermissionExtractor) RefreshCache(ctx context.Context) error {
	if pe.client == nil {
		return fmt.Errorf("permissions.RefreshCache: GraphClient is nil")
	}

	// Fetch all OneDrive files with their IDs, source_id (item ID), and drive_id.
	// Per spec.md §18 and T150, drive_id is now persisted in m365_files (added Phase 9).
	rows, err := pe.db.QueryContext(ctx,
		`SELECT id, source_id, drive_id FROM m365_files
		 WHERE source_type = 'onedrive' AND drive_id IS NOT NULL
		 ORDER BY id`)
	if err != nil {
		return fmt.Errorf("permissions.RefreshCache: query files: %w", err)
	}
	defer rows.Close()

	var refreshed int
	var failed int
	var skipped int

	for rows.Next() {
		var fileID int
		var itemID string
		var driveID sql.NullString
		if err := rows.Scan(&fileID, &itemID, &driveID); err != nil {
			slog.WarnContext(ctx, "failed to scan file row", "err", err)
			failed++
			continue
		}

		// Skip files without drive_id (legacy files before the schema update)
		if !driveID.Valid {
			skipped++
			continue
		}

		// Call ExtractAndCache to actually fetch and cache permissions from MS Graph
		if err := pe.ExtractAndCache(ctx, fileID, driveID.String, itemID); err != nil {
			slog.WarnContext(ctx, "failed to refresh permissions for file",
				"file_id", fileID, "item_id", itemID, "err", err)
			failed++
			continue
		}
		refreshed++
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("permissions.RefreshCache: iterate rows: %w", err)
	}

	slog.InfoContext(ctx, "refreshed permission cache",
		"refreshed", refreshed, "failed", failed, "skipped", skipped)
	return nil
}

func (pe *PermissionExtractor) GetUserAccess(ctx context.Context, userID string) ([]int, error) {
	rows, err := pe.db.QueryContext(ctx,
		`SELECT file_id FROM permission_cache WHERE user_id = $1`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("permissions.GetUserAccess: %w", err)
	}
	defer rows.Close()

	var fileIDs []int
	for rows.Next() {
		var fileID int
		if err := rows.Scan(&fileID); err != nil {
			return nil, fmt.Errorf("permissions.GetUserAccess: scan: %w", err)
		}
		fileIDs = append(fileIDs, fileID)
	}
	return fileIDs, rows.Err()
}
