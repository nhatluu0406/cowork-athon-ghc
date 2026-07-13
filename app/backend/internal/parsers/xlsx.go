package parsers

import (
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

type XlsxParser struct{}

func NewXlsxParser() *XlsxParser {
	return &XlsxParser{}
}

// Parse extracts text content from an XLSX file
func (p *XlsxParser) Parse(content []byte) (string, error) {
	// Open the Excel file from bytes
	f, err := excelize.OpenReader(strings.NewReader(string(content)))
	if err != nil {
		return "", fmt.Errorf("xlsx.Parse: open file: %w", err)
	}
	defer f.Close()

	var textContent strings.Builder

	// Iterate through all sheets
	sheetNames := f.GetSheetList()
	for _, sheetName := range sheetNames {
		textContent.WriteString(fmt.Sprintf("Sheet: %s\n", sheetName))

		// Get all rows in the sheet
		rows, err := f.GetRows(sheetName)
		if err != nil {
			// Skip this sheet if there's an error reading it
			continue
		}

		for _, row := range rows {
			for i, cell := range row {
				if i > 0 {
					textContent.WriteString("\t")
				}
				textContent.WriteString(cell)
			}
			textContent.WriteString("\n")
		}

		textContent.WriteString("\n")
	}

	return textContent.String(), nil
}
