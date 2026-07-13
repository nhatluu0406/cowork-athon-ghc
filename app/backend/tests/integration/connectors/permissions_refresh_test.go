// +build integration

package connectors

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestPermissionExtractor_RefreshCache_MatchesDirectExtract (T190) guards
// against the T189 regression where RefreshCache used a placeholder
// driveID/itemID instead of resolving the real ones from m365_files. It
// asserts that, for the same set of files, calling RefreshCache produces
// IDENTICAL permission_cache rows (same user IDs, same permission levels) as
// calling ExtractAndCache directly for each file with its correct
// driveID/itemID.
func TestPermissionExtractor_RefreshCache_MatchesDirectExtract(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	marker := fmt.Sprintf("t190-%d", time.Now().UnixNano())

	// Fake MS Graph server: returns permissions keyed by the driveID/itemID
	// path segments so we can detect whether the caller resolved the real
	// per-file IDs (as opposed to a shared placeholder).
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var perms []map[string]interface{}
		switch {
		case matchPath(r.URL.Path, "drive-a", "item-a"):
			perms = []map[string]interface{}{
				{"id": "p1", "roles": []string{"owner"}, "grantedTo": map[string]interface{}{
					"user": map[string]interface{}{"id": marker + "-user-a", "displayName": "A"},
				}},
			}
		case matchPath(r.URL.Path, "drive-b", "item-b"):
			perms = []map[string]interface{}{
				{"id": "p2", "roles": []string{"read"}, "grantedTo": map[string]interface{}{
					"user": map[string]interface{}{"id": marker + "-user-b", "displayName": "B"},
				}},
			}
		default:
			// Unknown/placeholder driveID+itemID combination: return empty,
			// simulating what a wrong/placeholder lookup would yield.
			perms = []map[string]interface{}{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"value": perms})
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(func() (string, error) { return "test-token", nil }, server.URL)
	extractor := connectors.NewPermissionExtractor(db, client)

	ctx := context.Background()

	insertFile := func(sourceID, driveID string) int {
		var id int
		err := db.QueryRowContext(ctx,
			`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at)
			 VALUES ('onedrive', $1, $2, $3, 'txt', 10, $4, now(), now()) RETURNING id`,
			marker+"-"+sourceID, driveID, marker+"-"+sourceID+".txt", marker+"-hash-"+sourceID).Scan(&id)
		if err != nil {
			t.Fatalf("insert m365_files: %v", err)
		}
		return id
	}

	fileA := insertFile("item-a", "drive-a")
	fileB := insertFile("item-b", "drive-b")

	// --- Path 1: call RefreshCache (exercises the batch resolution path) ---
	if err := extractor.RefreshCache(ctx); err != nil {
		t.Fatalf("RefreshCache failed: %v", err)
	}
	refreshRows := readPermCache(t, ctx, db, []int{fileA, fileB})

	// Clear the cache so we can independently verify via direct ExtractAndCache calls.
	if _, err := db.ExecContext(ctx, `DELETE FROM permission_cache WHERE file_id = ANY($1)`, pgIntArray([]int{fileA, fileB})); err != nil {
		t.Fatalf("cleanup permission_cache: %v", err)
	}

	// --- Path 2: call ExtractAndCache directly with the known-correct IDs ---
	if err := extractor.ExtractAndCache(ctx, fileA, "drive-a", "item-a"); err != nil {
		t.Fatalf("ExtractAndCache fileA: %v", err)
	}
	if err := extractor.ExtractAndCache(ctx, fileB, "drive-b", "item-b"); err != nil {
		t.Fatalf("ExtractAndCache fileB: %v", err)
	}
	directRows := readPermCache(t, ctx, db, []int{fileA, fileB})

	if len(refreshRows) == 0 {
		t.Fatalf("expected RefreshCache to populate permission_cache rows, got none (placeholder-ID regression?)")
	}
	if len(refreshRows) != len(directRows) {
		t.Fatalf("row count mismatch: RefreshCache=%d direct=%d", len(refreshRows), len(directRows))
	}
	for i := range refreshRows {
		if refreshRows[i] != directRows[i] {
			t.Errorf("row %d mismatch: RefreshCache=%+v direct=%+v", i, refreshRows[i], directRows[i])
		}
	}

	// Cleanup
	_, _ = db.ExecContext(ctx, `DELETE FROM permission_cache WHERE file_id = ANY($1)`, pgIntArray([]int{fileA, fileB}))
	_, _ = db.ExecContext(ctx, `DELETE FROM m365_files WHERE id = ANY($1)`, pgIntArray([]int{fileA, fileB}))
}

type permRow struct {
	UserID     string
	FileID     int
	Permission string
}

// readPermCache returns permission_cache rows for the given file IDs, ordered
// deterministically by (user_id, file_id) so two independent snapshots can be
// compared directly for equality.
func readPermCache(t *testing.T, ctx context.Context, db *sql.DB, fileIDs []int) []permRow {
	t.Helper()
	rows, err := db.QueryContext(ctx,
		`SELECT user_id, file_id, permission FROM permission_cache
		 WHERE file_id = ANY($1) ORDER BY user_id, file_id`,
		pgIntArray(fileIDs))
	if err != nil {
		t.Fatalf("readPermCache: query: %v", err)
	}
	defer rows.Close()

	var out []permRow
	for rows.Next() {
		var r permRow
		if err := rows.Scan(&r.UserID, &r.FileID, &r.Permission); err != nil {
			t.Fatalf("readPermCache: scan: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("readPermCache: iterate: %v", err)
	}
	return out
}

func matchPath(path, driveID, itemID string) bool {
	return path == fmt.Sprintf("/drives/%s/items/%s/permissions", driveID, itemID)
}

func pgIntArray(ids []int) string {
	s := "{"
	for i, id := range ids {
		if i > 0 {
			s += ","
		}
		s += fmt.Sprintf("%d", id)
	}
	return s + "}"
}
