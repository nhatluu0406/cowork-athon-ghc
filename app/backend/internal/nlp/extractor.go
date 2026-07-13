package nlp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

type LLMClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

type Extractor struct {
	llm          LLMClient           // Fallback for generic LLM completion
	llmsvcClient *llmsvc.Client      // T172: Optional specialized client for ExtractEntities
}

func NewExtractor(llm LLMClient) *Extractor {
	return &Extractor{llm: llm}
}

// NewExtractorWithLLMSvc creates an Extractor that uses llmsvc.Client for extraction.
// T172: Use specialized ExtractEntities RPC for NER.
func NewExtractorWithLLMSvc(client *llmsvc.Client, llm LLMClient) *Extractor {
	return &Extractor{
		llmsvcClient: client,
		llm:          llm,
	}
}

type ExtractionResult struct {
	Entities      []Entity       `json:"entities"`
	Relationships []Relationship `json:"relationships"`
}

type Entity struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

type Relationship struct {
	FromID     string  `json:"from_id"`
	ToID       string  `json:"to_id"`
	Type       string  `json:"type"`
	Confidence float64 `json:"confidence"`
}

func (e *Extractor) Extract(ctx context.Context, text string) (*ExtractionResult, error) {
	// T172: Try specialized ExtractEntities RPC if client available; fall back to Complete interface
	if e.llmsvcClient != nil {
		result, err := e.extractWithLLMSvc(ctx, text)
		if err == nil {
			return result, nil
		}
		slog.DebugContext(ctx, "llmsvc extraction failed, using fallback", "err", err)
	}

	// Fallback: use LLMClient.Complete interface with prompt assembly
	if e.llm == nil {
		return &ExtractionResult{}, nil
	}

	prompt := e.buildPrompt(text)

	response, err := e.llm.Complete(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("llm call failed: %w", err)
	}

	var result ExtractionResult
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		slog.WarnContext(ctx, "failed to parse extraction", "err", err, "response", response)
		return &ExtractionResult{}, nil
	}

	return &result, nil
}

// extractWithLLMSvc uses llmsvc.Client.ExtractEntities for NER (T172).
func (e *Extractor) extractWithLLMSvc(ctx context.Context, text string) (*ExtractionResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract: text is empty")
	}

	// Call llmsvc.ExtractEntities
	nerResult, err := e.llmsvcClient.ExtractEntities(ctx, text, "ingestion", "")
	if err != nil {
		return nil, fmt.Errorf("nlp.Extractor.ExtractEntities: %w", err)
	}

	// Convert llmsvc.NERResult to ExtractionResult
	result := &ExtractionResult{
		Entities:      make([]Entity, len(nerResult.Entities)),
		Relationships: make([]Relationship, len(nerResult.Relationships)),
	}

	// Convert entities
	for i, e := range nerResult.Entities {
		result.Entities[i] = Entity{
			ID:         fmt.Sprintf("%s-%d", e.Type, i),
			Type:       e.Type,
			Name:       e.Name,
			Confidence: float64(e.Confidence),
		}
	}

	// Convert relationships
	for i, r := range nerResult.Relationships {
		result.Relationships[i] = Relationship{
			FromID:     fmt.Sprintf("%s-%d", r.FromEntity, 0),
			ToID:       fmt.Sprintf("%s-%d", r.ToEntity, 0),
			Type:       r.RelationshipType,
			Confidence: float64(r.Confidence),
		}
	}

	return result, nil
}

func (e *Extractor) buildPrompt(text string) string {
	exPrompt := BuildExtractionPrompt(text, 2048)
	return fmt.Sprintf("%s\n\n%s", exPrompt.System, exPrompt.UserText)
}
