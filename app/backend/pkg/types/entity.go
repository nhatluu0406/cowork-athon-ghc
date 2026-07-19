package types

import "time"

// Entity represents a business entity extracted from M365 content
type Entity struct {
	ID             string                 `json:"id"`
	Type           EntityType             `json:"type"`
	Name           string                 `json:"name"`
	Email          string                 `json:"email,omitempty"`
	Status         string                 `json:"status,omitempty"`
	Confidence     float64                `json:"confidence"`
	SourceChunkID  int                    `json:"source_chunk_id"`
	Properties     map[string]interface{} `json:"properties,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

type EntityType string

const (
	EntityPerson     EntityType = "Person"
	EntityProject    EntityType = "Project"
	EntityDocument   EntityType = "Document"
	EntityTechnology EntityType = "Technology"
	EntityCustomer   EntityType = "Customer"
	EntityDepartment EntityType = "Department"
	EntityChunk      EntityType = "Chunk"
	EntityDate       EntityType = "Date"
	EntityAmount     EntityType = "Amount"
)

// Relationship represents a connection between two entities
type Relationship struct {
	ID         string    `json:"id"`
	FromID     string    `json:"from_id"`
	FromType   EntityType `json:"from_type"`
	ToID       string    `json:"to_id"`
	ToType     EntityType `json:"to_type"`
	Type       string    `json:"type"`
	Confidence float64   `json:"confidence"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// RelationshipType enumerates valid relationship types in the business domain
type RelationshipType string

const (
	RelationshipManages    RelationshipType = "MANAGES"
	RelationshipWorksOn    RelationshipType = "WORKS_ON"
	RelationshipBelongsTo  RelationshipType = "BELONGS_TO"
	RelationshipMentions   RelationshipType = "MENTIONS"
	RelationshipCreatedBy  RelationshipType = "CREATED_BY"
	RelationshipUses       RelationshipType = "USES"
	RelationshipServing    RelationshipType = "SERVING"
	RelationshipPartOf     RelationshipType = "PART_OF"
	RelationshipRefers     RelationshipType = "REFERS"
	RelationshipDependsOn  RelationshipType = "DEPENDS_ON"
)

// ExtractionResult represents the output of NLP entity extraction
type ExtractionResult struct {
	Entities      []Entity        `json:"entities"`
	Relationships []Relationship  `json:"relationships"`
	SourceChunkID int             `json:"source_chunk_id"`
	Timestamp     time.Time       `json:"timestamp"`
}
