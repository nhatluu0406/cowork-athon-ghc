package nlp_test

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/nlp"
)

type mockLLMClient struct {
	response string
	err      error
}

func (m *mockLLMClient) Complete(ctx context.Context, prompt string) (string, error) {
	return m.response, m.err
}

func TestNewExtractor(t *testing.T) {
	mock := &mockLLMClient{response: "{}", err: nil}
	ext := nlp.NewExtractor(mock)
	if ext == nil {
		t.Fatal("expected extractor, got nil")
	}
}

func TestExtractorExtract(t *testing.T) {
	tt := []struct {
		name    string
		llmResp string
		text    string
		wantErr bool
	}{
		{"parses valid JSON", `{"entities":[],"relationships":[]}`, "test text", false},
		{"handles invalid JSON", "invalid", "test text", false}, // logs error but doesn't return it
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			mock := &mockLLMClient{response: tc.llmResp, err: nil}
			ext := nlp.NewExtractor(mock)
			_, err := ext.Extract(context.Background(), tc.text)

			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
