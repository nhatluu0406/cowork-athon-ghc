package types

type QueryRequest struct {
	Query string `json:"query"`
	Lang  string `json:"lang,omitempty"`
}

type QueryResponse struct {
	Answer    string   `json:"answer"`
	Sources   []Source `json:"sources,omitempty"`
	Entities  []Entity `json:"entities,omitempty"`
	Intent    string   `json:"intent"`
	LatencyMs int      `json:"latency_ms"`
}

type Source struct {
	ChunkID     int    `json:"chunk_id"`
	FileName    string `json:"file_name"`
	HeadingPath string `json:"heading_path,omitempty"`
}

type Intent string

const (
	IntentFindExpert          Intent = "find_expert"
	IntentFindDocument        Intent = "find_document"
	IntentFindProjectInfo     Intent = "find_project_info"
	IntentFindTechnologyUsage Intent = "find_technology_usage"
	IntentGeneralQuestion     Intent = "general_question"
)
