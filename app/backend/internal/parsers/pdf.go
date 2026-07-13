package parsers

import (
	"strings"
)

type PDFParser struct{}

func NewPDFParser() *PDFParser {
	return &PDFParser{}
}

// Parse extracts text content from a PDF file
// Note: This is a simplified implementation that extracts printable text from PDF bytes
// For production use, consider using a more robust PDF library with proper text extraction
func (p *PDFParser) Parse(content []byte) (string, error) {
	if len(content) == 0 {
		return "", nil
	}

	// Simple text extraction: look for text between BT (begin text) and ET (end text) markers
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

	return extracted.String(), nil
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
