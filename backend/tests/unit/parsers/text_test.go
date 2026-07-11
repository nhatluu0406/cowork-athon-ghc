package parsers_test

import (
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
)

func TestNewTextParser(t *testing.T) {
	tt := []struct {
		name      string
		chunkSize int
		overlap   int
	}{
		{"creates parser with defaults", 512, 128},
		{"creates parser with custom size", 1024, 256},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			parser := parsers.NewTextParser(tc.chunkSize, tc.overlap)
			if parser == nil {
				t.Fatal("expected parser, got nil")
			}
		})
	}
}

func TestTextParserParse(t *testing.T) {
	tt := []struct {
		name      string
		input     []byte
		wantCount int
		wantErr   bool
	}{
		{"parses empty input", []byte(""), 1, false},
		{"parses single line", []byte("hello"), 1, false},
		{"parses multiline text", []byte("hello\nworld\ntest"), 1, false},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			parser := parsers.NewTextParser(512, 128)
			chunks, err := parser.Parse(tc.input)

			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}

			if len(chunks) != tc.wantCount {
				t.Errorf("expected %d chunks, got %d", tc.wantCount, len(chunks))
			}
		})
	}
}
