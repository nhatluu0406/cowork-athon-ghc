package llmsvc

// Type aliases and helper types for convenient use of the llmsvc API.
// These types wrap or alias the proto-generated types for easier consumption
// by the Go backend.

// DocumentForReranking is a convenience struct for creating RerankDocuments.
type DocumentForReranking struct {
	DocID    string
	Text     string
	Metadata string
}

// ScoredDocument represents a reranked document result.
type ScoredDocument struct {
	DocID string
	Score float32
	Rank  int32
}

// NERResult holds the result of entity extraction.
type NERResult struct {
	Entities      []*NEREntity
	Relationships []*NERRelationship
	ModelName     string
}

// NEREntity is an extracted entity.
type NEREntity struct {
	Name       string
	Type       string
	Confidence float32
	Metadata   string
}

// NERRelationship is an extracted relationship between entities.
type NERRelationship struct {
	FromEntity       string
	RelationshipType string
	ToEntity         string
	Confidence       float32
	Metadata         string
}

// CompressionResult holds the result of context compression.
type CompressionResult struct {
	CompressedContext string
	OriginalTokens    int32
	CompressedTokens  int32
	CompressionRatio  float32
}

// IntentDetectionResult holds the detected intent.
type IntentDetectionResult struct {
	Intent     string
	Confidence float32
	Attributes string
}

// GeneratedAnswer holds the generated answer with metadata.
type GeneratedAnswer struct {
	Answer     string
	Citations  []string
	ModelName  string
	TokensUsed int32
	LatencyMs  int32
}

// ModelMetadata describes an available model.
type ModelMetadata struct {
	Name       string
	Kind       string
	Format     string
	Dimensions int32
	Version    string
	IsLocal    bool
	IsDefault  bool
	Metadata   string
}
