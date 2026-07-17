package graph

import (
	"context"
	"fmt"
)

type Traversal struct {
	store *Neo4jStore
}

func NewTraversal(store *Neo4jStore) *Traversal {
	return &Traversal{store: store}
}

func (t *Traversal) BFS(ctx context.Context, startNodeID string, depth int) ([]map[string]interface{}, error) {
	if depth < 1 || depth > 3 {
		depth = 2
	}

	query := fmt.Sprintf(`
		MATCH (start {id: $id})
		MATCH (start)-[*1..%d]-(neighbor)
		RETURN DISTINCT neighbor.id as id, labels(neighbor) as labels, neighbor.name as name
	`, depth)

	result, err := t.store.Run(ctx, query, map[string]interface{}{"id": startNodeID})
	if err != nil {
		return nil, fmt.Errorf("BFS query: %w", err)
	}

	var neighbors []map[string]interface{}
	for result.Next() {
		record := result.Record()
		id, _ := record.Get("id")
		labels, _ := record.Get("labels")
		name, _ := record.Get("name")

		labelList := labels.([]interface{})
		label := ""
		if len(labelList) > 0 {
			label = labelList[0].(string)
		}

		neighbors = append(neighbors, map[string]interface{}{
			"id":    id,
			"type":  label,
			"name":  name,
		})
	}

	return neighbors, nil
}

func (t *Traversal) FindPath(ctx context.Context, fromID, toID string, maxDepth int) ([][]string, error) {
	if maxDepth < 1 || maxDepth > 3 {
		maxDepth = 2
	}

	query := fmt.Sprintf(`
		MATCH path = shortestPath((from {id: $from})-[*1..%d]-(to {id: $to}))
		RETURN [node IN nodes(path) | node.id] as path_ids
	`, maxDepth)

	result, err := t.store.Run(ctx, query, map[string]interface{}{
		"from": fromID,
		"to":   toID,
	})

	if err != nil {
		return nil, fmt.Errorf("FindPath query: %w", err)
	}

	var paths [][]string
	if result.Next() {
		record := result.Record()
		pathIDs, _ := record.Get("path_ids")

		idList := pathIDs.([]interface{})
		var path []string
		for _, id := range idList {
			path = append(path, id.(string))
		}
		paths = append(paths, path)
	}

	return paths, nil
}

func (t *Traversal) GetNeighbors(ctx context.Context, nodeID string, relationType string) ([]map[string]interface{}, error) {
	query := fmt.Sprintf(`
		MATCH (n {id: $id})-[r:%s]-(neighbor)
		RETURN DISTINCT neighbor.id as id, labels(neighbor) as labels, neighbor.name as name
	`, relationType)

	result, err := t.store.Run(ctx, query, map[string]interface{}{"id": nodeID})
	if err != nil {
		return nil, fmt.Errorf("GetNeighbors query: %w", err)
	}

	var neighbors []map[string]interface{}
	for result.Next() {
		record := result.Record()
		id, _ := record.Get("id")
		labels, _ := record.Get("labels")
		name, _ := record.Get("name")

		labelList := labels.([]interface{})
		label := ""
		if len(labelList) > 0 {
			label = labelList[0].(string)
		}

		neighbors = append(neighbors, map[string]interface{}{
			"id":    id,
			"type":  label,
			"name":  name,
		})
	}

	return neighbors, nil
}
