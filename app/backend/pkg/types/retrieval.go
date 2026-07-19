package types

import "time"

// QueryRequest represents a knowledge graph query request
type QueryRequest struct {
	Query     string `json:"query"`
	Lang      string `json:"lang,omitempty"`
	UserID    string `json:"user_id,omitempty"` // For permission filtering
	SessionID string `json:"session_id,omitempty"` // Track query session
}

// QueryResponse represents the response to a knowledge query
type QueryResponse struct {
	QueryID       int              `json:"query_id"` // ID for feedback linkage
	Answer        string           `json:"answer"`
	Sources       []Source         `json:"sources,omitempty"`
	Entities      []Entity         `json:"entities,omitempty"`
	RelatedEntities []Entity       `json:"related_entities,omitempty"`
	Intent        Intent           `json:"intent"`
	Confidence    float64          `json:"confidence"` // Overall answer confidence
	LatencyMs     int64            `json:"latency_ms"`
	PipelineStage string           `json:"pipeline_stage,omitempty"` // Debug: which stage failed/succeeded
	Timestamp     time.Time        `json:"timestamp"`
}

// Source represents a source document/chunk that contributed to an answer
type Source struct {
	ChunkID     int       `json:"chunk_id"`
	FileID      int       `json:"file_id"`
	FileName    string    `json:"file_name"`
	FileType    string    `json:"file_type"` // docx, xlsx, pdf, etc.
	HeadingPath string    `json:"heading_path,omitempty"`
	Text        string    `json:"text,omitempty"` // Preview text
	Score       float64   `json:"score,omitempty"` // Relevance score
	CreatedAt   time.Time `json:"created_at"`
}

// Citation represents a specific citation in an answer
type Citation struct {
	Text    string  `json:"text"` // The cited text
	SourceID int   `json:"source_id"` // Reference to Source.ChunkID
	Score   float64 `json:"score,omitempty"`
}

// Intent represents the classified intent of a user query
type Intent string

const (
	IntentFindExpert          Intent = "find_expert"
	IntentFindDocument        Intent = "find_document"
	IntentFindProjectInfo     Intent = "find_project_info"
	IntentFindTechnologyUsage Intent = "find_technology_usage"
	IntentGeneralQuestion     Intent = "general_question"
)

// RetrievalStage enumerates the stages of the retrieval pipeline
type RetrievalStage string

const (
	StagePermissionFilter RetrievalStage = "permission_filter"     // Stage 0
	StageIntent           RetrievalStage = "intent_detection"      // Stage 1
	StageNER              RetrievalStage = "query_ner"             // Stage 2
	StageGraphExpand      RetrievalStage = "graph_expansion"       // Stage 3 (Option 1)
	StageSemanticSearch   RetrievalStage = "semantic_search"       // Stage 3/4 (Option 2)
	StageMergeDedup       RetrievalStage = "merge_dedup"           // Stage 4
	StageRerank           RetrievalStage = "reranking"             // Stage 5
	StageContextPack      RetrievalStage = "context_packing"       // Stage 6
	StageAnswerGen        RetrievalStage = "answer_generation"     // Stage 7
)

// RetrievalContext represents intermediate state during retrieval
type RetrievalContext struct {
	Query          string
	Intent         Intent
	ExtractedEntities []Entity
	CandidateSources []Source
	RerankedSources []Source
	TokenBudget    int
	UserPermissions map[int]string // file_id -> permission level
}

// RerankCandidate represents a candidate for reranking
type RerankCandidate struct {
	ID       int    `json:"id"`
	Text     string `json:"text"`
	Score    float64 `json:"score"`
	SourceID int    `json:"source_id"`
}
