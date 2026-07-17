package nlp

import "fmt"

const SystemPrompt = `You are an entity extraction expert for enterprise knowledge graphs. Extract entities and relationships from the given text.

Entity types to extract:
- Person: individuals with names, emails, roles
- Project: initiatives, programs, campaigns
- Document: files, reports, specifications
- Technology: tools, frameworks, languages, services
- Customer: external organizations
- Department: internal teams or divisions
- Chunk: the text segment itself (used for source tracing)

For each relationship, identify:
- source entity (from_entity_id): the subject
- target entity (to_entity_id): the object
- relationship type: works_on, created, used_by, belongs_to, mentions, authored, leads, etc.

Return ONLY valid JSON matching the schema. Include confidence (0.0-1.0) for each extraction.`

type ExtractionPrompt struct {
	System   string
	UserText string
}

func BuildExtractionPrompt(text string, maxLength int) ExtractionPrompt {
	if len(text) > maxLength {
		text = text[:maxLength] + "..."
	}

	userText := fmt.Sprintf(`Extract entities and relationships from this text:

TEXT:
%s

Return JSON with structure:
{
  "entities": [
    {"id": "string", "type": "Person|Project|Document|Technology|Customer|Department|Chunk", "name": "string", "confidence": 0.0-1.0}
  ],
  "relationships": [
    {"from_entity_id": "string", "to_entity_id": "string", "relationship_type": "string", "confidence": 0.0-1.0}
  ]
}`, text)

	return ExtractionPrompt{
		System:   SystemPrompt,
		UserText: userText,
	}
}

func BuildReextractionPrompt(text, lowConfidenceEdges string) ExtractionPrompt {
	userText := fmt.Sprintf(`Re-evaluate this text for low-confidence relationships. Focus on validating or correcting:

LOW CONFIDENCE EDGES:
%s

TEXT:
%s

Return the same JSON schema with updated confidence scores and corrected relationships.`, lowConfidenceEdges, text)

	return ExtractionPrompt{
		System:   SystemPrompt,
		UserText: userText,
	}
}

func BuildFinetuningDatasetPrompt(queryText, answerText string) string {
	return fmt.Sprintf(`Query: %s

Answer: %s

Evaluate the quality and relevance of this Q&A pair for fine-tuning. Return a confidence score (0.0-1.0) and feedback.`, queryText, answerText)
}
