package retrieval_test

import (
	"context"
	"strings"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
)

// mockLLM implements retrieval.LLMClient for tests.
type mockLLM struct {
	response string
	err      error
}

func (m *mockLLM) Complete(ctx context.Context, prompt string) (string, error) {
	if m.err != nil {
		return "", m.err
	}
	return m.response, nil
}

func TestNewAnswerGenerator(t *testing.T) {
	ag := retrieval.NewAnswerGenerator(nil)
	if ag == nil {
		t.Fatal("expected answer generator, got nil")
	}
}

func TestAnswerGeneratorGenerate_NoLLM(t *testing.T) {
	ag := retrieval.NewAnswerGenerator(nil)
	answer, sources := ag.Generate(context.Background(), "who works on ProjectX?", "[Source 1: doc.docx]\nsome text\n")
	if !strings.Contains(answer, "don't have enough information") {
		t.Errorf("expected fallback answer with no LLM configured, got %q", answer)
	}
	if len(sources) != 1 {
		t.Errorf("expected 1 extracted source citation, got %d", len(sources))
	}
}

func TestAnswerGeneratorGenerate_WithLLM(t *testing.T) {
	llm := &mockLLM{response: "Alice works on ProjectX [Source 1]."}
	ag := retrieval.NewAnswerGenerator(llm)
	answer, sources := ag.Generate(context.Background(), "who works on ProjectX?", "[Source 1: doc.docx]\nAlice leads ProjectX.\n")
	if answer != llm.response {
		t.Errorf("expected LLM response %q, got %q", llm.response, answer)
	}
	if len(sources) != 1 {
		t.Errorf("expected 1 extracted source citation, got %d", len(sources))
	}
}

func TestAnswerGeneratorGenerate_LLMError(t *testing.T) {
	llm := &mockLLM{err: context.DeadlineExceeded}
	ag := retrieval.NewAnswerGenerator(llm)
	answer, _ := ag.Generate(context.Background(), "query", "[Source 1: doc.docx]\ntext\n")
	if !strings.Contains(answer, "Unable to generate") {
		t.Errorf("expected error-fallback answer, got %q", answer)
	}
}
