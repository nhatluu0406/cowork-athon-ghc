package parsers

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

type DocxParser struct{}

func NewDocxParser() *DocxParser {
	return &DocxParser{}
}

// ParseDocx extracts text content from a DOCX file (which is a ZIP archive)
func (p *DocxParser) Parse(content []byte) (string, error) {
	// DOCX is a ZIP archive; open it
	reader := bytes.NewReader(content)
	zipReader, err := zip.NewReader(reader, int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("docx.Parse: open zip: %w", err)
	}

	var textContent strings.Builder

	// Read document.xml which contains the main document content
	for _, file := range zipReader.File {
		if file.Name == "word/document.xml" {
			rc, err := file.Open()
			if err != nil {
				return "", fmt.Errorf("docx.Parse: open document.xml: %w", err)
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				return "", fmt.Errorf("docx.Parse: read document.xml: %w", err)
			}

			text, err := extractTextFromWordXML(data)
			if err != nil {
				return "", fmt.Errorf("docx.Parse: extract text: %w", err)
			}

			textContent.WriteString(text)
			break
		}
	}

	return textContent.String(), nil
}

// Word document XML structure (simplified)
type WordDocument struct {
	Body struct {
		Paragraphs []struct {
			Runs []struct {
				Text string `xml:"w:t"`
			} `xml:"w:r"`
		} `xml:"w:p"`
		Tables []struct {
			Rows []struct {
				Cells []struct {
					Paragraphs []struct {
						Runs []struct {
							Text string `xml:"w:t"`
						} `xml:"w:r"`
					} `xml:"w:p"`
				} `xml:"w:tc"`
			} `xml:"w:tr"`
		} `xml:"w:tbl"`
	} `xml:"w:body"`
}

func extractTextFromWordXML(xmlData []byte) (string, error) {
	var doc WordDocument

	// Define namespace to avoid unmarshaling issues
	docWithoutNS := bytes.ReplaceAll(xmlData, []byte("w:"), []byte(""))
	docWithoutNS = bytes.ReplaceAll(docWithoutNS, []byte("xmlns:"), []byte("xmlns_"))

	if err := xml.Unmarshal(docWithoutNS, &doc); err != nil {
		// If structured parsing fails, fall back to simple text extraction
		return extractPlainText(xmlData), nil
	}

	var sb strings.Builder

	// Extract text from paragraphs
	for _, p := range doc.Body.Paragraphs {
		for _, r := range p.Runs {
			sb.WriteString(r.Text)
		}
		sb.WriteString("\n")
	}

	// Extract text from tables
	for _, tbl := range doc.Body.Tables {
		for _, row := range tbl.Rows {
			for i, cell := range row.Cells {
				if i > 0 {
					sb.WriteString("\t")
				}
				for _, p := range cell.Paragraphs {
					for _, r := range p.Runs {
						sb.WriteString(r.Text)
					}
				}
			}
			sb.WriteString("\n")
		}
	}

	return sb.String(), nil
}

// extractPlainText extracts text content by looking for <w:t> tags
func extractPlainText(xmlData []byte) string {
	var sb strings.Builder
	inTag := false
	var tagName strings.Builder

	for i := 0; i < len(xmlData); i++ {
		b := xmlData[i]

		if b == '<' {
			inTag = true
			tagName.Reset()
		} else if b == '>' {
			inTag = false
			tag := tagName.String()

			// Check if this is a closing </w:t> tag
			if tag == "/w:t" {
				// Backtrack to find start of text content
				j := i - 1
				for j >= 0 && xmlData[j] != '>' {
					j--
				}

				// Now backtrack from < to find the actual text
				textStart := j + 1
				textEnd := i

				// Handle w:t tag content
				if bytes.Contains(xmlData[textStart:textEnd], []byte("<w:t")) {
					// Find the content between <w:t...> and </w:t>
					openEnd := bytes.Index(xmlData[textStart:textEnd], []byte(">"))
					if openEnd != -1 {
						contentStart := textStart + openEnd + 1
						// Find closing tag
						closeStart := bytes.Index(xmlData[contentStart:], []byte("</w:t>"))
						if closeStart != -1 {
							text := string(xmlData[contentStart : contentStart+closeStart])
							sb.WriteString(text)
						}
					}
				}
			}
		} else if inTag {
			tagName.WriteByte(b)
		}
	}

	return sb.String()
}
