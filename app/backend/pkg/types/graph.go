package types

import "time"

// GraphNode represents a node in the knowledge graph (Neo4j or conceptual)
type GraphNode struct {
	ID         string                 `json:"id"`
	Label      string                 `json:"label"` // Node type/label (e.g., "Person", "Project")
	Properties map[string]interface{} `json:"properties,omitempty"`
	CreatedAt  time.Time              `json:"created_at,omitempty"`
	UpdatedAt  time.Time              `json:"updated_at,omitempty"`
}

// GraphEdge represents a relationship edge in the knowledge graph
type GraphEdge struct {
	ID         string                 `json:"id"`
	From       string                 `json:"from"`       // Node ID
	FromLabel  string                 `json:"from_label"` // Node label
	To         string                 `json:"to"`         // Node ID
	ToLabel    string                 `json:"to_label"`   // Node label
	Type       string                 `json:"type"`       // Relationship type (e.g., "MANAGES", "WORKS_ON")
	Confidence float64                `json:"confidence"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	CreatedAt  time.Time              `json:"created_at,omitempty"`
}

// GraphStats represents aggregate statistics about the knowledge graph
type GraphStats struct {
	NodeCount        int                `json:"node_count"`
	EdgeCount        int                `json:"edge_count"`
	MaxDegree        int                `json:"max_degree"`
	AvgDegree        float64            `json:"avg_degree"`
	NodesByType      map[string]int     `json:"nodes_by_type,omitempty"`
	EdgesByType      map[string]int     `json:"edges_by_type,omitempty"`
	AverageConfidence float64           `json:"average_confidence,omitempty"`
	LastUpdated      time.Time          `json:"last_updated"`
}

// GraphPath represents a path between two nodes in the graph
type GraphPath struct {
	StartNode *GraphNode `json:"start_node"`
	EndNode   *GraphNode `json:"end_node"`
	Nodes     []*GraphNode `json:"nodes"`
	Edges     []*GraphEdge `json:"edges"`
	Distance  int         `json:"distance"`
	TotalConfidence float64 `json:"total_confidence"`
}

// GraphQuery represents a query against the knowledge graph
type GraphQuery struct {
	StartNodeID string `json:"start_node_id"`
	EndNodeID   string `json:"end_node_id,omitempty"`
	Depth       int    `json:"depth,omitempty"` // BFS depth limit
	FilterTypes []string `json:"filter_types,omitempty"` // Filter by node types
}
