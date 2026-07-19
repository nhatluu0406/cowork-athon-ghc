// Package nlp provides NLP operations for entity extraction.
// Task T049: Extraction prompt templates
package nlp

import "fmt"

// System prompts for different extraction contexts

// SystemPromptIngestion is used for extracting entities from document chunks (ingestion time)
const SystemPromptIngestion = `You are an entity extraction expert for enterprise knowledge graphs.
Extract entities and relationships from the given text to build a knowledge base.

Entity types to extract:
- Person: individuals with names, emails, roles, departments
- Project: initiatives, programs, campaigns, work streams
- Document: files, reports, specifications, emails, messages
- Technology: tools, frameworks, languages, services, platforms
- Customer: external organizations, clients, vendors, partners
- Department: internal teams, divisions, business units
- Date: important dates, deadlines, milestones
- Amount: financial figures, budgets, metrics

Relationship types:
- WORKS_ON: person works on project
- MANAGES: person manages team/project
- USES: project/person uses technology
- BELONGS_TO: entity belongs to department/organization
- CREATED: person/team created document/project
- MENTIONS: document/text mentions entity
- AUTHORED: person authored document
- LEADS: person leads team/project
- COLLABORATES_WITH: person collaborates with other entities
- DEPENDS_ON: project depends on technology/resource
- REFERENCES: document references other entities
- INVOLVES: project/activity involves person/team

Instructions:
1. Extract ALL entities mentioned explicitly in the text
2. For each entity, assign the most specific type
3. Extract relationships where there is clear evidence in the text
4. Assign confidence scores based on certainty (0.0=uncertain, 1.0=certain)
5. Return ONLY valid JSON matching the schema

Confidence scoring:
- 1.0: Explicitly stated, unambiguous
- 0.8: Clear context, high confidence
- 0.6: Reasonably inferred, medium confidence
- 0.4: Implied or inferred with some uncertainty
- 0.2: Possible but weak evidence
- 0.0: Highly speculative`

// SystemPromptQuery is used for extracting entities from user questions (query time)
const SystemPromptQuery = `You are an entity extraction expert helping to understand user queries in an enterprise knowledge graph system.
Extract entity references and relationships from the user's question to help with retrieval.

Entity types:
- Person: names of people
- Project: project/initiative names
- Document: document/file references
- Technology: technology/tool names
- Customer: organization names
- Department: team/division names

Relationship types:
- Works on, manages, uses, belongs to, created, collaborates with, etc.

Instructions:
1. Extract only entities explicitly mentioned in the query
2. Focus on entities relevant to answering the question
3. Assign confidence scores based on certainty
4. Return ONLY valid JSON matching the schema`

// SystemPromptReextraction is used for re-evaluating low-confidence extractions
const SystemPromptReextraction = `You are an entity extraction expert reviewing previous extraction results.
Your task is to validate or correct low-confidence relationships identified in a previous pass.

For each relationship listed, determine:
1. Is the relationship actually supported by the text?
2. If supported, what is the correct confidence score?
3. Are there any alternative interpretations?

Return updated confidence scores and corrected relationships.`

type ExtractionPrompt struct {
	System   string
	UserText string
}

// BuildExtractionPrompt builds a prompt for initial entity extraction from document chunks.
// Task T049: Extraction prompt templates
// truncates text to maxLength characters if needed
func BuildExtractionPrompt(text string, maxLength int) ExtractionPrompt {
	if len(text) > maxLength {
		text = text[:maxLength] + "... [truncated]"
	}

	userText := fmt.Sprintf(`Extract entities and relationships from this text:

TEXT:
%s

Return JSON with structure:
{
  "entities": [
    {
      "id": "string (unique identifier)",
      "type": "Person|Project|Document|Technology|Customer|Department|Date|Amount",
      "name": "string (entity text/name)",
      "confidence": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "from_id": "string (source entity id)",
      "to_id": "string (target entity id)",
      "type": "WORKS_ON|MANAGES|USES|BELONGS_TO|CREATED|MENTIONS|etc",
      "confidence": 0.0-1.0
    }
  ]
}`, text)

	return ExtractionPrompt{
		System:   SystemPromptIngestion,
		UserText: userText,
	}
}

// BuildQueryExtractionPrompt builds a prompt for extracting entities from user queries.
// Task T049: Used at retrieval Stage 2 (Query NER)
func BuildQueryExtractionPrompt(query string) ExtractionPrompt {
	if len(query) > 500 {
		query = query[:500] + "..."
	}

	userText := fmt.Sprintf(`Extract entity references from this user question:

QUESTION:
%s

Return JSON with structure:
{
  "entities": [
    {
      "id": "string",
      "type": "Person|Project|Document|Technology|Customer|Department",
      "name": "string",
      "confidence": 0.0-1.0
    }
  ],
  "relationships": []
}`, query)

	return ExtractionPrompt{
		System:   SystemPromptQuery,
		UserText: userText,
	}
}

// BuildReextractionPrompt builds a prompt for re-evaluating low-confidence relationships.
// Task T049: Used in feedback-driven Phase 6 re-evaluation
// lowConfidenceEdges: JSON string of edges to re-evaluate
func BuildReextractionPrompt(text, lowConfidenceEdges string) ExtractionPrompt {
	if len(text) > 2048 {
		text = text[:2048] + "... [truncated]"
	}

	userText := fmt.Sprintf(`Re-evaluate this text for low-confidence relationships.
The following relationships were extracted with low confidence and need validation:

LOW CONFIDENCE EDGES:
%s

TEXT:
%s

For each edge, determine:
1. Is it supported by the text? (yes/no)
2. What is the correct confidence score? (0.0-1.0)
3. Any corrections needed?

Return the same JSON schema with updated confidence scores and corrected relationships.`, lowConfidenceEdges, text)

	return ExtractionPrompt{
		System:   SystemPromptReextraction,
		UserText: userText,
	}
}

// BuildFinetuningDatasetPrompt builds a prompt for evaluating Q&A pair quality.
// Task T049: Used in feedback loop for fine-tuning dataset creation (Phase 6)
// Returns a prompt string (not ExtractionPrompt, as this is for quality evaluation, not extraction)
func BuildFinetuningDatasetPrompt(queryText, answerText string) string {
	return fmt.Sprintf(`Evaluate the quality and relevance of this Q&A pair for fine-tuning a knowledge graph QA system:

QUESTION:
%s

ANSWER:
%s

Evaluate:
1. Is the answer relevant to the question? (yes/no)
2. Is the answer factually correct based on available knowledge? (yes/no)
3. Does the answer cite sources? (yes/no)
4. How would you rate the overall quality? (poor/fair/good/excellent)

Return JSON with structure:
{
  "is_relevant": boolean,
  "is_correct": boolean,
  "has_citations": boolean,
  "quality_score": 0.0-1.0,
  "quality_level": "poor|fair|good|excellent",
  "feedback": "string with suggestions for improvement"
}`, queryText, answerText)
}

// BuildEntityDisambiguationPrompt helps disambiguate entities when the same name could refer to multiple entities.
// Useful for handling duplicate or ambiguous entity mentions
func BuildEntityDisambiguationPrompt(entityName, context string, candidates []string) ExtractionPrompt {
	candidateList := ""
	for i, c := range candidates {
		candidateList += fmt.Sprintf("%d. %s\n", i+1, c)
	}

	userText := fmt.Sprintf(`Disambiguate the entity reference:

ENTITY NAME: %s

CONTEXT:
%s

CANDIDATE INTERPRETATIONS:
%s

Select the most likely interpretation based on context. If none fit, describe what the entity likely refers to.

Return JSON:
{
  "best_match": "string (either matching one of the candidates or a new description)",
  "confidence": 0.0-1.0,
  "reasoning": "string explaining the choice"
}`, entityName, context, candidateList)

	return ExtractionPrompt{
		System:   SystemPromptIngestion,
		UserText: userText,
	}
}
