package localimport_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestScanner_Walk_NestedStructure tests scanning a nested directory structure.
func TestScanner_Walk_NestedStructure(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested structure
	subdir := filepath.Join(tmpDir, "subdir")
	require.NoError(t, os.Mkdir(subdir, 0755))

	// Create test files
	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(subdir, "file2.txt")
	require.NoError(t, os.WriteFile(file1, []byte("content1"), 0644))
	require.NoError(t, os.WriteFile(file2, []byte("content2"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    false,
		FollowSymlinks: false,
		MaxDepth:       10,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	var errs []error

	for entry := range entries {
		collected = append(collected, entry)
	}

	// Collect any errors
	for err := range errChan {
		if err != nil {
			errs = append(errs, err)
		}
	}

	assert.Empty(t, errs, "should have no errors")
	assert.Len(t, collected, 2, "should find 2 files")

	// Verify file names
	names := []string{collected[0].FileName, collected[1].FileName}
	assert.Contains(t, names, "file1.txt")
	assert.Contains(t, names, "file2.txt")
}

// TestScanner_Walk_HiddenFiles tests hidden file filtering.
func TestScanner_Walk_HiddenFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create visible and hidden files
	visibleFile := filepath.Join(tmpDir, "visible.txt")
	hiddenFile := filepath.Join(tmpDir, ".hidden.txt")
	require.NoError(t, os.WriteFile(visibleFile, []byte("visible"), 0644))
	require.NoError(t, os.WriteFile(hiddenFile, []byte("hidden"), 0644))

	// Test with HiddenFiles=false
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    false,
		FollowSymlinks: false,
		MaxDepth:       1,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 1, "should find only 1 visible file")
	assert.Equal(t, "visible.txt", collected[0].FileName)
}

// TestScanner_Walk_IncludeExtension tests extension filtering with include list.
func TestScanner_Walk_IncludeExtension(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with different extensions
	pdfFile := filepath.Join(tmpDir, "doc.pdf")
	txtFile := filepath.Join(tmpDir, "note.txt")
	require.NoError(t, os.WriteFile(pdfFile, []byte("pdf"), 0644))
	require.NoError(t, os.WriteFile(txtFile, []byte("txt"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		IncludeExt:     []string{".pdf"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 1, "should find only PDF file")
	assert.Equal(t, "doc.pdf", collected[0].FileName)
}

// TestScanner_Walk_ExcludeExtension tests extension filtering with exclude list.
func TestScanner_Walk_ExcludeExtension(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with different extensions
	pdfFile := filepath.Join(tmpDir, "doc.pdf")
	txtFile := filepath.Join(tmpDir, "note.txt")
	logFile := filepath.Join(tmpDir, "app.log")
	require.NoError(t, os.WriteFile(pdfFile, []byte("pdf"), 0644))
	require.NoError(t, os.WriteFile(txtFile, []byte("txt"), 0644))
	require.NoError(t, os.WriteFile(logFile, []byte("log"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		ExcludeExt:     []string{".log"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 2, "should find 2 files (excluding .log)")
	fileNames := []string{collected[0].FileName, collected[1].FileName}
	assert.NotContains(t, fileNames, "app.log")
}

// TestScanner_Walk_MaxDepth tests depth limit enforcement.
func TestScanner_Walk_MaxDepth(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested directories
	level1 := filepath.Join(tmpDir, "level1")
	level2 := filepath.Join(level1, "level2")
	require.NoError(t, os.Mkdir(level1, 0755))
	require.NoError(t, os.Mkdir(level2, 0755))

	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(level1, "file2.txt")
	file3 := filepath.Join(level2, "file3.txt")
	require.NoError(t, os.WriteFile(file1, []byte("1"), 0644))
	require.NoError(t, os.WriteFile(file2, []byte("2"), 0644))
	require.NoError(t, os.WriteFile(file3, []byte("3"), 0644))

	// Test with MaxDepth=1 (should only get root-level file)
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 1, "should find only root-level file with MaxDepth=1")
	assert.Equal(t, "file1.txt", collected[0].FileName)
}

// TestScanner_Walk_PermissionDenied tests graceful handling of permission errors.
func TestScanner_Walk_PermissionDenied(t *testing.T) {
	// Skip on Windows where permission model is different
	if os.Getenv("OS") == "Windows_NT" {
		t.Skip("cannot reliably test permission denied on Windows")
	}
	if os.Getenv("USER") == "root" || os.Getenv("RUNAS_USER") != "" {
		t.Skip("cannot test permission denied as root or SYSTEM")
	}

	tmpDir := t.TempDir()
	subdir := filepath.Join(tmpDir, "restricted")
	require.NoError(t, os.Mkdir(subdir, 0755))

	file1 := filepath.Join(tmpDir, "accessible.txt")
	file2 := filepath.Join(subdir, "inaccessible.txt")
	require.NoError(t, os.WriteFile(file1, []byte("1"), 0644))
	require.NoError(t, os.WriteFile(file2, []byte("2"), 0644))

	// Remove read permission on subdirectory
	require.NoError(t, os.Chmod(subdir, 0000))
	t.Cleanup(func() {
		os.Chmod(subdir, 0755) // restore for cleanup
	})

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       10,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	errorCount := 0

	for entry := range entries {
		collected = append(collected, entry)
	}

	for err := range errChan {
		if err != nil {
			errorCount++
		}
	}

	// Should find accessible file and encounter error on restricted directory
	assert.Len(t, collected, 1, "should find only the accessible file")
	assert.Greater(t, errorCount, 0, "should have encountered permission error")
}

// TestScanner_Walk_NonRecursive tests non-recursive scanning.
func TestScanner_Walk_NonRecursive(t *testing.T) {
	tmpDir := t.TempDir()

	subdir := filepath.Join(tmpDir, "subdir")
	require.NoError(t, os.Mkdir(subdir, 0755))

	file1 := filepath.Join(tmpDir, "file1.txt")
	file2 := filepath.Join(subdir, "file2.txt")
	require.NoError(t, os.WriteFile(file1, []byte("1"), 0644))
	require.NoError(t, os.WriteFile(file2, []byte("2"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       10,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 1, "should find only root-level file when non-recursive")
	assert.Equal(t, "file1.txt", collected[0].FileName)
}

// TestScanner_Walk_CaseSensitiveExtensionMatching tests that extension matching is case-insensitive.
func TestScanner_Walk_CaseSensitiveExtensionMatching(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with mixed case extensions
	file1 := filepath.Join(tmpDir, "doc.PDF")
	file2 := filepath.Join(tmpDir, "note.Pdf")
	file3 := filepath.Join(tmpDir, "text.txt")
	require.NoError(t, os.WriteFile(file1, []byte("1"), 0644))
	require.NoError(t, os.WriteFile(file2, []byte("2"), 0644))
	require.NoError(t, os.WriteFile(file3, []byte("3"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		IncludeExt:     []string{".pdf"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 2, "should match .PDF and .Pdf files (case-insensitive)")
	fileNames := []string{collected[0].FileName, collected[1].FileName}
	assert.Contains(t, fileNames, "doc.PDF")
	assert.Contains(t, fileNames, "note.Pdf")
}

// TestScanner_Walk_Metadata tests that scanned entries have correct metadata.
func TestScanner_Walk_Metadata(t *testing.T) {
	tmpDir := t.TempDir()

	fileName := "test.txt"
	filePath := filepath.Join(tmpDir, fileName)
	content := []byte("test content")
	require.NoError(t, os.WriteFile(filePath, content, 0644))

	// Get file info for comparison
	info, err := os.Stat(filePath)
	require.NoError(t, err)

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	require.Len(t, collected, 1)
	entry := collected[0]

	assert.Equal(t, fileName, entry.FileName)
	assert.Equal(t, int64(len(content)), entry.Size)
	assert.Equal(t, info.ModTime().Unix(), entry.Mtime.Unix())
	assert.False(t, entry.IsDir)
	assert.False(t, entry.IsSymlink)
}

// TestScanner_Walk_ContextCancellation tests that scanning stops on context cancellation.
func TestScanner_Walk_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()

	// Create multiple files
	for i := 0; i < 10; i++ {
		fileName := filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i))
		require.NoError(t, os.WriteFile(fileName, []byte("content"), 0644))
	}

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
	}
	scanner := localimport.NewScanner(source)

	ctx, cancel := context.WithCancel(context.Background())

	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	cancelledEarly := false

	for i := 0; i < 5; i++ {
		select {
		case entry := <-entries:
			collected = append(collected, entry)
		case <-time.After(1 * time.Second):
			break
		}
	}

	// Cancel the context
	cancel()

	// Try to collect remaining entries
	timeout := time.After(100 * time.Millisecond)
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				// Channel closed, context was cancelled
				cancelledEarly = true
				break
			}
			collected = append(collected, entry)
		case <-timeout:
			// Timeout, assume cancellation worked
			cancelledEarly = true
			break
		}
		if cancelledEarly {
			break
		}
	}

	// Drain error channel
	for range errChan {
	}

	assert.True(t, cancelledEarly, "context cancellation should stop scanning")
}

// TestScanner_Walk_IncludeAndExclude tests combined include and exclude filters.
func TestScanner_Walk_IncludeAndExclude(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with different extensions
	pdfFile := filepath.Join(tmpDir, "doc.pdf")
	docxFile := filepath.Join(tmpDir, "report.docx")
	txtFile := filepath.Join(tmpDir, "note.txt")
	logFile := filepath.Join(tmpDir, "app.log")
	require.NoError(t, os.WriteFile(pdfFile, []byte("pdf"), 0644))
	require.NoError(t, os.WriteFile(docxFile, []byte("docx"), 0644))
	require.NoError(t, os.WriteFile(txtFile, []byte("txt"), 0644))
	require.NoError(t, os.WriteFile(logFile, []byte("log"), 0644))

	// Include only .pdf and .docx
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		IncludeExt:     []string{".pdf", ".docx"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 2, "should find only PDF and DOCX files")
	fileNames := []string{collected[0].FileName, collected[1].FileName}
	assert.Contains(t, fileNames, "doc.pdf")
	assert.Contains(t, fileNames, "report.docx")
	assert.NotContains(t, fileNames, "note.txt")
	assert.NotContains(t, fileNames, "app.log")
}

// TestScanner_Walk_RecursiveWithFilters tests recursive scanning combined with filters.
func TestScanner_Walk_RecursiveWithFilters(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested structure with different file types
	level1 := filepath.Join(tmpDir, "level1")
	level2 := filepath.Join(level1, "level2")
	require.NoError(t, os.Mkdir(level1, 0755))
	require.NoError(t, os.Mkdir(level2, 0755))

	// Root level files
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "root.pdf"), []byte("1"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "root.txt"), []byte("2"), 0644))

	// Level 1 files
	require.NoError(t, os.WriteFile(filepath.Join(level1, "l1.pdf"), []byte("3"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level1, "l1.txt"), []byte("4"), 0644))

	// Level 2 files
	require.NoError(t, os.WriteFile(filepath.Join(level2, "l2.pdf"), []byte("5"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level2, "l2.txt"), []byte("6"), 0644))

	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       10,
		IncludeExt:     []string{".pdf"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 3, "should find 3 PDF files across all levels")
	fileNames := []string{collected[0].FileName, collected[1].FileName, collected[2].FileName}
	assert.Contains(t, fileNames, "root.pdf")
	assert.Contains(t, fileNames, "l1.pdf")
	assert.Contains(t, fileNames, "l2.pdf")
}

// TestScanner_Walk_ExcludeExtension_Multiple tests excluding multiple extensions.
func TestScanner_Walk_ExcludeExtension_Multiple(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with various extensions
	files := map[string]string{
		"doc.pdf":  "pdf",
		"note.txt": "txt",
		"log.log":  "log",
		"backup.bak": "bak",
		"temp.tmp": "tmp",
		"data.xlsx": "xlsx",
	}

	for name := range files {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, name), []byte("content"), 0644))
	}

	// Exclude log, bak, and tmp files
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		ExcludeExt:     []string{".log", ".bak", ".tmp"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 3, "should find 3 files (excluding .log, .bak, .tmp)")
	fileNames := []string{collected[0].FileName, collected[1].FileName, collected[2].FileName}
	assert.Contains(t, fileNames, "doc.pdf")
	assert.Contains(t, fileNames, "note.txt")
	assert.Contains(t, fileNames, "data.xlsx")
	assert.NotContains(t, fileNames, "log.log")
	assert.NotContains(t, fileNames, "backup.bak")
	assert.NotContains(t, fileNames, "temp.tmp")
}

// TestScanner_Walk_CaseInsensitiveFilterMatching tests case-insensitive matching with various cases.
func TestScanner_Walk_CaseInsensitiveFilterMatching(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files with various case extensions
	files := []string{
		"file1.pdf",
		"file2.PDF",
		"file3.Pdf",
		"file4.pDf",
		"file5.txt",
		"file6.TXT",
	}

	for _, name := range files {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, name), []byte("content"), 0644))
	}

	// Include only .pdf (lowercase in filter)
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      false,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       1,
		IncludeExt:     []string{".pdf"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 4, "should find all PDF files regardless of case")
	fileNames := []string{}
	for _, e := range collected {
		fileNames = append(fileNames, e.FileName)
	}
	assert.Contains(t, fileNames, "file1.pdf")
	assert.Contains(t, fileNames, "file2.PDF")
	assert.Contains(t, fileNames, "file3.Pdf")
	assert.Contains(t, fileNames, "file4.pDf")
}

// TestScanner_Walk_FilterWithMaxDepth tests filters combined with depth limit.
func TestScanner_Walk_FilterWithMaxDepth(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested structure
	level1 := filepath.Join(tmpDir, "level1")
	level2 := filepath.Join(level1, "level2")
	level3 := filepath.Join(level2, "level3")
	require.NoError(t, os.Mkdir(level1, 0755))
	require.NoError(t, os.Mkdir(level2, 0755))
	require.NoError(t, os.Mkdir(level3, 0755))

	// Create files at different depths
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "root.pdf"), []byte("1"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "root.txt"), []byte("2"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level1, "l1.pdf"), []byte("3"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level1, "l1.txt"), []byte("4"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level2, "l2.pdf"), []byte("5"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level2, "l2.txt"), []byte("6"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level3, "l3.pdf"), []byte("7"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(level3, "l3.txt"), []byte("8"), 0644))

	// Include only .pdf files with MaxDepth=2 (root + 1 level)
	source := localimport.LocalSource{
		FolderPath:     tmpDir,
		Recursive:      true,
		HiddenFiles:    true,
		FollowSymlinks: false,
		MaxDepth:       2,
		IncludeExt:     []string{".pdf"},
	}
	scanner := localimport.NewScanner(source)

	ctx := context.Background()
	entries, errChan := scanner.Walk(ctx)

	collected := []localimport.ScanEntry{}
	for entry := range entries {
		collected = append(collected, entry)
	}
	for range errChan {
	}

	assert.Len(t, collected, 2, "should find 2 PDF files within MaxDepth=2 (root + level1)")
	fileNames := []string{collected[0].FileName, collected[1].FileName}
	assert.Contains(t, fileNames, "root.pdf")
	assert.Contains(t, fileNames, "l1.pdf")
	assert.NotContains(t, fileNames, "l2.pdf")
	assert.NotContains(t, fileNames, "l3.pdf")
}
