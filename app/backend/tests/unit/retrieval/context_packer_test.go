package retrieval_test

import (
	"context"
	"strings"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

func TestNewContextPacker(t *testing.T) {
	cp := retrieval.NewContextPacker()
	if cp == nil {
		t.Fatal("expected context packer, got nil")
	}
}

func TestContextPackerPack_IncludesChunkText(t *testing.T) {
	cp := retrieval.NewContextPacker()
	results := []map[string]interface{}{
		{"text": "Alice leads ProjectX.", "file_name": "doc1.docx"},
		{"text": "Bob works with Alice.", "file_name": "doc2.docx"},
	}

	packed := cp.Pack(context.Background(), results, 12000)

	if !strings.Contains(packed, "Alice leads ProjectX.") {
		t.Error("expected packed context to include first chunk's text")
	}
	if !strings.Contains(packed, "Bob works with Alice.") {
		t.Error("expected packed context to include second chunk's text")
	}
	if !strings.Contains(packed, "[Source 1: doc1.docx]") {
		t.Error("expected packed context to cite source 1 by file name")
	}
}

func TestContextPackerPack_IncludesGraphEntities(t *testing.T) {
	cp := retrieval.NewContextPacker()
	results := []map[string]interface{}{
		{"name": "ProjectX", "type": "Project"},
	}

	packed := cp.Pack(context.Background(), results, 12000)

	if !strings.Contains(packed, "ProjectX") || !strings.Contains(packed, "Project") {
		t.Errorf("expected packed context to include graph entity name and type, got: %q", packed)
	}
}

func TestContextPackerPack_RespectsTokenBudget(t *testing.T) {
	cp := retrieval.NewContextPacker()

	// Each chunk is ~400 chars -> ~100 tokens. A budget of 150 tokens should
	// admit only the first chunk, not both.
	longText := strings.Repeat("word ", 80) // ~400 chars
	results := []map[string]interface{}{
		{"text": longText, "file_name": "doc1.docx"},
		{"text": longText, "file_name": "doc2.docx"},
	}

	packed := cp.Pack(context.Background(), results, 150)

	if !strings.Contains(packed, "doc1.docx") {
		t.Error("expected first chunk to fit within budget")
	}
	if strings.Contains(packed, "doc2.docx") {
		t.Error("expected second chunk to be excluded by token budget")
	}
}

func TestContextPackerPack_EmptyResults(t *testing.T) {
	cp := retrieval.NewContextPacker()
	packed := cp.Pack(context.Background(), nil, 12000)
	if packed != "" {
		t.Errorf("expected empty string for no results, got %q", packed)
	}
}
