package localimport_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTestDB creates an in-memory SQLite database with local_files table.
func setupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite3", ":memory:")
	require.NoError(t, err)

	// Create local_sources table
	_, err = db.Exec(`
		CREATE TABLE local_sources (
			id TEXT PRIMARY KEY,
			folder_path TEXT NOT NULL,
			name TEXT NOT NULL,
			enabled BOOLEAN DEFAULT true,
			recursive BOOLEAN DEFAULT true,
			hidden_files BOOLEAN DEFAULT false,
			follow_symlinks BOOLEAN DEFAULT false,
			max_depth INTEGER DEFAULT 10,
			include_ext TEXT,
			exclude_ext TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	require.NoError(t, err)

	// Create local_files table
	_, err = db.Exec(`
		CREATE TABLE local_files (
			id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			rel_path TEXT NOT NULL,
			file_name TEXT NOT NULL,
			file_size INTEGER NOT NULL,
			mtime TIMESTAMP NOT NULL,
			mime_type TEXT,
			encoding TEXT,
			is_binary BOOLEAN DEFAULT false,
			content_hash TEXT,
			chunk_count INTEGER DEFAULT 0,
			imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (source_id) REFERENCES local_sources(id),
			UNIQUE(source_id, rel_path)
		)
	`)
	require.NoError(t, err)

	t.Cleanup(func() { db.Close() })
	return db
}

// TestDeltaResolver_Classify_NewFile tests classification of a new file.
func TestDeltaResolver_Classify_NewFile(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-1"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	// Classify a file that doesn't exist in DB
	entry := localimport.ScanEntry{
		RelPath:   "new_file.txt",
		FileName:  "new_file.txt",
		Size:      100,
		Mtime:     time.Now(),
		IsDir:     false,
		IsSymlink: false,
	}

	ctx := context.Background()
	result, err := resolver.Classify(ctx, sourceID, entry)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaAdded, result.Action)
	assert.Equal(t, "new_file.txt", result.Entry.FileName)
}

// TestDeltaResolver_Classify_UnchangedFile tests that unchanged files are detected.
func TestDeltaResolver_Classify_UnchangedFile(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-2"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	// Insert a file
	mtime := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err = db.Exec(
		`INSERT INTO local_files (id, source_id, rel_path, file_name, file_size, mtime, mime_type, is_binary, content_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"file-1", sourceID, "unchanged.txt", "unchanged.txt", 100, mtime, "text/plain", false, "abc123",
	)
	require.NoError(t, err)

	// Classify the same file with same mtime and size
	entry := localimport.ScanEntry{
		RelPath:   "unchanged.txt",
		FileName:  "unchanged.txt",
		Size:      100,
		Mtime:     mtime,
		IsDir:     false,
		IsSymlink: false,
	}

	ctx := context.Background()
	result, err := resolver.Classify(ctx, sourceID, entry)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaUnchanged, result.Action)
	assert.NotNil(t, result.Stored)
	assert.Equal(t, "unchanged.txt", result.Stored.FileName)
}

// TestDeltaResolver_Classify_ModifiedFile tests that modified files are detected.
func TestDeltaResolver_Classify_ModifiedFile(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-3"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	// Insert a file
	oldMtime := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err = db.Exec(
		`INSERT INTO local_files (id, source_id, rel_path, file_name, file_size, mtime, mime_type, is_binary, content_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"file-2", sourceID, "modified.txt", "modified.txt", 100, oldMtime, "text/plain", false, "old_hash",
	)
	require.NoError(t, err)

	// Classify with new mtime
	newMtime := time.Date(2024, 1, 2, 12, 0, 0, 0, time.UTC)
	entry := localimport.ScanEntry{
		RelPath:   "modified.txt",
		FileName:  "modified.txt",
		Size:      150, // Also changed size
		Mtime:     newMtime,
		IsDir:     false,
		IsSymlink: false,
	}

	ctx := context.Background()
	result, err := resolver.Classify(ctx, sourceID, entry)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaModified, result.Action)
	assert.NotNil(t, result.Stored)
}

// TestDeltaResolver_Classify_SizeSensitivity tests that size changes are detected.
func TestDeltaResolver_Classify_SizeSensitivity(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-4"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	// Insert a file
	mtime := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err = db.Exec(
		`INSERT INTO local_files (id, source_id, rel_path, file_name, file_size, mtime, mime_type, is_binary, content_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"file-3", sourceID, "sizechg.txt", "sizechg.txt", 100, mtime, "text/plain", false, "hash",
	)
	require.NoError(t, err)

	// Classify with same mtime but different size
	entry := localimport.ScanEntry{
		RelPath:   "sizechg.txt",
		FileName:  "sizechg.txt",
		Size:      200, // Size changed
		Mtime:     mtime, // Same mtime
		IsDir:     false,
		IsSymlink: false,
	}

	ctx := context.Background()
	result, err := resolver.Classify(ctx, sourceID, entry)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaModified, result.Action, "size change should trigger Modified")
}

// TestDeltaResolver_Classify_TimestampSensitivity tests that mtime changes are detected.
func TestDeltaResolver_Classify_TimestampSensitivity(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-5"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	// Insert a file
	oldMtime := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err = db.Exec(
		`INSERT INTO local_files (id, source_id, rel_path, file_name, file_size, mtime, mime_type, is_binary, content_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"file-4", sourceID, "timechg.txt", "timechg.txt", 100, oldMtime, "text/plain", false, "hash",
	)
	require.NoError(t, err)

	// Classify with different mtime
	newMtime := time.Date(2024, 1, 1, 13, 0, 0, 0, time.UTC)
	entry := localimport.ScanEntry{
		RelPath:   "timechg.txt",
		FileName:  "timechg.txt",
		Size:      100, // Same size
		Mtime:     newMtime, // Different mtime
		IsDir:     false,
		IsSymlink: false,
	}

	ctx := context.Background()
	result, err := resolver.Classify(ctx, sourceID, entry)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaModified, result.Action, "mtime change should trigger Modified")
}

// TestDeltaResolver_FullCycle tests a complete add/modify/unchanged cycle.
func TestDeltaResolver_FullCycle(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)

	// Insert a source
	sourceID := "test-source-6"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	ctx := context.Background()

	// Step 1: New file -> DeltaAdded
	entry1 := localimport.ScanEntry{
		RelPath:   "file1.txt",
		FileName:  "file1.txt",
		Size:      100,
		Mtime:     time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC),
		IsDir:     false,
		IsSymlink: false,
	}
	result1, err := resolver.Classify(ctx, sourceID, entry1)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaAdded, result1.Action)

	// Insert the file
	_, err = db.Exec(
		`INSERT INTO local_files (id, source_id, rel_path, file_name, file_size, mtime, mime_type, is_binary, content_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"file-1", sourceID, "file1.txt", "file1.txt", 100, entry1.Mtime, "text/plain", false, "hash1",
	)
	require.NoError(t, err)

	// Step 2: Same file -> DeltaUnchanged
	result2, err := resolver.Classify(ctx, sourceID, entry1)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaUnchanged, result2.Action)

	// Step 3: Modify the file -> DeltaModified
	entry1Modified := localimport.ScanEntry{
		RelPath:   "file1.txt",
		FileName:  "file1.txt",
		Size:      200,
		Mtime:     time.Date(2024, 1, 2, 12, 0, 0, 0, time.UTC),
		IsDir:     false,
		IsSymlink: false,
	}
	result3, err := resolver.Classify(ctx, sourceID, entry1Modified)
	require.NoError(t, err)
	assert.Equal(t, localimport.DeltaModified, result3.Action)
}

// TestLocalFileStore_Upsert_Create tests creating a new file record.
func TestLocalFileStore_Upsert_Create(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)

	// Insert a source first
	sourceID := "test-source-7"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	ctx := context.Background()

	// Create a file record
	encoding := "UTF-8"
	file := localimport.LocalFile{
		SourceID:    sourceID,
		RelPath:     "test.txt",
		FileName:    "test.txt",
		FileSize:    100,
		Mtime:       time.Now(),
		MimeType:    "text/plain",
		Encoding:    &encoding,
		IsBinary:    false,
		ContentHash: "abc123",
		ChunkCount:  5,
	}

	err = fileStore.Upsert(ctx, file)
	require.NoError(t, err)

	// Verify it was stored
	stored, err := fileStore.GetByRelPath(ctx, sourceID, "test.txt")
	require.NoError(t, err)
	assert.NotNil(t, stored)
	assert.Equal(t, "test.txt", stored.FileName)
	assert.Equal(t, int64(100), stored.FileSize)
	assert.Equal(t, "UTF-8", *stored.Encoding)
}

// TestLocalFileStore_Upsert_Update tests updating an existing file record.
func TestLocalFileStore_Upsert_Update(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)

	// Insert a source
	sourceID := "test-source-8"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	ctx := context.Background()

	// Create initial file
	encoding := "UTF-8"
	file1 := localimport.LocalFile{
		SourceID:    sourceID,
		RelPath:     "test.txt",
		FileName:    "test.txt",
		FileSize:    100,
		Mtime:       time.Now(),
		MimeType:    "text/plain",
		Encoding:    &encoding,
		IsBinary:    false,
		ContentHash: "old_hash",
		ChunkCount:  5,
	}
	err = fileStore.Upsert(ctx, file1)
	require.NoError(t, err)

	// Update the same file (same source + rel_path)
	file2 := localimport.LocalFile{
		SourceID:    sourceID,
		RelPath:     "test.txt",
		FileName:    "test.txt",
		FileSize:    200, // Changed
		Mtime:       time.Now().Add(1 * time.Hour),
		MimeType:    "text/plain",
		Encoding:    &encoding,
		IsBinary:    false,
		ContentHash: "new_hash", // Changed
		ChunkCount:  10, // Changed
	}
	err = fileStore.Upsert(ctx, file2)
	require.NoError(t, err)

	// Verify the update
	stored, err := fileStore.GetByRelPath(ctx, sourceID, "test.txt")
	require.NoError(t, err)
	assert.NotNil(t, stored)
	assert.Equal(t, int64(200), stored.FileSize)
	assert.Equal(t, "new_hash", stored.ContentHash)
	assert.Equal(t, 10, stored.ChunkCount)
}

// TestLocalFileStore_Delete tests file deletion.
func TestLocalFileStore_Delete(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)

	// Insert a source
	sourceID := "test-source-9"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	ctx := context.Background()

	// Insert a file
	encoding := "UTF-8"
	file := localimport.LocalFile{
		SourceID:    sourceID,
		RelPath:     "test.txt",
		FileName:    "test.txt",
		FileSize:    100,
		Mtime:       time.Now(),
		MimeType:    "text/plain",
		Encoding:    &encoding,
		IsBinary:    false,
		ContentHash: "abc123",
		ChunkCount:  5,
	}
	err = fileStore.Upsert(ctx, file)
	require.NoError(t, err)

	// Get the file ID
	stored, err := fileStore.GetByRelPath(ctx, sourceID, "test.txt")
	require.NoError(t, err)
	require.NotNil(t, stored)

	// Delete it
	err = fileStore.Delete(ctx, stored.ID)
	require.NoError(t, err)

	// Verify it's gone
	result, err := fileStore.GetByRelPath(ctx, sourceID, "test.txt")
	require.NoError(t, err)
	assert.Nil(t, result)
}

// TestLocalFileStore_ListBySource tests listing files by source.
func TestLocalFileStore_ListBySource(t *testing.T) {
	db := setupTestDB(t)
	fileStore := localimport.NewLocalFileStore(db)

	// Insert a source
	sourceID := "test-source-10"
	_, err := db.Exec(
		"INSERT INTO local_sources (id, folder_path, name) VALUES (?, ?, ?)",
		sourceID, "/tmp/test", "Test Source",
	)
	require.NoError(t, err)

	ctx := context.Background()

	// Insert multiple files
	encoding := "UTF-8"
	for i := 0; i < 3; i++ {
		file := localimport.LocalFile{
			SourceID:    sourceID,
			RelPath:     "test" + string(rune(i)) + ".txt",
			FileName:    "test" + string(rune(i)) + ".txt",
			FileSize:    100,
			Mtime:       time.Now(),
			MimeType:    "text/plain",
			Encoding:    &encoding,
			IsBinary:    false,
			ContentHash: "hash" + string(rune(i)),
			ChunkCount:  5,
		}
		err := fileStore.Upsert(ctx, file)
		require.NoError(t, err)
	}

	// List all files for source
	files, err := fileStore.ListBySource(ctx, sourceID)
	require.NoError(t, err)
	assert.Len(t, files, 3)
}
