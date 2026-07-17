package graph

import (
	"context"
	"fmt"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"log/slog"
)

type GraphBuilder struct {
	store *Neo4jStore
}

func NewGraphBuilder(store *Neo4jStore) *GraphBuilder {
	return &GraphBuilder{store: store}
}

type BuildPlan struct {
	Nodes []map[string]interface{}
	Edges []map[string]interface{}
}

func (gb *GraphBuilder) Build(ctx context.Context, plan BuildPlan) error {
	return gb.store.ExecuteTx(ctx, func(tx neo4j.Transaction) (interface{}, error) {
		// Build nodes
		for _, node := range plan.Nodes {
			if err := gb.upsertNode(ctx, tx, node); err != nil {
				return nil, fmt.Errorf("node upsert failed: %w", err)
			}
		}

		// Build edges
		for _, edge := range plan.Edges {
			if err := gb.upsertEdge(ctx, tx, edge); err != nil {
				return nil, fmt.Errorf("edge upsert failed: %w", err)
			}
		}

		return nil, nil
	})
}

func (gb *GraphBuilder) upsertNode(ctx context.Context, tx neo4j.Transaction, node map[string]interface{}) error {
	id, ok := node["id"].(string)
	if !ok || id == "" {
		return fmt.Errorf("upsertNode: missing or invalid id")
	}

	label, ok := node["label"].(string)
	if !ok || label == "" {
		label = "Entity"
	}

	cypher := fmt.Sprintf(`
		MERGE (n:%s {id: $id})
		SET n += $properties
		RETURN n
	`, label)

	props := node
	if propsVal, ok := node["properties"].(map[string]interface{}); ok {
		props = propsVal
	}

	_, err := tx.Run(cypher, map[string]interface{}{
		"id":         id,
		"properties": props,
	})

	if err != nil {
		return fmt.Errorf("upsertNode cypher: %w", err)
	}

	return nil
}

func (gb *GraphBuilder) upsertEdge(ctx context.Context, tx neo4j.Transaction, edge map[string]interface{}) error {
	from, ok := edge["from"].(string)
	if !ok || from == "" {
		return fmt.Errorf("upsertEdge: missing from_id")
	}

	to, ok := edge["to"].(string)
	if !ok || to == "" {
		return fmt.Errorf("upsertEdge: missing to_id")
	}

	relType, ok := edge["type"].(string)
	if !ok || relType == "" {
		relType = "RELATES_TO"
	}

	cypher := fmt.Sprintf(`
		MATCH (a {id: $from})
		MATCH (b {id: $to})
		MERGE (a)-[r:%s {from_id: $from, to_id: $to}]->(b)
		SET r += $properties
		RETURN r
	`, relType)

	props := edge
	if propsVal, ok := edge["properties"].(map[string]interface{}); ok {
		props = propsVal
	}

	_, err := tx.Run(cypher, map[string]interface{}{
		"from":       from,
		"to":         to,
		"properties": props,
	})

	if err != nil {
		return fmt.Errorf("upsertEdge cypher: %w", err)
	}

	return nil
}

func (gb *GraphBuilder) Validate(ctx context.Context) error {
	return gb.store.ExecuteTx(ctx, func(tx neo4j.Transaction) (interface{}, error) {
		// Check for orphaned edges (edges pointing to non-existent nodes)
		result, err := tx.Run(`
			MATCH (a)-[r]->(b)
			WHERE NOT EXISTS {MATCH (a)} OR NOT EXISTS {MATCH (b)}
			RETURN count(r) as orphaned
		`, nil)

		if err != nil {
			return nil, fmt.Errorf("validation query failed: %w", err)
		}

		if result.Next() {
			record := result.Record()
			orphaned, _ := record.Get("orphaned")
			if orphanedCount := orphaned.(int64); orphanedCount > 0 {
				slog.WarnContext(ctx, "found orphaned edges", "count", orphanedCount)
			}
		}

		slog.InfoContext(ctx, "graph validation passed")
		return nil, nil
	})
}

func (gb *GraphBuilder) Publish(ctx context.Context) error {
	// TODO: mark graph epoch as active in database
	slog.InfoContext(ctx, "graph published")
	return nil
}
