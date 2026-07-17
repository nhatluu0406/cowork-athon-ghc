package parsers

import (
	"bytes"
	"strings"

	"github.com/ledongthuc/pdf"
)

type PDFParser struct{}

func NewPDFParser() *PDFParser {
	return &PDFParser{}
}

// Parse extracts text content from a PDF file using ledongthuc/pdf.
// Falls back to regex-based extraction if the library returns empty text.
func (p *PDFParser) Parse(content []byte) (string, error) {
	if len(content) == 0 {
		return "", nil
	}

	// Try using ledongthuc/pdf for PDF parsing
	reader := bytes.NewReader(content)
	r, err := pdf.NewReader(reader, int64(len(content)))
	if err == nil {
		text, err := extractWithPDFLibrary(r)
		if err == nil && len(text) > 0 {
			return text, nil
		}
		// If library returns empty or error, fall through to regex fallback
	}

	// Fallback: regex-based extraction for cases where library fails
	return fallbackPDFExtraction(content), nil
}

// extractWithPDFLibrary uses ledongthuc/pdf to extract text from PDF.
func extractWithPDFLibrary(r *pdf.Reader) (string, error) {
	var textContent strings.Builder

	// Iterate through all pages
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		// ledongthuc/pdf returns a Page struct, not a pointer
		// A zero Page is a valid but empty page

		// Build fonts map from page using the Font() method
		fontNames := p.Fonts()
		fonts := make(map[string]*pdf.Font)
		for _, fontName := range fontNames {
			f := p.Font(fontName)
			fonts[fontName] = &f
		}

		text, err := p.GetPlainText(fonts)
		if err != nil {
			// Skip pages with errors; continue with remaining pages
			continue
		}
		if text != "" {
			textContent.WriteString(text)
			textContent.WriteString("\n")
		}
	}

	return textContent.String(), nil
}

// fallbackPDFExtraction uses regex-like patterns to extract text when library fails.
// This is the legacy implementation preserved as a fallback.
func fallbackPDFExtraction(content []byte) string {
	if len(content) == 0 {
		return ""
	}

	var extracted strings.Builder

	// Convert to string and look for readable text
	contentStr := string(content)

	// Remove binary PDF metadata and try to extract plain text
	lines := strings.Split(contentStr, "\n")
	for _, line := range lines {
		// Skip lines that are pure binary or PDF commands
		if len(line) > 0 && !isPDFBinaryLine(line) {
			// Remove common PDF control characters
			cleaned := cleanPDFLine(line)
			if len(cleaned) > 0 {
				extracted.WriteString(cleaned)
				extracted.WriteString("\n")
			}
		}
	}

	if extracted.Len() == 0 {
		// Fallback: extract printable ASCII characters
		for _, b := range content {
			if b >= 32 && b <= 126 {
				extracted.WriteByte(b)
			} else if b == '\n' || b == '\r' {
				extracted.WriteByte('\n')
			}
		}
	}

	return extracted.String()
}

func isPDFBinaryLine(line string) bool {
	// Skip PDF binary markers and structures
	if strings.Contains(line, "stream") || strings.Contains(line, "endstream") ||
		strings.Contains(line, "obj") || strings.Contains(line, "endobj") ||
		strings.Contains(line, "xref") || strings.Contains(line, "trailer") ||
		strings.Contains(line, "%PDF") {
		return true
	}

	// Count non-printable characters
	printable := 0
	for _, ch := range line {
		if (ch >= 32 && ch <= 126) || ch == '\t' {
			printable++
		}
	}

	// If mostly non-printable, it's likely binary
	return printable < len(line)/3
}

func cleanPDFLine(line string) string {
	// Remove common PDF control sequences and operators
	line = strings.ReplaceAll(line, "\\(", "(")
	line = strings.ReplaceAll(line, "\\)", ")")
	line = strings.ReplaceAll(line, "\\n", "\n")
	line = strings.ReplaceAll(line, "\\\\", "\\")

	// Remove PDF text positioning operators
	replacer := strings.NewReplacer(
		"Tj", "",
		"TJ", "",
		"'", "",
		"\"", "",
		"Td", "",
		"TD", "",
		"T*", "",
	)
	line = replacer.Replace(line)

	// Trim whitespace
	return strings.TrimSpace(line)
}
