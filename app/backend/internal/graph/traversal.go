package graph

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/rad-system/m365-knowledge-graph/pkg/types"
)

// ExpandedEntity represents an entity with its related context from graph expansion
type ExpandedEntity struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	Type       string                 `json:"type"`
	Confidence float64                `json:"confidence"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Distance   int                    `json:"distance"` // Hops from source in BFS
	Relations  []ExpandedRelation     `json:"relations,omitempty"`
}

// ExpandedRelation represents a relationship in the expanded entity context
type ExpandedRelation struct {
	TargetID   string  `json:"target_id"`
	TargetName string  `json:"target_name"`
	TargetType string  `json:"target_type"`
	Type       string  `json:"type"`
	Direction  string  `json:"direction"` // "outgoing" or "incoming"
	Confidence float64 `json:"confidence"`
}

// GraphTraversal performs BFS and pathfinding operations for Stage 3 graph expansion.
// Used during retrieval to expand query entities with related context from the graph.
type GraphTraversal struct {
	store *Neo4jStore
}

// NewGraphTraversal creates a new graph traversal instance
func NewGraphTraversal(store *Neo4jStore) *GraphTraversal {
	return &GraphTraversal{store: store}
}

// BFS performs breadth-first search from a start node up to maxDepth hops.
// Returns all reachable nodes with their properties and relationships.
// Used in Stage 3 of retrieval to expand query entities.
func (t *GraphTraversal) BFS(ctx context.Context, startNodeID string, maxDepth int) ([]ExpandedEntity, error) {
	if maxDepth < 1 {
		maxDepth = 1
	}
	if maxDepth > 3 {
		maxDepth = 3 // Cap at 3 to prevent runaway expansion
	}

	session := t.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	var entities []ExpandedEntity

	_, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Query to find all nodes reachable from start within maxDepth
		query := fmt.Sprintf(`
			MATCH (start {id: $start_id})
			MATCH (start)-[*0..%d]-(reachable)
			WITH reachable,
				 length(shortestPath((start)-[*]-(reachable))) as distance
			RETURN DISTINCT
				reachable.id as id,
				reachable.name as name,
				labels(reachable) as labels,
				reachable.confidence as confidence,
				distance,
				properties(reachable) as props
			ORDER BY distance ASC
		`, maxDepth)

		nodeRes, err := tx.Run(ctx, query, map[string]interface{}{"start_id": startNodeID})
		if err != nil {
			return nil, fmt.Errorf("BFS node query: %w", err)
		}

		for nodeRes.Next(ctx) {
			record := nodeRes.Record()
			id, _ := record.Get("id")
			name, _ := record.Get("name")
			labelList, _ := record.Get("labels")
			confidence, _ := record.Get("confidence")
			distance, _ := record.Get("distance")
			props, _ := record.Get("props")

			nodeType := "Entity"
			if labels, ok := labelList.([]interface{}); ok && len(labels) > 0 {
				nodeType = labels[0].(string)
			}

			conf := 0.0
			if confidence != nil {
				conf = confidence.(float64)
			}

			dist := int(distance.(int64))

			entity := ExpandedEntity{
				ID:         id.(string),
				Name:       name.(string),
				Type:       nodeType,
				Confidence: conf,
				Distance:   dist,
				Properties: toStringMap(props),
			}

			entities = append(entities, entity)
		}

		if nodeRes.Err() != nil {
			return nil, fmt.Errorf("BFS traversal error: %w", nodeRes.Err())
		}

		return nil, nil
	})

	if err != nil {
		return nil, err
	}

	slog.DebugContext(ctx, "BFS expansion completed",
		"start_node", startNodeID,
		"max_depth", maxDepth,
		"expanded_count", len(entities),
	)

	return entities, nil
}

// ExpandEntity is a convenient wrapper for single-entity expansion (Stage 3).
// Returns the entity and all its 1-hop neighbors with relationship types.
func (t *GraphTraversal) ExpandEntity(ctx context.Context, entityID string) (*ExpandedEntity, error) {
	entities, err := t.BFS(ctx, entityID, 2) // 2-hop expansion for context
	if err != nil {
		return nil, err
	}

	if len(entities) == 0 {
		return nil, fmt.Errorf("entity not found: %s", entityID)
	}

	// Return the source entity
	return &entities[0], nil
}

// FindShortestPath finds the shortest path between two entities.
// Useful for relationship discovery and entity linking.
func (t *GraphTraversal) FindShortestPath(ctx context.Context, fromID, toID string, maxDepth int) (*types.GraphPath, error) {
	if maxDepth < 1 {
		maxDepth = 1
	}
	if maxDepth > 5 {
		maxDepth = 5 // Cap at 5 to prevent expensive queries
	}

	session := t.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	var result *types.GraphPath

	_, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := fmt.Sprintf(`
			MATCH (from {id: $from_id})
			MATCH (to {id: $to_id})
			MATCH p = shortestPath((from)-[*1..%d]-(to))
			RETURN
				[node IN nodes(p) | {id: node.id, name: node.name, type: labels(node)[0]}] as nodes,
				[rel IN relationships(p) | {type: type(rel), from: startNode(rel).id, to: endNode(rel).id}] as edges,
				length(p) as distance
		`, maxDepth)

		res, err := tx.Run(ctx, query, map[string]interface{}{
			"from_id": fromID,
			"to_id":   toID,
		})

		if err != nil {
			return nil, fmt.Errorf("path query: %w", err)
		}

		if res.Next(ctx) {
			record := res.Record()
			nodeList, _ := record.Get("nodes")
			edgeList, _ := record.Get("edges")
			distance, _ := record.Get("distance")

			graphPath := &types.GraphPath{
				Distance: int(distance.(int64)),
				Nodes:    []*types.GraphNode{},
				Edges:    []*types.GraphEdge{},
			}

			// Parse nodes
			for _, n := range nodeList.([]interface{}) {
				nodeMap := n.(map[string]interface{})
				node := &types.GraphNode{
					ID:    nodeMap["id"].(string),
					Label: nodeMap["type"].(string),
				}
				graphPath.Nodes = append(graphPath.Nodes, node)

				// Set start/end
				if graphPath.StartNode == nil {
					graphPath.StartNode = node
				}
				graphPath.EndNode = node
			}

			// Parse edges
			for _, e := range edgeList.([]interface{}) {
				edgeMap := e.(map[string]interface{})
				edge := &types.GraphEdge{
					Type: edgeMap["type"].(string),
					From: edgeMap["from"].(string),
					To:   edgeMap["to"].(string),
				}
				graphPath.Edges = append(graphPath.Edges, edge)
			}

			result = graphPath
		}

		return nil, nil
	})

	if err != nil {
		return nil, err
	}

	if result == nil {
		return nil, fmt.Errorf("no path found between %s and %s", fromID, toID)
	}

	return result, nil
}

// GetNeighbors returns immediate neighbors (1 hop) from a given node.
// Optionally filtered by relationship type.
func (t *GraphTraversal) GetNeighbors(ctx context.Context, nodeID string, relationType string) ([]ExpandedEntity, error) {
	session := t.store.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	var neighbors []ExpandedEntity

	_, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH (n {id: $id})-[r]-(neighbor)
		`

		if relationType != "" {
			query = fmt.Sprintf(`
				MATCH (n {id: $id})-[r:%s]-(neighbor)
			`, relationType)
		}

		query += `
			RETURN DISTINCT
				neighbor.id as id,
				neighbor.name as name,
				labels(neighbor) as labels,
				neighbor.confidence as confidence,
				properties(neighbor) as props,
				type(r) as rel_type
		`

		res, err := tx.Run(ctx, query, map[string]interface{}{"id": nodeID})
		if err != nil {
			return nil, fmt.Errorf("neighbors query: %w", err)
		}

		for res.Next(ctx) {
			record := res.Record()
			id, _ := record.Get("id")
			name, _ := record.Get("name")
			labels, _ := record.Get("labels")
			confidence, _ := record.Get("confidence")
			props, _ := record.Get("props")

			nodeType := "Entity"
			if labelList, ok := labels.([]interface{}); ok && len(labelList) > 0 {
				nodeType = labelList[0].(string)
			}

			conf := 0.0
			if confidence != nil {
				conf = confidence.(float64)
			}

			neighbor := ExpandedEntity{
				ID:         id.(string),
				Name:       name.(string),
				Type:       nodeType,
				Confidence: conf,
				Distance:   1,
				Properties: toStringMap(props),
			}

			neighbors = append(neighbors, neighbor)
		}

		return nil, nil
	})

	if err != nil {
		return nil, err
	}

	return neighbors, nil
}

// Helper methods

func toStringMap(props interface{}) map[string]interface{} {
	if props == nil {
		return make(map[string]interface{})
	}
	if m, ok := props.(map[string]interface{}); ok {
		return m
	}
	return make(map[string]interface{})
}
