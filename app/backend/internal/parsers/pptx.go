package parsers

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

type PptxParser struct{}

func NewPptxParser() *PptxParser {
	return &PptxParser{}
}

// Parse extracts text content from a PPTX file (which is a ZIP archive)
func (p *PptxParser) Parse(content []byte) (string, error) {
	// PPTX is a ZIP archive; open it
	reader := bytes.NewReader(content)
	zipReader, err := zip.NewReader(reader, int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("pptx.Parse: open zip: %w", err)
	}

	var textContent strings.Builder
	slideNum := 1

	// Read slide*.xml files which contain the slide content
	for _, file := range zipReader.File {
		if strings.HasPrefix(file.Name, "ppt/slides/slide") && strings.HasSuffix(file.Name, ".xml") {
			rc, err := file.Open()
			if err != nil {
				continue
			}

			data, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}

			textContent.WriteString(fmt.Sprintf("Slide %d:\n", slideNum))
			slideNum++

			text, err := extractTextFromSlideXML(data)
			if err == nil {
				textContent.WriteString(text)
			}

			textContent.WriteString("\n")
		}
	}

	return textContent.String(), nil
}

// Slide XML structure (simplified)
type Slide struct {
	Shapes []struct {
		TextBody struct {
			Paragraphs []struct {
				Runs []struct {
					Text string `xml:"a:t"`
				} `xml:"a:r"`
			} `xml:"a:p"`
		} `xml:"p:txBody"`
	} `xml:"p:sp"`
	GroupShapes []struct {
		Shapes []struct {
			TextBody struct {
				Paragraphs []struct {
					Runs []struct {
						Text string `xml:"a:t"`
					} `xml:"a:r"`
				} `xml:"a:p"`
			} `xml:"p:txBody"`
		} `xml:"p:sp"`
	} `xml:"p:grpSp"`
}

func extractTextFromSlideXML(xmlData []byte) (string, error) {
	var slide Slide

	// Remove namespace prefixes to simplify parsing
	dataNoNS := bytes.ReplaceAll(xmlData, []byte("p:"), []byte(""))
	dataNoNS = bytes.ReplaceAll(dataNoNS, []byte("a:"), []byte(""))
	dataNoNS = bytes.ReplaceAll(dataNoNS, []byte("xmlns:"), []byte("xmlns_"))

	if err := xml.Unmarshal(dataNoNS, &slide); err != nil {
		// If structured parsing fails, fall back to simple text extraction
		return extractPlainTextFromXML(xmlData), nil
	}

	var sb strings.Builder

	// Extract text from shapes
	for _, shape := range slide.Shapes {
		for _, p := range shape.TextBody.Paragraphs {
			for _, r := range p.Runs {
				sb.WriteString(r.Text)
			}
			sb.WriteString("\n")
		}
	}

	// Extract text from group shapes
	for _, grpShape := range slide.GroupShapes {
		for _, shape := range grpShape.Shapes {
			for _, p := range shape.TextBody.Paragraphs {
				for _, r := range p.Runs {
					sb.WriteString(r.Text)
				}
				sb.WriteString("\n")
			}
		}
	}

	return sb.String(), nil
}

// extractPlainTextFromXML extracts text by looking for <a:t> tags
func extractPlainTextFromXML(xmlData []byte) string {
	var sb strings.Builder
	i := 0

	for i < len(xmlData) {
		// Look for <a:t> or <t> tags
		if i+4 < len(xmlData) && (bytes.Equal(xmlData[i:i+4], []byte("<a:t")) || bytes.Equal(xmlData[i:i+3], []byte("<t"))) {
			// Find the closing >
			closeIdx := bytes.Index(xmlData[i:], []byte(">"))
			if closeIdx != -1 {
				// Find the closing tag
				closeTagStart := bytes.Index(xmlData[i+closeIdx+1:], []byte("</"))
				if closeTagStart != -1 {
					textEnd := i + closeIdx + 1 + closeTagStart
					text := string(xmlData[i+closeIdx+1 : textEnd])
					sb.WriteString(text)
					sb.WriteString(" ")
					i = textEnd
					continue
				}
			}
		}
		i++
	}

	return sb.String()
}
