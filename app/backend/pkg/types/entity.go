package types

type Entity struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Name       string  `json:"name"`
	Email      string  `json:"email,omitempty"`
	Status     string  `json:"status,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
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
)

type Relationship struct {
	FromID     string  `json:"from_id"`
	ToID       string  `json:"to_id"`
	Type       string  `json:"type"`
	Confidence float64 `json:"confidence,omitempty"`
}
