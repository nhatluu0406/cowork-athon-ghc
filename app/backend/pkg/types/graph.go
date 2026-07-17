package types

type GraphNode struct {
	ID         string                 `json:"id"`
	Label      string                 `json:"label"`
	Properties map[string]interface{} `json:"properties,omitempty"`
}

type GraphEdge struct {
	From       string  `json:"from"`
	To         string  `json:"to"`
	Type       string  `json:"type"`
	Confidence float64 `json:"confidence,omitempty"`
}

type GraphStats struct {
	NodeCount int     `json:"node_count"`
	EdgeCount int     `json:"edge_count"`
	MaxDegree int     `json:"max_degree"`
	AvgDegree float64 `json:"avg_degree"`
}
