package localimport

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
)

// ExtractResult holds the result of text extraction from a file.
type ExtractResult struct {
	Text     string
	IsBinary bool
	Encoding string
	Error    error
}

// Extractor routes files to appropriate parsers based on MIME type.
type Extractor struct {
	pdfParser  *parsers.PDFParser
	docxParser *parsers.DocxParser
	xlsxParser *parsers.XlsxParser
	textParser *parsers.TextParser
}

// NewExtractor creates a new Extractor.
func NewExtractor() *Extractor {
	return &Extractor{
		pdfParser:  parsers.NewPDFParser(),
		docxParser: parsers.NewDocxParser(),
		xlsxParser: parsers.NewXlsxParser(),
		textParser: parsers.NewTextParser(512, 128),
	}
}

// Extract reads a file and extracts text content.
func (e *Extractor) Extract(ctx context.Context, absPath string) (*ExtractResult, error) {
	data, err := os.ReadFile(absPath)
	if err != nil {
		return &ExtractResult{Error: err, IsBinary: true}, nil
	}

	// Detect MIME type from file content
	mimeType := http.DetectContentType(data[:min(len(data), 512)])

	// Detect encoding for text-like files
	var encoding string
	if !isBinaryMIME(mimeType) {
		charset, confidence, err := DetectEncoding(data)
		if err == nil && confidence > 0.7 {
			encoding = charset
		} else {
			// Low confidence or detection failed; treat as binary
			return &ExtractResult{IsBinary: true, Encoding: ""}, nil
		}

		// Convert to UTF-8 if not already
		if encoding != "" && encoding != "UTF-8" {
			converted, err := ConvertToUTF8(data, encoding)
			if err == nil {
				data = converted
			}
		}
	}

	// Route to appropriate parser based on file extension
	ext := strings.ToLower(filepath.Ext(absPath))
	var text string
	var parseErr error

	switch ext {
	case ".pdf":
		text, parseErr = e.pdfParser.Parse(data)
	case ".docx":
		text, parseErr = e.docxParser.Parse(data)
	case ".xlsx":
		text, parseErr = e.xlsxParser.Parse(data)
	case ".txt", ".md":
		chunks, err := e.textParser.Parse(data)
		text = chunksToText(chunks)
		parseErr = err
	default:
		// Unsupported type; return metadata only
		return &ExtractResult{IsBinary: true, Encoding: encoding}, nil
	}

	result := &ExtractResult{
		Text:     text,
		IsBinary: len(text) == 0,
		Encoding: encoding,
		Error:    parseErr,
	}

	return result, nil
}

// chunksToText converts a slice of Chunk structs to plain text.
func chunksToText(chunks []parsers.Chunk) string {
	if len(chunks) == 0 {
		return ""
	}
	var sb strings.Builder
	for i, chunk := range chunks {
		if i > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(chunk.Text)
	}
	return sb.String()
}

// isBinaryMIME determines if a MIME type is binary (not text-extractable).
func isBinaryMIME(mimeType string) bool {
	// Text types we support
	if strings.HasPrefix(mimeType, "text/") {
		return false
	}
	if strings.Contains(mimeType, "pdf") {
		return false
	}
	if strings.Contains(mimeType, "spreadsheet") || strings.Contains(mimeType, "excel") {
		return false
	}
	if strings.Contains(mimeType, "document") || strings.Contains(mimeType, "word") {
		return false
	}
	if strings.HasPrefix(mimeType, "application/vnd.openxmlformats") {
		return false
	}
	return true
}

// min returns the minimum of two integers.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
