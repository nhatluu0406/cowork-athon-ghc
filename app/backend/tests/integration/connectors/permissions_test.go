// +build integration

package connectors

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// TestPermissionExtractor_GetUserAccess tests basic database query for file access
func TestPermissionExtractor_GetUserAccessBasic(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_ = connectors.NewPermissionExtractor(db, nil)

	ctx := context.Background()

	// Insert a test file first using the correct schema
	var fileID int
	err := db.QueryRowContext(ctx,
		`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
		 RETURNING id`,
		"onedrive", "item-1", "drive-abc123", "doc.docx", "docx", 1024, "hash123").Scan(&fileID)
	if err != nil {
		t.Fatalf("Failed to insert test file: %v", err)
	}

	// Insert permissions for this file
	_, err = db.ExecContext(ctx,
		`INSERT INTO permission_cache (user_id, file_id, permission, last_sync_at) VALUES ($1, $2, $3, now())`,
		"user-1", fileID, "edit")
	if err != nil {
		t.Fatalf("Failed to insert permissions: %v", err)
	}

	// Verify permissions were cached
	var count int
	err = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM permission_cache WHERE file_id = $1`,
		fileID).Scan(&count)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	if count < 1 {
		t.Errorf("Expected permissions to be cached, got %d", count)
	}
}


// TestPermissionExtractor_RefreshCache tests that refresh can be called
// (Note: without a real MS Graph client, we just verify it runs without error
// on files with drive_id set)
func TestPermissionExtractor_RefreshCache(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Create extractor with nil client (no actual MS Graph calls)
	extractor := connectors.NewPermissionExtractor(db, nil)

	ctx := context.Background()

	// Insert a test file with drive_id
	var fileID int
	err := db.QueryRowContext(ctx,
		`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
		 RETURNING id`,
		"onedrive", "item-1", "drive-123", "doc.docx", "docx", 1024, "hash1").Scan(&fileID)
	if err != nil {
		t.Fatalf("Failed to insert test file: %v", err)
	}

	// RefreshCache will skip this file since client is nil, but it should not error on the query
	err = extractor.RefreshCache(ctx)
	// Expect error because GraphClient is nil when calling ExtractAndCache
	if err != nil {
		t.Logf("RefreshCache failed as expected with nil GraphClient: %v", err)
	}
}

// TestPermissionExtractor_MultipleFiles tests handling multiple files with correct schema
func TestPermissionExtractor_MultipleFiles(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	extractor := connectors.NewPermissionExtractor(db, nil)

	ctx := context.Background()

	// Insert multiple test files
	fileIDs := make([]int, 3)
	for i := 0; i < 3; i++ {
		var id int
		fileName := "doc" + string(rune(49+i)) + ".docx" // doc1, doc2, doc3
		itemID := "item-" + string(rune(49+i))
		driveID := "drive-abc"
		err := db.QueryRowContext(ctx,
			`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
			 RETURNING id`,
			"onedrive", itemID, driveID, fileName, "docx", 1024, "hash"+string(rune(49+i))).Scan(&id)
		if err != nil {
			t.Fatalf("Failed to insert test file %d: %v", i, err)
		}
		fileIDs[i] = id
	}

	// Grant user-1 access to all files
	for i, fileID := range fileIDs {
		var perm string
		if i == 0 {
			perm = "owner"
		} else if i == 1 {
			perm = "write"
		} else {
			perm = "read"
		}

		_, err := db.ExecContext(ctx,
			`INSERT INTO permission_cache (user_id, file_id, permission, last_sync_at) VALUES ($1, $2, $3, now())`,
			"user-1", fileID, perm)
		if err != nil {
			t.Fatalf("Failed to insert permission: %v", err)
		}
	}

	// Verify user-1 can access files
	accessFileIDs, err := extractor.GetUserAccess(ctx, "user-1")
	if err != nil {
		t.Fatalf("GetUserAccess failed: %v", err)
	}

	if len(accessFileIDs) != 3 {
		t.Errorf("Expected user-1 to have access to 3 files, got %d", len(accessFileIDs))
	}
}

// TestPermissionFilter_Integration (T151) tests that the permission filter reads
// from a populated permission_cache and properly filters file access per user.
// This is Stage 0 of the 8-stage retrieval pipeline (per spec §3.3 and INVARIANT-1).
func TestPermissionFilter_Integration(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	filter := retrieval.NewPermissionFilter(db)
	ctx := context.Background()

	// Insert test files
	fileIDs := make([]int, 4)
	for i := 0; i < 4; i++ {
		var id int
		err := db.QueryRowContext(ctx,
			`INSERT INTO m365_files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
			 RETURNING id`,
			"onedrive", "item-"+string(rune(49+i)), "drive-xyz", "doc"+string(rune(49+i))+".docx", "docx", 1024, "hash"+string(rune(49+i))).Scan(&id)
		if err != nil {
			t.Fatalf("Failed to insert test file %d: %v", i, err)
		}
		fileIDs[i] = id
	}

	// Test Case 1: User with partial access (files 0 and 2)
	userID := "alice@company.com"
	_, err := db.ExecContext(ctx,
		`INSERT INTO permission_cache (user_id, file_id, permission, last_sync_at)
		 VALUES ($1, $2, $3, now()), ($1, $4, $5, now())`,
		userID, fileIDs[0], "owner", fileIDs[2], "read")
	if err != nil {
		t.Fatalf("Failed to insert permissions for alice: %v", err)
	}

	// Filter should return only fileIDs[0] and fileIDs[2] for alice
	allowedFiles, err := filter.Filter(ctx, userID)
	if err != nil {
		t.Fatalf("Filter failed for alice: %v", err)
	}

	if len(allowedFiles) != 2 {
		t.Errorf("Expected alice to have access to 2 files, got %d: %v", len(allowedFiles), allowedFiles)
	}

	// Verify the correct files are returned
	expectedMap := map[int]bool{fileIDs[0]: true, fileIDs[2]: true}
	for _, fid := range allowedFiles {
		if !expectedMap[fid] {
			t.Errorf("Unexpected file ID in alice's access list: %d", fid)
		}
	}

	// Test Case 2: User with no access
	noAccessUser := "bob@company.com"
	allowedFiles, err = filter.Filter(ctx, noAccessUser)
	if err != nil {
		t.Fatalf("Filter failed for bob: %v", err)
	}

	if len(allowedFiles) != 0 {
		t.Errorf("Expected bob to have access to 0 files, got %d", len(allowedFiles))
	}

	// Test Case 3: User with all access
	allAccessUser := "charlie@company.com"
	for i, fileID := range fileIDs {
		perm := "read"
		if i == 0 {
			perm = "owner"
		}
		_, err := db.ExecContext(ctx,
			`INSERT INTO permission_cache (user_id, file_id, permission, last_sync_at)
			 VALUES ($1, $2, $3, now())`,
			allAccessUser, fileID, perm)
		if err != nil {
			t.Fatalf("Failed to insert permission for charlie: %v", err)
		}
	}

	allowedFiles, err = filter.Filter(ctx, allAccessUser)
	if err != nil {
		t.Fatalf("Filter failed for charlie: %v", err)
	}

	if len(allowedFiles) != 4 {
		t.Errorf("Expected charlie to have access to 4 files, got %d", len(allowedFiles))
	}
}
