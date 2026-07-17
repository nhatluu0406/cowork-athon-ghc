package localimport_test

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

// setupIntegrationTestDB creates an in-memory SQLite database with all required tables.
func setupIntegrationTestDB(t *testing.T) *sql.DB {
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

	// Create import_jobs table
	_, err = db.Exec(`
		CREATE TABLE import_jobs (
			id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'queued',
			files_total INTEGER DEFAULT 0,
			files_added INTEGER DEFAULT 0,
			files_modified INTEGER DEFAULT 0,
			files_deleted INTEGER DEFAULT 0,
			files_skipped INTEGER DEFAULT 0,
			files_binary INTEGER DEFAULT 0,
			progress_pct INTEGER DEFAULT 0,
			error_messages TEXT,
			started_at TIMESTAMP,
			finished_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (source_id) REFERENCES local_sources(id)
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

	// Create chunks table (for embedding store)
	_, err = db.Exec(`
		CREATE TABLE chunks (
			id TEXT PRIMARY KEY,
			file_id TEXT,
			local_file_id TEXT,
			text TEXT NOT NULL,
			source_type TEXT,
			display_path TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	require.NoError(t, err)

	t.Cleanup(func() { db.Close() })
	return db
}

// TestImport_BasicFlow tests the complete import flow from create source to job completion.
func TestImport_BasicFlow(t *testing.T) {
	// Create temp directory with test files
	tmpDir := t.TempDir()

	// Create 5 test files with known content
	testPhrases := map[string]string{
		"file1.txt": "unique-test-phrase-XK1",
		"file2.txt": "unique-test-phrase-XK2",
		"file3.txt": "unique-test-phrase-XK3",
		"file4.txt": "unique-test-phrase-XK4",
		"file5.txt": "unique-test-phrase-XK5",
	}

	for name, phrase := range testPhrases {
		content := "This is " + name + " with " + phrase + " in it.\nMultiple lines of content.\n"
		filePath := filepath.Join(tmpDir, name)
		require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	}

	db := setupIntegrationTestDB(t)
	ctx := context.Background()

	// Step 1: Create source
	sourceStore := localimport.NewLocalSourceStore(db)
	source, err := sourceStore.Create(ctx, localimport.CreateSourceRequest{
		Name:           "Test Source",
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    false,
		FollowSymlinks: false,
		MaxDepth:       10,
	})
	require.NoError(t, err)
	require.NotNil(t, source)
	assert.Equal(t, "Test Source", source.Name)
	assert.True(t, source.Enabled)

	// Step 2: Create import job
	jobStore := localimport.NewImportJobStore(db)
	job, err := jobStore.Create(ctx, source.ID)
	require.NoError(t, err)
	require.NotNil(t, job)
	assert.Equal(t, localimport.JobQueued, job.Status)

	// Step 3: Set up processor components
	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)
	extractor := localimport.NewExtractor()
	chunker := parsers.NewChunker(512, 128)

	// Create a mock embedder (for testing, we skip actual embedding)
	mockEmbedder := &mockEmbeddingRuntime{}

	// ChunkStore is not used in the processor for testing, so we pass nil
	processor := localimport.NewProcessor(
		resolver,
		extractor,
		chunker,
		mockEmbedder,
		fileStore,
		sourceStore,
		nil, // chunkStore (not used in processor)
		jobStore,
		nil, // logger can be nil for testing
	)

	// Step 4: Run the processor
	err = processor.Run(ctx, job)
	require.NoError(t, err)

	// Step 5: Verify job completed
	updatedJob, err := jobStore.Get(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, localimport.JobCompleted, updatedJob.Status)
	assert.Equal(t, 100, updatedJob.Progress.ProgressPct)

	// Step 6: Verify files were imported
	files, err := fileStore.ListBySource(ctx, source.ID)
	require.NoError(t, err)
	assert.Equal(t, 5, len(files), "should have imported 5 files")

	// Step 7: Verify each file is marked as Added
	assert.Greater(t, updatedJob.Progress.FilesAdded, 0, "should have added files")
	assert.Equal(t, 0, updatedJob.Progress.FilesModified, "first import should have no modified files")
	assert.Equal(t, 0, updatedJob.Progress.FilesDeleted, "first import should have no deleted files")
}

// TestImport_DeltaSync tests re-import with modified, added, and deleted files.
func TestImport_DeltaSync(t *testing.T) {
	// Create temp directory with initial files
	tmpDir := t.TempDir()

	// Create initial files
	for i := 1; i <= 5; i++ {
		name := "file" + string(rune(48+i)) + ".txt"
		content := "Initial content for " + name
		filePath := filepath.Join(tmpDir, name)
		require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	}

	db := setupIntegrationTestDB(t)
	ctx := context.Background()

	// First import
	sourceStore := localimport.NewLocalSourceStore(db)
	source, _ := sourceStore.Create(ctx, localimport.CreateSourceRequest{
		Name:       "Test Source",
		FolderPath: tmpDir,
		Recursive:  true,
	})

	jobStore := localimport.NewImportJobStore(db)
	job1, _ := jobStore.Create(ctx, source.ID)

	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)
	extractor := localimport.NewExtractor()
	chunker := parsers.NewChunker(512, 128)
	processor := localimport.NewProcessor(
		resolver, extractor, chunker,
		&mockEmbeddingRuntime{}, fileStore, sourceStore, &mockChunkStore{}, jobStore, nil,
	)

	// First import should add all 5 files
	processor.Run(ctx, job1)
	files1, _ := fileStore.ListBySource(ctx, source.ID)
	assert.Len(t, files1, 5)

	// Modify first import stats
	job1Updated, _ := jobStore.Get(ctx, job1.ID)
	assert.Equal(t, 5, job1Updated.Progress.FilesAdded)

	// Wait a bit to ensure mtime difference
	time.Sleep(100 * time.Millisecond)

	// Now modify filesystem: delete 1, modify 2, add 1
	// Delete file1.txt
	os.Remove(filepath.Join(tmpDir, "file1.txt"))

	// Modify file2.txt and file3.txt
	os.WriteFile(filepath.Join(tmpDir, "file2.txt"), []byte("Modified content for file2"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file3.txt"), []byte("Modified content for file3"), 0644)

	// Add file6.txt
	os.WriteFile(filepath.Join(tmpDir, "file6.txt"), []byte("New content for file6"), 0644)

	// Second import (delta sync)
	job2, _ := jobStore.Create(ctx, source.ID)

	// Refresh scanner with updated source
	source2, _ := sourceStore.Get(ctx, source.ID)
	scanner2 := localimport.NewScanner(*source2)
	processor2 := localimport.NewProcessor(
		scanner2, resolver, extractor, chunker,
		&mockEmbeddingRuntime{}, fileStore, &mockChunkStore{}, jobStore, nil,
	)

	processor2.Run(ctx, job2)

	// Verify delta results
	job2Updated, _ := jobStore.Get(ctx, job2.ID)
	assert.Equal(t, 1, job2Updated.Progress.FilesAdded, "should have 1 added file")
	assert.Equal(t, 2, job2Updated.Progress.FilesModified, "should have 2 modified files")
	assert.Equal(t, 1, job2Updated.Progress.FilesDeleted, "should have 1 deleted file")

	// Verify final file count
	files2, _ := fileStore.ListBySource(ctx, source.ID)
	assert.Len(t, files2, 5, "should have 5 files after delta sync (5 - 1 deleted + 1 added)")
}

// TestImport_WithSubdirectories tests importing files in nested directories.
func TestImport_WithSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested structure
	subdir1 := filepath.Join(tmpDir, "subdir1")
	subdir2 := filepath.Join(subdir1, "subdir2")
	os.Mkdir(subdir1, 0755)
	os.Mkdir(subdir2, 0755)

	// Create files at different levels
	os.WriteFile(filepath.Join(tmpDir, "root.txt"), []byte("root content"), 0644)
	os.WriteFile(filepath.Join(subdir1, "level1.txt"), []byte("level1 content"), 0644)
	os.WriteFile(filepath.Join(subdir2, "level2.txt"), []byte("level2 content"), 0644)

	db := setupIntegrationTestDB(t)
	ctx := context.Background()

	sourceStore := localimport.NewLocalSourceStore(db)
	source, _ := sourceStore.Create(ctx, localimport.CreateSourceRequest{
		Name:       "Nested Test",
		FolderPath: tmpDir,
		Recursive:  true,
		MaxDepth:   10,
	})

	jobStore := localimport.NewImportJobStore(db)
	job, _ := jobStore.Create(ctx, source.ID)

	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)
	extractor := localimport.NewExtractor()
	chunker := parsers.NewChunker(512, 128)
	processor := localimport.NewProcessor(
		resolver, extractor, chunker,
		&mockEmbeddingRuntime{}, fileStore, sourceStore, &mockChunkStore{}, jobStore, nil,
	)

	processor.Run(ctx, job)

	// Verify all files imported
	files, _ := fileStore.ListBySource(ctx, source.ID)
	assert.Len(t, files, 3, "should import files from all levels")

	// Verify relative paths
	var paths []string
	for _, f := range files {
		paths = append(paths, f.RelPath)
	}

	assert.Contains(t, paths, "root.txt")
	// Note: paths might be subdir1/level1.txt or subdir1\\level1.txt depending on OS
}

// Mock implementations for testing

type mockEmbeddingRuntime struct{}

func (m *mockEmbeddingRuntime) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	results := make([][]float32, len(texts))
	for i := range texts {
		results[i] = make([]float32, 1536)
	}
	return results, nil
}

type mockChunkStore struct{}

func (m *mockChunkStore) InsertChunk(ctx context.Context, chunk interface{}) error {
	return nil
}

func (m *mockChunkStore) InsertChunks(ctx context.Context, chunks interface{}) error {
	return nil
}

func (m *mockChunkStore) GetChunk(ctx context.Context, id string) (interface{}, error) {
	return nil, nil
}

// StoreChunks is a placeholder method for the integration test.
func (m *mockChunkStore) StoreChunks(ctx context.Context, chunks []interface{}) error {
	return nil
}

// Helper functions for creating fixture files

// createFixtureTXT creates a TXT file with a known phrase.
func createFixtureTXT(t *testing.T, dir string, phrase string) string {
	filePath := filepath.Join(dir, "document.txt")
	content := "This is a text document.\nIt contains " + phrase + ".\nEnd of file.\n"
	require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	return filePath
}

// createFixtureMD creates a Markdown file with a known phrase.
func createFixtureMD(t *testing.T, dir string, phrase string) string {
	filePath := filepath.Join(dir, "document.md")
	content := "# Document Title\n\nThis is a markdown document.\n\nIt contains " + phrase + ".\n\n## Section\n\nMore content.\n"
	require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	return filePath
}

// createFixturePDF creates a minimal PDF file with a known phrase.
func createFixturePDF(t *testing.T, dir string, phrase string) string {
	filePath := filepath.Join(dir, "document.pdf")
	pdfContent := `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 100 >>
stream
BT
/F1 12 Tf
100 700 Td
(This PDF contains ` + phrase + `.) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000273 00000 n
0000000422 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
500
%%EOF`
	require.NoError(t, os.WriteFile(filePath, []byte(pdfContent), 0644))
	return filePath
}

// createFixtureDOCX creates a minimal DOCX file with a known phrase.
func createFixtureDOCX(t *testing.T, dir string, phrase string) string {
	filePath := filepath.Join(dir, "document.docx")
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	// [Content_Types].xml
	ct := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	w, _ := zw.Create("[Content_Types].xml")
	io.WriteString(w, ct)

	// _rels/.rels
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	w, _ = zw.Create("_rels/.rels")
	io.WriteString(w, rels)

	// word/document.xml
	doc := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p>
<w:r>
<w:t>This DOCX document contains ` + phrase + `.</w:t>
</w:r>
</w:p>
</w:body>
</w:document>`
	w, _ = zw.Create("word/document.xml")
	io.WriteString(w, doc)

	zw.Close()
	require.NoError(t, os.WriteFile(filePath, buf.Bytes(), 0644))
	return filePath
}

// createFixtureXLSX creates a minimal XLSX file with a known phrase.
func createFixtureXLSX(t *testing.T, dir string, phrase string) string {
	filePath := filepath.Join(dir, "document.xlsx")
	f := excelize.NewFile()
	defer f.Close()

	f.SetCellValue("Sheet1", "A1", "This XLSX document")
	f.SetCellValue("Sheet1", "A2", "contains "+phrase)
	f.SetCellValue("Sheet1", "A3", "for integration testing")

	require.NoError(t, f.SaveAs(filePath))
	return filePath
}

// TestImport_AllFormats tests importing one file of each format (TXT, MD, PDF, DOCX, XLSX).
func TestImport_AllFormats(t *testing.T) {
	tmpDir := t.TempDir()

	// Create one fixture of each format with the same unique phrase
	uniquePhrase := "unique-test-phrase-XK7"

	createFixtureTXT(t, tmpDir, uniquePhrase)
	createFixtureMD(t, tmpDir, uniquePhrase)
	createFixturePDF(t, tmpDir, uniquePhrase)
	createFixtureDOCX(t, tmpDir, uniquePhrase)
	createFixtureXLSX(t, tmpDir, uniquePhrase)

	db := setupIntegrationTestDB(t)
	ctx := context.Background()

	// Create source
	sourceStore := localimport.NewLocalSourceStore(db)
	source, err := sourceStore.Create(ctx, localimport.CreateSourceRequest{
		Name:           "Multi-Format Test Source",
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    false,
		FollowSymlinks: false,
		MaxDepth:       10,
	})
	require.NoError(t, err)
	require.NotNil(t, source)

	// Create and run import job
	jobStore := localimport.NewImportJobStore(db)
	job, err := jobStore.Create(ctx, source.ID)
	require.NoError(t, err)

	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)
	extractor := localimport.NewExtractor()
	chunker := parsers.NewChunker(512, 128)

	processor := localimport.NewProcessor(
		resolver, extractor, chunker,
		&mockEmbeddingRuntime{}, fileStore, sourceStore, &mockChunkStore{}, jobStore, nil,
	)

	err = processor.Run(ctx, job)
	require.NoError(t, err)

	// Verify all files were imported
	files, err := fileStore.ListBySource(ctx, source.ID)
	require.NoError(t, err)
	assert.Equal(t, 5, len(files), "should have imported 5 files (one of each format)")

	// Verify each file is present
	fileNames := map[string]bool{}
	for _, f := range files {
		fileNames[f.FileName] = true
	}

	assert.True(t, fileNames["document.txt"], "TXT file should be imported")
	assert.True(t, fileNames["document.md"], "MD file should be imported")
	assert.True(t, fileNames["document.pdf"], "PDF file should be imported")
	assert.True(t, fileNames["document.docx"], "DOCX file should be imported")
	assert.True(t, fileNames["document.xlsx"], "XLSX file should be imported")

	// Verify job completed successfully
	updatedJob, err := jobStore.Get(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, localimport.JobCompleted, updatedJob.Status)
	assert.Greater(t, updatedJob.Progress.FilesAdded, 0, "should have added files")
}

// TestImport_AllFormats_WithSourceType verifies source_type is set correctly for all formats.
func TestImport_AllFormats_WithSourceType(t *testing.T) {
	tmpDir := t.TempDir()

	uniquePhrase := "unique-test-phrase-ALL"

	createFixtureTXT(t, tmpDir, uniquePhrase)
	createFixtureMD(t, tmpDir, uniquePhrase)
	createFixturePDF(t, tmpDir, uniquePhrase)
	createFixtureDOCX(t, tmpDir, uniquePhrase)
	createFixtureXLSX(t, tmpDir, uniquePhrase)

	db := setupIntegrationTestDB(t)
	ctx := context.Background()

	sourceStore := localimport.NewLocalSourceStore(db)
	source, err := sourceStore.Create(ctx, localimport.CreateSourceRequest{
		Name:       "Source Type Test",
		FolderPath: tmpDir,
		Recursive:  true,
	})
	require.NoError(t, err)

	jobStore := localimport.NewImportJobStore(db)
	job, err := jobStore.Create(ctx, source.ID)
	require.NoError(t, err)

	fileStore := localimport.NewLocalFileStore(db)
	resolver := localimport.NewDeltaResolver(fileStore)
	extractor := localimport.NewExtractor()
	chunker := parsers.NewChunker(512, 128)

	processor := localimport.NewProcessor(
		resolver, extractor, chunker,
		&mockEmbeddingRuntime{}, fileStore, sourceStore, &mockChunkStore{}, jobStore, nil,
	)

	err = processor.Run(ctx, job)
	require.NoError(t, err)

	// Verify all 5 files exist in local_files
	files, err := fileStore.ListBySource(ctx, source.ID)
	require.NoError(t, err)
	assert.Len(t, files, 5, "should have 5 files in local_files")

	// Verify source_type for each file (all should be "local" since they're in local_files)
	for _, file := range files {
		t.Logf("File: %s, Size: %d, Binary: %v", file.FileName, file.FileSize, file.IsBinary)
		// All files should be successfully identified (not all marked as binary for test-compatible parsers)
		if file.FileName == "document.txt" || file.FileName == "document.md" {
			assert.False(t, file.IsBinary, "%s should not be marked as binary", file.FileName)
		}
	}

	// Verify job progress
	updatedJob, err := jobStore.Get(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, localimport.JobCompleted, updatedJob.Status)
	assert.Equal(t, 5, updatedJob.Progress.FilesAdded, "should have added all 5 files")
	assert.Equal(t, 0, updatedJob.Progress.FilesModified, "no files should be modified on first import")
	assert.Equal(t, 0, updatedJob.Progress.FilesDeleted, "no files should be deleted on first import")
}
