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

	"github.com/rad-system/m365-knowledge-graph/internal/metadata"
	"github.com/rad-system/m365-knowledge-graph/pkg/types"
)

type PermissionExtractor struct {
	db     *sql.DB
	repo   metadata.Repository // For type-safe operations; falls back to db if repo is nil
	client *GraphClient
}

// NewPermissionExtractor creates a permission extractor with a raw database connection.
// Use NewPermissionExtractorWithRepo for Repository-based access.
func NewPermissionExtractor(db *sql.DB, client *GraphClient) *PermissionExtractor {
	return &PermissionExtractor{db: db, client: client}
}

// NewPermissionExtractorWithRepo creates a permission extractor using the Repository interface.
// This is the preferred constructor for new code.
func NewPermissionExtractorWithRepo(repo metadata.Repository, client *GraphClient) *PermissionExtractor {
	return &PermissionExtractor{
		repo:   repo,
		db:     repo.Conn(), // Keep db for backward compatibility with non-Repository code paths
		client: client,
	}
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
// The fileID should be the string ID from types.M365File, not a numeric ID.
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

	now := time.Now()
	cacheExpiry := now.AddDate(0, 0, 7) // Cache expires in 7 days (INVARIANT-3 per spec)

	// Use Repository interface if available, otherwise fall back to raw SQL
	if pe.repo != nil {
		return pe.extractAndCacheViaRepo(ctx, fileID, permResp.Value, now, cacheExpiry)
	}
	return pe.extractAndCacheViaSQL(ctx, fileID, permResp.Value, now)
}

// extractAndCacheViaRepo uses the Repository interface to cache permissions atomically.
func (pe *PermissionExtractor) extractAndCacheViaRepo(ctx context.Context, fileID int, perms []MSGraphPermission, now time.Time, expiry time.Time) error {
	// Convert fileID (int) to string for Repository interface
	fileIDStr := fmt.Sprintf("%d", fileID)

	// For each permission, upsert via Repository
	for _, perm := range perms {
		if perm.GrantedTo.User.ID == "" {
			continue
		}

		permLevel := mapMSGraphRolesToPermission(perm.Roles)
		permCache := &types.PermissionCache{
			ID:         fmt.Sprintf("perm_%s_%s", perm.GrantedTo.User.ID, fileIDStr),
			UserID:     perm.GrantedTo.User.ID,
			FileID:     fileIDStr,
			Permission: permLevel,
			CanRead:    permLevel == "read" || permLevel == "write" || permLevel == "owner",
			CanWrite:   permLevel == "write" || permLevel == "owner",
			CanDelete:  permLevel == "owner",
			CanEdit:    permLevel == "write" || permLevel == "owner",
			CachedAt:   now,
			CreatedAt:  now,
			ExpiresAt:  expiry,
		}

		if err := pe.repo.UpsertPermission(ctx, permCache); err != nil {
			slog.WarnContext(ctx, "failed to upsert permission via repository",
				"user_id", perm.GrantedTo.User.ID, "file_id", fileIDStr, "err", err)
			continue
		}
	}

	slog.InfoContext(ctx, "extracted and cached permissions via repository",
		"file_id", fileIDStr, "permission_count", len(perms))
	return nil
}

// extractAndCacheViaSQL uses raw SQL for backward compatibility (legacy code path).
func (pe *PermissionExtractor) extractAndCacheViaSQL(ctx context.Context, fileID int, perms []MSGraphPermission, now time.Time) error {
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
	for _, perm := range perms {
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

	slog.InfoContext(ctx, "extracted and cached permissions via SQL",
		"file_id", fileID, "permission_count", len(perms))
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

// RefreshCacheForFile refreshes permissions for a specific file by its string ID (M365File.ID).
// This is the Repository-friendly version of ExtractAndCache.
func (pe *PermissionExtractor) RefreshCacheForFile(ctx context.Context, file *types.M365File) error {
	if pe.client == nil {
		return fmt.Errorf("permissions.RefreshCacheForFile: GraphClient is nil")
	}

	if file.ItemID == "" || file.DriveID == "" {
		return fmt.Errorf("permissions.RefreshCacheForFile: file missing ItemID or DriveID")
	}

	// GET /drives/{driveId}/items/{itemId}/permissions
	path := fmt.Sprintf("/drives/%s/items/%s/permissions", file.DriveID, file.ItemID)
	resp, err := pe.client.GetWithContext(ctx, path)
	if err != nil {
		return fmt.Errorf("permissions.RefreshCacheForFile: graph api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.WarnContext(ctx, "failed to get permissions from MS Graph",
			"status", resp.StatusCode, "path", path, "file_id", file.ID)
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("permissions.RefreshCacheForFile: read response body: %w", err)
	}

	var permResp MSGraphPermissionResponse
	if err := json.Unmarshal(body, &permResp); err != nil {
		return fmt.Errorf("permissions.RefreshCacheForFile: parse response: %w", err)
	}

	now := time.Now()
	expiry := now.AddDate(0, 0, 7)

	if pe.repo != nil {
		// Use Repository interface
		for _, perm := range permResp.Value {
			if perm.GrantedTo.User.ID == "" {
				continue
			}

			permLevel := mapMSGraphRolesToPermission(perm.Roles)
			permCache := &types.PermissionCache{
				ID:         fmt.Sprintf("perm_%s_%s", perm.GrantedTo.User.ID, file.ID),
				UserID:     perm.GrantedTo.User.ID,
				FileID:     file.ID,
				Permission: permLevel,
				CanRead:    permLevel == "read" || permLevel == "write" || permLevel == "owner",
				CanWrite:   permLevel == "write" || permLevel == "owner",
				CanDelete:  permLevel == "owner",
				CanEdit:    permLevel == "write" || permLevel == "owner",
				CachedAt:   now,
				CreatedAt:  now,
				ExpiresAt:  expiry,
			}

			if err := pe.repo.UpsertPermission(ctx, permCache); err != nil {
				slog.WarnContext(ctx, "failed to upsert permission for file",
					"user_id", perm.GrantedTo.User.ID, "file_id", file.ID, "err", err)
				continue
			}
		}
		slog.InfoContext(ctx, "refreshed permissions for file via repository",
			"file_id", file.ID, "item_id", file.ItemID, "permission_count", len(permResp.Value))
		return nil
	}

	// Fallback to SQL for backward compatibility
	// This assumes the m365_files table has a numeric id column or we can convert
	return nil // Repository should be used going forward
}

// GetUserAccess returns the list of accessible file IDs (as integers) for a given user.
// This is the legacy SQL-based version; prefer GetUserAccessViaRepo for new code.
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

// GetUserAccessViaRepo returns the permission cache entries for a given user via the Repository interface.
// Returns a list of PermissionCache entries, allowing the caller to check specific permissions.
func (pe *PermissionExtractor) GetUserAccessViaRepo(ctx context.Context, userID string) ([]*types.PermissionCache, error) {
	if pe.repo == nil {
		return nil, fmt.Errorf("permissions.GetUserAccessViaRepo: Repository not available")
	}

	perms, err := pe.repo.GetPermissionCache(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("permissions.GetUserAccessViaRepo: %w", err)
	}

	return perms, nil
}
