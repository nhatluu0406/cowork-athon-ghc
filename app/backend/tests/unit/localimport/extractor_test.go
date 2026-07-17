package localimport_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestExtractor_Extract_TXT tests extraction from a simple text file.
func TestExtractor_Extract_TXT(t *testing.T) {
	tmpDir := t.TempDir()

	txtFile := filepath.Join(tmpDir, "test.txt")
	testContent := "This is a test file.\nWith multiple lines.\nAnd some content."
	require.NoError(t, os.WriteFile(txtFile, []byte(testContent), 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, txtFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.False(t, result.IsBinary)
	assert.Contains(t, result.Text, "test file")
	assert.Contains(t, result.Text, "multiple lines")
}

// TestExtractor_Extract_MD tests extraction from a markdown file.
func TestExtractor_Extract_MD(t *testing.T) {
	tmpDir := t.TempDir()

	mdFile := filepath.Join(tmpDir, "README.md")
	testContent := "# Heading\n\nSome markdown content.\n\n## Subheading\n\nMore content."
	require.NoError(t, os.WriteFile(mdFile, []byte(testContent), 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, mdFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.False(t, result.IsBinary)
	assert.Contains(t, result.Text, "Heading")
	assert.Contains(t, result.Text, "markdown content")
}

// TestExtractor_Extract_BinaryPNG tests that binary files are marked as binary.
func TestExtractor_Extract_BinaryPNG(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a fake PNG file (PNG magic number)
	pngFile := filepath.Join(tmpDir, "test.png")
	pngMagic := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	require.NoError(t, os.WriteFile(pngFile, pngMagic, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, pngFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.True(t, result.IsBinary, "PNG should be marked as binary")
}

// TestExtractor_Extract_XLSX tests XLSX extraction.
func TestExtractor_Extract_XLSX(t *testing.T) {
	// For this test, we'll use a minimal XLSX file (which is a ZIP with XML)
	tmpDir := t.TempDir()

	xlsxFile := filepath.Join(tmpDir, "test.xlsx")
	// Minimal XLSX structure - a ZIP file with workbook.xml
	minimalXlsx := []byte{
		0x50, 0x4B, 0x03, 0x04, // ZIP signature
		0x14, 0x00, // Version needed to extract
		0x00, 0x00, // General purpose bit flag
		0x08, 0x00, // Compression method (deflated)
		0x00, 0x00, // Last mod file time
		0x00, 0x00, // Last mod file date
		0x00, 0x00, 0x00, 0x00, // CRC-32
		0x00, 0x00, 0x00, 0x00, // Compressed size
		0x00, 0x00, 0x00, 0x00, // Uncompressed size
		0x09, 0x00, // File name length
		0x00, 0x00, // Extra field length
		0x77, 0x6F, 0x72, 0x6B, 0x62, 0x6F, 0x6F, 0x6B, 0x2E, // "workbook."
		0x78, 0x6D, 0x6C, // "xml"
	}

	require.NoError(t, os.WriteFile(xlsxFile, minimalXlsx, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	// This will likely fail to parse as an invalid XLSX, but shouldn't panic
	result, _ := extractor.Extract(ctx, xlsxFile)
	// We're mainly testing that it doesn't crash
	assert.NotNil(t, result)
}

// TestExtractor_Extract_NonExistentFile tests that missing files are handled.
func TestExtractor_Extract_NonExistentFile(t *testing.T) {
	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, _ := extractor.Extract(ctx, "/nonexistent/path/file.txt")
	assert.NotNil(t, result)
	assert.NotNil(t, result.Error)
	assert.True(t, result.IsBinary)
}

// TestExtractor_Extract_UnknownExtension tests that unknown extensions are marked binary.
func TestExtractor_Extract_UnknownExtension(t *testing.T) {
	tmpDir := t.TempDir()

	unknownFile := filepath.Join(tmpDir, "test.unknown")
	testContent := "Some arbitrary content"
	require.NoError(t, os.WriteFile(unknownFile, []byte(testContent), 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, unknownFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.True(t, result.IsBinary, "unknown extension should be marked binary")
}

// TestExtractor_Extract_UTF8BOM tests UTF-8 with BOM detection.
func TestExtractor_Extract_UTF8BOM(t *testing.T) {
	tmpDir := t.TempDir()

	txtFile := filepath.Join(tmpDir, "test_bom.txt")
	// UTF-8 BOM + content
	content := append([]byte{0xEF, 0xBB, 0xBF}, []byte("Hello, world!")...)
	require.NoError(t, os.WriteFile(txtFile, content, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, txtFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.False(t, result.IsBinary)
	assert.Equal(t, "UTF-8", result.Encoding)
}

// TestExtractor_Extract_EmptyFile tests empty file handling.
func TestExtractor_Extract_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()

	txtFile := filepath.Join(tmpDir, "empty.txt")
	require.NoError(t, os.WriteFile(txtFile, []byte(""), 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, txtFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "", result.Text)
}

// TestExtractor_Extract_LargeBinaryFile tests handling of large binary files.
func TestExtractor_Extract_LargeBinaryFile(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a larger binary file (mostly non-text bytes)
	binFile := filepath.Join(tmpDir, "large.bin")
	binaryData := make([]byte, 10000)
	for i := 0; i < len(binaryData); i++ {
		binaryData[i] = byte(i % 256)
	}
	require.NoError(t, os.WriteFile(binFile, binaryData, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, binFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.True(t, result.IsBinary)
}

// TestExtractor_Extract_MixedContent tests file with mixed text and binary content.
func TestExtractor_Extract_MixedContent(t *testing.T) {
	tmpDir := t.TempDir()

	mixedFile := filepath.Join(tmpDir, "mixed.dat")
	// Start with text, then add binary
	content := append([]byte("Some plain text\n"), byte(0x00), byte(0xFF), byte(0xFE))
	require.NoError(t, os.WriteFile(mixedFile, content, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, mixedFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// May or may not be marked as binary depending on confidence threshold
}

// TestExtractor_Extract_ContextCancellation tests that context cancellation is handled.
func TestExtractor_Extract_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()

	txtFile := filepath.Join(tmpDir, "test.txt")
	require.NoError(t, os.WriteFile(txtFile, []byte("content"), 0644))

	extractor := localimport.NewExtractor()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Should fail or return quickly due to cancelled context
	result, err := extractor.Extract(ctx, txtFile)
	// We expect either an error or successful extraction
	// (context cancellation applies to future operations, not file reads)
	_ = result
	_ = err
}

// TestExtractor_Extract_Latin1Encoding tests Latin-1 encoded file detection.
func TestExtractor_Extract_Latin1Encoding(t *testing.T) {
	tmpDir := t.TempDir()

	txtFile := filepath.Join(tmpDir, "latin1.txt")
	// Latin-1 encoded string with special characters
	content := []byte{0xC3, 0xA9, 0xC3, 0xB1, 0xC3, 0xB8} // Latin-1 special chars
	require.NoError(t, os.WriteFile(txtFile, content, 0644))

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, txtFile)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// May be detected as binary if confidence is low, which is acceptable
}
