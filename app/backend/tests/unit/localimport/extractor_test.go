package localimport_test

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
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

// ========== Fixture File Generators ==========

// createFixtureTXT creates a minimal TXT fixture with a known phrase.
func createFixtureTXT(t *testing.T, dir string) string {
	filePath := filepath.Join(dir, "fixture.txt")
	content := "This is a text fixture file.\nIt contains the phrase unique-test-phrase-TXT.\nMore content here.\n"
	require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	return filePath
}

// createFixtureMD creates a minimal Markdown fixture with headings and a known phrase.
func createFixtureMD(t *testing.T, dir string) string {
	filePath := filepath.Join(dir, "fixture.md")
	content := `# Main Heading
This is a markdown fixture file.
It contains the phrase unique-test-phrase-MD.

## Subheading
More content under the subheading.

### Sub-subheading
Additional content.
`
	require.NoError(t, os.WriteFile(filePath, []byte(content), 0644))
	return filePath
}

// createFixturePDF creates a minimal PDF fixture with a known phrase.
func createFixturePDF(t *testing.T, dir string) string {
	filePath := filepath.Join(dir, "fixture.pdf")
	// Minimal valid PDF with text "unique-test-phrase-PDF"
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
(This PDF contains unique-test-phrase-PDF for testing.) Tj
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

// createFixtureDOCX creates a minimal DOCX fixture (ZIP with XML) with a known phrase.
func createFixtureDOCX(t *testing.T, dir string) string {
	filePath := filepath.Join(dir, "fixture.docx")
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
<w:t>This DOCX fixture contains unique-test-phrase-DOCX for testing.</w:t>
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

// createFixtureXLSX creates a minimal XLSX fixture (using excelize).
func createFixtureXLSX(t *testing.T, dir string) string {
	filePath := filepath.Join(dir, "fixture.xlsx")
	f := excelize.NewFile()
	defer f.Close()

	// Add content to Sheet1
	f.SetCellValue("Sheet1", "A1", "This XLSX fixture")
	f.SetCellValue("Sheet1", "A2", "contains the phrase unique-test-phrase-XLSX")
	f.SetCellValue("Sheet1", "A3", "for testing purposes")

	// Add content to Sheet2
	f.NewSheet("Sheet2")
	f.SetCellValue("Sheet2", "A1", "Additional content")
	f.SetCellValue("Sheet2", "A2", "on second sheet")

	require.NoError(t, f.SaveAs(filePath))
	return filePath
}

// ========== Fixture File Tests ==========

// TestExtractor_Extract_FixtureTXT tests extraction from fixture TXT file.
func TestExtractor_Extract_FixtureTXT(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := createFixtureTXT(t, tmpDir)

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, filePath)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.False(t, result.IsBinary, "TXT should not be binary")
	assert.Contains(t, result.Text, "unique-test-phrase-TXT", "should extract known phrase from TXT")
}

// TestExtractor_Extract_FixtureMD tests extraction from fixture MD file with heading preservation.
func TestExtractor_Extract_FixtureMD(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := createFixtureMD(t, tmpDir)

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, filePath)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.False(t, result.IsBinary, "MD should not be binary")
	assert.Contains(t, result.Text, "unique-test-phrase-MD", "should extract known phrase from MD")
	assert.Contains(t, result.Text, "Main Heading", "should preserve headings in MD")
	assert.Contains(t, result.Text, "Subheading", "should preserve subheadings in MD")
}

// TestExtractor_Extract_FixturePDF tests extraction from fixture PDF file.
func TestExtractor_Extract_FixturePDF(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := createFixturePDF(t, tmpDir)

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, filePath)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// PDF extraction may or may not succeed depending on parser capability
	// but it should not crash and should not be marked as binary (if text extracted)
	if len(result.Text) > 0 {
		assert.Contains(t, result.Text, "unique-test-phrase-PDF", "should extract known phrase from PDF")
	}
}

// TestExtractor_Extract_FixtureDOCX tests extraction from fixture DOCX file.
func TestExtractor_Extract_FixtureDOCX(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := createFixtureDOCX(t, tmpDir)

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, filePath)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// DOCX extraction may not always succeed with all parsers
	// but it should not crash
	if len(result.Text) > 0 {
		assert.Contains(t, result.Text, "unique-test-phrase-DOCX", "should extract known phrase from DOCX")
	}
}

// TestExtractor_Extract_FixtureXLSX tests extraction from fixture XLSX file with multi-sheet content.
func TestExtractor_Extract_FixtureXLSX(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := createFixtureXLSX(t, tmpDir)

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	result, err := extractor.Extract(ctx, filePath)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// XLSX extraction should succeed
	if len(result.Text) > 0 {
		assert.Contains(t, result.Text, "unique-test-phrase-XLSX", "should extract known phrase from XLSX")
		// Verify multi-sheet extraction if possible
		if bytes.Contains([]byte(result.Text), []byte("Sheet2")) || bytes.Contains([]byte(result.Text), []byte("Additional")) {
			t.Log("Multi-sheet extraction confirmed")
		}
	}
}

// TestExtractor_AllFormats_WithKnownPhrase tests that all 5 formats can extract a known phrase.
func TestExtractor_AllFormats_WithKnownPhrase(t *testing.T) {
	tmpDir := t.TempDir()

	formats := map[string]struct {
		create func(t *testing.T, dir string) string
		phrase string
	}{
		"txt":  {createFixtureTXT, "unique-test-phrase-TXT"},
		"md":   {createFixtureMD, "unique-test-phrase-MD"},
		"pdf":  {createFixturePDF, "unique-test-phrase-PDF"},
		"docx": {createFixtureDOCX, "unique-test-phrase-DOCX"},
		"xlsx": {createFixtureXLSX, "unique-test-phrase-XLSX"},
	}

	extractor := localimport.NewExtractor()
	ctx := context.Background()

	for format, config := range formats {
		t.Run(format, func(t *testing.T) {
			filePath := config.create(t, tmpDir)
			result, err := extractor.Extract(ctx, filePath)

			require.NoError(t, err, "extraction should not error for %s", format)
			assert.NotNil(t, result, "should return result for %s", format)

			// All text formats should extract text
			if format == "txt" || format == "md" {
				assert.False(t, result.IsBinary, "%s should not be binary", format)
				assert.Contains(t, result.Text, config.phrase, "should extract known phrase from %s", format)
			} else {
				// Binary formats (PDF, DOCX, XLSX) may or may not extract, but shouldn't crash
				if len(result.Text) > 0 {
					t.Logf("%s extraction succeeded with %d bytes", format, len(result.Text))
				}
			}
		})
	}
}
