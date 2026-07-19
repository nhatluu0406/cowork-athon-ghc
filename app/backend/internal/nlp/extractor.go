// Package nlp provides NLP operations for entity extraction and analysis.
// Task T047: Entity extraction via llm-svc
// Provides abstraction over llm-svc.Client.ExtractEntities for NER tasks
package nlp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/rad-system/m365-knowledge-graph/internal/llmsvc"
)

// LLMClient interface for generic LLM completion (fallback only)
type LLMClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// Extractor performs entity and relationship extraction from text.
// Task T047: Primary path uses llmsvc.Client.ExtractEntities gRPC
// Fallback path uses LLMClient.Complete interface with prompt assembly
type Extractor struct {
	llmsvcClient *llmsvc.Client // Primary: specialized ExtractEntities RPC
	llm          LLMClient      // Fallback: generic LLM completion
	logger       *slog.Logger
}

// NewExtractor creates an Extractor with a fallback LLM client only.
// Deprecated: Use NewExtractorWithLLMSvc instead for llm-svc integration
func NewExtractor(llm LLMClient) *Extractor {
	return &Extractor{
		llm:    llm,
		logger: slog.Default().With("component", "nlp.Extractor"),
	}
}

// NewExtractorWithLLMSvc creates an Extractor that uses llmsvc.Client for extraction.
// Task T047: Use specialized ExtractEntities RPC for NER (named entity recognition)
// Falls back to llm (if provided) if llmsvc is unavailable
func NewExtractorWithLLMSvc(client *llmsvc.Client, llm LLMClient) *Extractor {
	logger := slog.Default().With("component", "nlp.Extractor")

	if client == nil {
		logger.Warn("llmsvc client is nil, extraction will use fallback")
	}

	return &Extractor{
		llmsvcClient: client,
		llm:          llm,
		logger:       logger,
	}
}

// ExtractionResult holds the result of entity and relationship extraction.
type ExtractionResult struct {
	Entities      []Entity       `json:"entities"`
	Relationships []Relationship `json:"relationships"`
}

// Entity represents a named entity extracted from text.
type Entity struct {
	ID         string  `json:"id"`          // Unique identifier
	Type       string  `json:"type"`        // Entity type (Person, Project, Technology, etc.)
	Name       string  `json:"name"`        // Entity text/value
	Confidence float32 `json:"confidence"` // Confidence score [0.0, 1.0]
}

// Relationship represents a connection between two extracted entities.
type Relationship struct {
	FromID     string  `json:"from_id"`     // Source entity ID
	ToID       string  `json:"to_id"`       // Target entity ID
	Type       string  `json:"type"`        // Relationship type (works_on, manages, uses, etc.)
	Confidence float32 `json:"confidence"` // Confidence score [0.0, 1.0]
}

// Extract performs entity and relationship extraction on the given text.
// Task T047: Primary path uses llmsvc.ExtractEntities gRPC
// Returns entities and relationships with confidence scores
func (e *Extractor) Extract(ctx context.Context, text string) (*ExtractionResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract: text is empty")
	}

	// Task T047: Try specialized ExtractEntities RPC if client available
	if e.llmsvcClient != nil {
		result, err := e.extractWithLLMSvc(ctx, text)
		if err == nil {
			e.logger.Debug("extraction via llmsvc succeeded", "entity_count", len(result.Entities), "relationship_count", len(result.Relationships))
			return result, nil
		}
		e.logger.Warn("llmsvc extraction failed, trying fallback", "err", err)
	}

	// Fallback: use LLMClient.Complete interface with prompt assembly
	if e.llm == nil {
		e.logger.Warn("no llm client available for extraction fallback")
		return &ExtractionResult{}, nil
	}

	e.logger.Debug("using fallback extraction path")
	return e.extractWithFallback(ctx, text)
}

// extractWithLLMSvc uses llmsvc.Client.ExtractEntities for NER.
// Task T047: Calls internal/llmsvc.Client.ExtractEntities gRPC
// Returns entities and relationships with confidence scores from llm-svc
func (e *Extractor) extractWithLLMSvc(ctx context.Context, text string) (*ExtractionResult, error) {
	if text == "" {
		return nil, fmt.Errorf("extract: text is empty")
	}

	e.logger.Debug("extracting entities via llmsvc", "text_len", len(text))

	// Call llmsvc.ExtractEntities with "ingestion" mode
	nerResult, err := e.llmsvcClient.ExtractEntities(ctx, text, "ingestion", "")
	if err != nil {
		return nil, fmt.Errorf("nlp.Extractor.extractWithLLMSvc: %w", err)
	}

	// Convert llmsvc.NERResult to ExtractionResult
	result := &ExtractionResult{
		Entities:      make([]Entity, len(nerResult.Entities)),
		Relationships: make([]Relationship, len(nerResult.Relationships)),
	}

	// Convert entities: use unique identifier based on type and name hash
	for i, e := range nerResult.Entities {
		result.Entities[i] = Entity{
			ID:         fmt.Sprintf("%s-%s", e.Type, hashEntityName(e.Name)), // Deterministic ID
			Type:       e.Type,
			Name:       e.Name,
			Confidence: e.Confidence, // Already float32 from proto
		}
	}

	// Convert relationships
	for i, r := range nerResult.Relationships {
		result.Relationships[i] = Relationship{
			FromID:     fmt.Sprintf("%s-%s", r.FromEntity, hashEntityName(r.FromEntity)),
			ToID:       fmt.Sprintf("%s-%s", r.ToEntity, hashEntityName(r.ToEntity)),
			Type:       r.RelationshipType,
			Confidence: r.Confidence, // Already float32 from proto
		}
	}

	e.logger.Debug("extracted entities and relationships",
		"entities", len(result.Entities),
		"relationships", len(result.Relationships),
		"model", nerResult.ModelName)

	return result, nil
}

// extractWithFallback uses LLMClient.Complete interface with prompt assembly.
// Falls back to this path if llmsvc is unavailable
func (e *Extractor) extractWithFallback(ctx context.Context, text string) (*ExtractionResult, error) {
	e.logger.Debug("extracting entities via fallback", "text_len", len(text))

	prompt := e.buildPrompt(text)

	response, err := e.llm.Complete(ctx, prompt)
	if err != nil {
		e.logger.Error("fallback llm completion failed", "err", err)
		return nil, fmt.Errorf("fallback llm call failed: %w", err)
	}

	var result ExtractionResult
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		e.logger.Warn("failed to parse extraction response", "err", err)
		return &ExtractionResult{}, nil
	}

	e.logger.Debug("fallback extraction succeeded",
		"entities", len(result.Entities),
		"relationships", len(result.Relationships))

	return &result, nil
}

// buildPrompt assembles extraction prompt from templates.
// Used only in fallback path (llmsvc has its own prompts)
func (e *Extractor) buildPrompt(text string) string {
	exPrompt := BuildExtractionPrompt(text, 2048)
	return fmt.Sprintf("%s\n\n%s", exPrompt.System, exPrompt.UserText)
}

// hashEntityName returns a simple hash of the entity name for deterministic ID generation.
// Used to create consistent entity IDs across multiple extractions
func hashEntityName(name string) string {
	// Simple hash: use first 8 characters + length
	// In production, could use SHA256 truncated to 8 chars
	if len(name) >= 8 {
		return name[:8]
	}
	return name
}
