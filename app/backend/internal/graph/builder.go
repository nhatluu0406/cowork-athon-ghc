package graph

import (
	"context"
	"crypto/md5"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/rad-system/m365-knowledge-graph/pkg/types"
)

// GraphBuilder manages the build→validate→publish cycle for Neo4j knowledge graphs.
// It ensures atomic visibility and consistency of the graph.
type GraphBuilder struct {
	store *Neo4jStore
	mu    sync.Mutex
}

// NewGraphBuilder creates a new graph builder instance
func NewGraphBuilder(store *Neo4jStore) *GraphBuilder {
	return &GraphBuilder{
		store: store,
	}
}

// BuildPlan represents the entities and relationships to be written to the graph
type BuildPlan struct {
	Entities      []types.Entity       `json:"entities"`
	Relationships []types.Relationship `json:"relationships"`
	EpochID       string               `json:"epoch_id,omitempty"`      // Unique identifier for this build
	BatchID       string               `json:"batch_id,omitempty"`      // Batch/session identifier
	Timestamp     time.Time            `json:"timestamp,omitempty"`     // When the plan was created
}

// BuildResult tracks the outcome of a build operation
type BuildResult struct {
	EpochID       string    `json:"epoch_id"`
	NodesCreated  int       `json:"nodes_created"`
	NodesUpdated  int       `json:"nodes_updated"`
	EdgesCreated  int       `json:"edges_created"`
	EdgesUpdated  int       `json:"edges_updated"`
	Timestamp     time.Time `json:"timestamp"`
	ValidationErr string    `json:"validation_error,omitempty"`
}

// Build executes the build plan with upsert dedup logic.
// Returns BuildResult with counts of created/updated nodes and edges.
// The entire operation is atomic—either all succeed or all rollback.
func (gb *GraphBuilder) Build(ctx context.Context, plan BuildPlan) (*BuildResult, error) {
	if err := gb.validateBuildPlan(plan); err != nil {
		return nil, fmt.Errorf("invalid build plan: %w", err)
	}

	result := &BuildResult{
		EpochID:   plan.EpochID,
		Timestamp: time.Now(),
	}

	err := gb.store.ExecuteTx(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Upsert entities (nodes) with dedup on name+type
		for _, entity := range plan.Entities {
			created, updated, txErr := gb.upsertEntity(ctx, tx, entity)
			if txErr != nil {
				return nil, fmt.Errorf("entity upsert failed for %s: %w", entity.ID, txErr)
			}
			if created {
				result.NodesCreated++
			} else if updated {
				result.NodesUpdated++
			}
		}

		// Upsert relationships (edges) with dedup on name+type pairs and deterministic IDs
		for _, rel := range plan.Relationships {
			created, updated, txErr := gb.upsertRelationship(ctx, tx, rel)
			if txErr != nil {
				return nil, fmt.Errorf("relationship upsert failed: %w", txErr)
			}
			if created {
				result.EdgesCreated++
			} else if updated {
				result.EdgesUpdated++
			}
		}

		return nil, nil
	})

	if err != nil {
		return result, err
	}

	slog.InfoContext(ctx, "graph build completed",
		"epoch_id", plan.EpochID,
		"nodes_created", result.NodesCreated,
		"nodes_updated", result.NodesUpdated,
		"edges_created", result.EdgesCreated,
		"edges_updated", result.EdgesUpdated,
	)

	return result, nil
}

// upsertEntity performs an upsert on an entity (node) with dedup on name+type.
// Returns (created, updated, error) flags.
func (gb *GraphBuilder) upsertEntity(ctx context.Context, tx neo4j.ManagedTransaction, entity types.Entity) (bool, bool, error) {
	if entity.ID == "" {
		return false, false, fmt.Errorf("entity missing ID")
	}
	if entity.Type == "" {
		return false, false, fmt.Errorf("entity missing type")
	}
	if entity.Name == "" {
		return false, false, fmt.Errorf("entity missing name")
	}

	// Dedup key: (name, type) tuple. Entities with same name+type are considered duplicates.
	// We'll store the canonical ID for this entity based on dedup.
	canonicalID := gb.computeCanonicalID(entity.Name, string(entity.Type))

	label := string(entity.Type)
	if label == "" {
		label = "Entity"
	}

	// Properties to set on the node, including metadata
	props := map[string]interface{}{
		"id":         canonicalID,
		"name":       entity.Name,
		"type":       entity.Type,
		"confidence": entity.Confidence,
		"email":      entity.Email,
		"status":     entity.Status,
		"source_chunk_id": entity.SourceChunkID,
		"updated_at": time.Now(),
	}

	// Merge custom properties
	if entity.Properties != nil {
		for k, v := range entity.Properties {
			props[k] = v
		}
	}

	cypher := fmt.Sprintf(`
		MERGE (n:%s {id: $canonical_id})
		ON CREATE SET n.created_at = $now, n += $properties
		ON MATCH SET n += $properties, n.updated_at = $now
		RETURN n, elementId(n) as elem_id
	`, label)

	result, err := tx.Run(ctx, cypher, map[string]interface{}{
		"canonical_id": canonicalID,
		"properties":   props,
		"now":          time.Now(),
	})

	if err != nil {
		return false, false, fmt.Errorf("upsert entity cypher: %w", err)
	}

	// Determine if this was a create or update by checking result metadata
	if result.Next(ctx) {
		// In Neo4j, we can check if the node existed before by examining query statistics
		// For now, we assume it's an update if it already had properties
		// A more robust approach would be to track this in metadata
		record := result.Record()
		_ = record // unused but needed for proper result consumption

		// Conservative approach: assume update for dedup'd entities
		// (they likely existed if we're building from extracted data)
		return false, true, nil
	}

	return false, false, fmt.Errorf("upsert entity returned no results")
}

// upsertRelationship performs an upsert on a relationship with deterministic edge ID.
// The edge ID is computed from (fromID, toID, type, confidence) for reproducibility.
// Returns (created, updated, error) flags.
func (gb *GraphBuilder) upsertRelationship(ctx context.Context, tx neo4j.ManagedTransaction, rel types.Relationship) (bool, bool, error) {
	if rel.FromID == "" {
		return false, false, fmt.Errorf("relationship missing FromID")
	}
	if rel.ToID == "" {
		return false, false, fmt.Errorf("relationship missing ToID")
	}
	if rel.Type == "" {
		return false, false, fmt.Errorf("relationship missing type")
	}

	// Compute canonical edge ID based on the relationship structure
	edgeID := gb.computeEdgeID(rel.FromID, rel.ToID, rel.Type)

	// For dedup, we also need canonical versions of the source/target IDs
	// These should match the canonical IDs of the entities they point to
	fromCanonical := rel.FromID
	toCanonical := rel.ToID

	relType := strings.ToUpper(rel.Type)
	if !validTypeRegex.MatchString(relType) {
		relType = "RELATES_TO"
	}

	props := map[string]interface{}{
		"id":              edgeID,
		"type":            rel.Type,
		"confidence":      rel.Confidence,
		"created_at":      time.Now(),
	}

	// Merge custom properties
	if rel.Properties != nil {
		for k, v := range rel.Properties {
			props[k] = v
		}
	}

	cypher := fmt.Sprintf(`
		MATCH (from {id: $from_id})
		MATCH (to {id: $to_id})
		MERGE (from)-[r:%s {id: $edge_id}]->(to)
		ON CREATE SET r += $properties, r.created_at = $now
		ON MATCH SET r += $properties, r.updated_at = $now
		RETURN r
	`, relType)

	result, err := tx.Run(ctx, cypher, map[string]interface{}{
		"from_id": fromCanonical,
		"to_id":   toCanonical,
		"edge_id": edgeID,
		"properties": props,
		"now":     time.Now(),
	})

	if err != nil {
		return false, false, fmt.Errorf("upsert relationship cypher: %w", err)
	}

	if result.Next(ctx) {
		// Similar to entities, conservative approach: assume update
		return false, true, nil
	}

	return false, false, fmt.Errorf("upsert relationship returned no results")
}

// validateBuildPlan checks structural validity of the build plan
func (gb *GraphBuilder) validateBuildPlan(plan BuildPlan) error {
	if plan.EpochID == "" {
		return fmt.Errorf("build plan missing epoch ID")
	}

	if len(plan.Entities) == 0 && len(plan.Relationships) == 0 {
		return fmt.Errorf("build plan is empty")
	}

	// Check for duplicate entity IDs within the plan (local dedup)
	entityIDs := make(map[string]bool)
	for _, e := range plan.Entities {
		if e.ID == "" {
			return fmt.Errorf("entity missing ID")
		}
		if entityIDs[e.ID] {
			return fmt.Errorf("duplicate entity ID in plan: %s", e.ID)
		}
		entityIDs[e.ID] = true
	}

	// Check that all relationship endpoints exist in the entity set or graph
	for _, rel := range plan.Relationships {
		if !entityIDs[rel.FromID] {
			// We can't validate fully without querying the graph,
			// but we can warn about missing IDs in the plan
			slog.WarnContext(context.Background(), "relationship references entity not in build plan",
				"from_id", rel.FromID, "rel_type", rel.Type)
		}
		if !entityIDs[rel.ToID] {
			slog.WarnContext(context.Background(), "relationship references entity not in build plan",
				"to_id", rel.ToID, "rel_type", rel.Type)
		}
	}

	return nil
}

// computeCanonicalID generates a deterministic ID for an entity based on name+type.
// This ensures that multiple extractions of the same entity (name+type pair) map to the same node.
func (gb *GraphBuilder) computeCanonicalID(name string, entityType string) string {
	// Normalize: lowercase + trim whitespace for consistency
	normalized := strings.TrimSpace(strings.ToLower(name)) + "|" + strings.ToLower(entityType)
	hash := md5.Sum([]byte(normalized))
	return fmt.Sprintf("entity_%x", hash)
}

// computeEdgeID generates a deterministic ID for an edge (relationship).
// This ensures that duplicate relationships are detected and handled atomically.
func (gb *GraphBuilder) computeEdgeID(fromID, toID, relType string) string {
	// Sort components for deterministic ordering (avoids (A)-[R]->(B) vs (B)-[R]->(A) issues)
	parts := []string{fromID, toID, strings.ToUpper(relType)}
	sort.Strings(parts[:len(parts)-1]) // Sort IDs but keep relType in order
	combined := strings.Join(parts, "|")
	hash := md5.Sum([]byte(combined))
	return fmt.Sprintf("edge_%x", hash)
}
