package graph

import (
	"context"
	"fmt"
	"regexp"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// cypherIdentifierPattern matches a safe Cypher label/relationship-type
// identifier: letters, digits, underscore, not starting with a digit. Any
// value that doesn't match this is rejected rather than interpolated into a
// query string, since Neo4j's driver has no way to parameterize a label or
// relationship type (only property values) — string formatting is the only
// option, so untrusted input must be validated first to prevent Cypher
// injection.
var cypherIdentifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validCypherIdentifier(s string) bool {
	return cypherIdentifierPattern.MatchString(s)
}

type EntityDetail struct {
	ID    string
	Type  string
	Props map[string]interface{}
}

func (qb *QueryBuilder) GetEntityByID(ctx context.Context, entityID string) (*EntityDetail, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	query := `MATCH (e) WHERE e.id = $id RETURN labels(e) as labels, properties(e) as props`

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, map[string]interface{}{"id": entityID})
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			labels, _ := record.Get("labels")
			props, _ := record.Get("props")

			labelList := labels.([]interface{})
			label := ""
			if len(labelList) > 0 {
				label = labelList[0].(string)
			}

			propsMap := props.(map[string]interface{})

			return &EntityDetail{
				ID:    entityID,
				Type:  label,
				Props: propsMap,
			}, nil
		}

		return nil, nil
	})

	if err != nil {
		return nil, fmt.Errorf("GetEntityByID: %w", err)
	}

	if result == nil {
		return nil, nil
	}

	return result.(*EntityDetail), nil
}

func (qb *QueryBuilder) GetNeighbors(ctx context.Context, entityID string, depth int) ([]map[string]interface{}, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	if depth < 1 || depth > 3 {
		depth = 2
	}

	query := fmt.Sprintf(`
		MATCH (e {id: $id})-[r*1..%d]-(neighbor)
		RETURN DISTINCT neighbor.id as id, labels(neighbor) as labels, neighbor.name as name
	`, depth)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, map[string]interface{}{"id": entityID})
		if err != nil {
			return nil, err
		}

		var neighbors []map[string]interface{}
		for res.Next(ctx) {
			record := res.Record()
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
	})

	if err != nil {
		return nil, fmt.Errorf("GetNeighbors: %w", err)
	}

	return result.([]map[string]interface{}), nil
}

func (qb *QueryBuilder) FindPath(ctx context.Context, fromID, toID string, maxDepth int) ([]map[string]interface{}, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	if maxDepth < 1 || maxDepth > 3 {
		maxDepth = 2
	}

	query := fmt.Sprintf(`
		MATCH path = shortestPath((from {id: $from})-[*1..%d]-(to {id: $to}))
		WITH path, [node in nodes(path) | {id: node.id, type: labels(node)[0], name: node.name}] as nodes
		RETURN nodes, length(path) as length
	`, maxDepth)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, map[string]interface{}{"from": fromID, "to": toID})
		if err != nil {
			return nil, err
		}

		var path []map[string]interface{}
		if res.Next(ctx) {
			record := res.Record()
			nodes, _ := record.Get("nodes")

			nodeList := nodes.([]interface{})
			for _, n := range nodeList {
				nodeMap := n.(map[string]interface{})
				path = append(path, nodeMap)
			}
		}

		return path, nil
	})

	if err != nil {
		return nil, fmt.Errorf("FindPath: %w", err)
	}

	return result.([]map[string]interface{}), nil
}

func (qb *QueryBuilder) GetEntityCount(ctx context.Context, nodeType string) (int64, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	query := fmt.Sprintf("MATCH (e:%s) RETURN count(e) as count", nodeType)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			return count.(int64), nil
		}

		return int64(0), nil
	})

	if err != nil {
		return 0, fmt.Errorf("GetEntityCount: %w", err)
	}

	return result.(int64), nil
}

// ListNodes returns up to `limit` entity nodes, optionally filtered by label
// (e.g. "Person", "Project", "Technology", "Customer", "Department"), and
// scoped to allowedFileIDs (Stage-0 permission filtering per INVARIANT-1,
// same semantics as ListEntities: nil disables scoping, a non-nil empty
// slice means "no access to anything"). Used by GET /api/graph/nodes
// (tasks.md T185).
func (qb *QueryBuilder) ListNodes(ctx context.Context, label string, allowedFileIDs []int, limit int) ([]map[string]interface{}, error) {
	if label != "" && !validCypherIdentifier(label) {
		return nil, fmt.Errorf("ListNodes: invalid label %q", label)
	}

	if allowedFileIDs != nil && len(allowedFileIDs) == 0 {
		return []map[string]interface{}{}, nil
	}

	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	matchClause := "MATCH (n)"
	if label != "" {
		matchClause = fmt.Sprintf("MATCH (n:%s)", label)
	}

	params := map[string]interface{}{"limit": limit}
	whereClause := ""
	if allowedFileIDs != nil {
		ids := make([]interface{}, len(allowedFileIDs))
		for i, id := range allowedFileIDs {
			ids[i] = id
		}
		params["allowed_ids"] = ids
		whereClause = " WHERE n.source_file_id IN $allowed_ids"
	}

	query := matchClause + whereClause + " RETURN n.id as id, labels(n) as labels, properties(n) as props, coalesce(n.displayName, n.name, n.fileName, labels(n)[0]) as display_name LIMIT $limit"

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var nodes []map[string]interface{}
		for res.Next(ctx) {
			record := res.Record()
			id, _ := record.Get("id")
			props, _ := record.Get("props")
			displayName, _ := record.Get("display_name")

			propsMap, _ := props.(map[string]interface{})
			displayNameStr, _ := displayName.(string)

			nodes = append(nodes, map[string]interface{}{
				"id":         id,
				"label":      displayNameStr,
				"properties": propsMap,
			})
		}
		return nodes, nil
	})

	if err != nil {
		return nil, fmt.Errorf("ListNodes: %w", err)
	}

	nodes, _ := result.([]map[string]interface{})
	return nodes, nil
}

// ListEdges returns up to `limit` relationships, optionally filtered by
// relationship type (e.g. "WORKS_ON", "MEMBER_OF"), and scoped to
// allowedFileIDs on both endpoint nodes (same semantics as ListNodes/
// ListEntities). Used by GET /api/graph/edges (tasks.md T185).
func (qb *QueryBuilder) ListEdges(ctx context.Context, relType string, allowedFileIDs []int, limit int) ([]map[string]interface{}, error) {
	if relType != "" && !validCypherIdentifier(relType) {
		return nil, fmt.Errorf("ListEdges: invalid relationship type %q", relType)
	}

	if allowedFileIDs != nil && len(allowedFileIDs) == 0 {
		return []map[string]interface{}{}, nil
	}

	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	matchClause := "MATCH (a)-[r]->(b)"
	if relType != "" {
		matchClause = fmt.Sprintf("MATCH (a)-[r:%s]->(b)", relType)
	}

	params := map[string]interface{}{"limit": limit}
	whereClause := ""
	if allowedFileIDs != nil {
		ids := make([]interface{}, len(allowedFileIDs))
		for i, id := range allowedFileIDs {
			ids[i] = id
		}
		params["allowed_ids"] = ids
		whereClause = " WHERE a.source_file_id IN $allowed_ids AND b.source_file_id IN $allowed_ids"
	}

	query := matchClause + whereClause + " RETURN a.id as from, b.id as to, type(r) as type, properties(r) as props LIMIT $limit"

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var edges []map[string]interface{}
		for res.Next(ctx) {
			record := res.Record()
			from, _ := record.Get("from")
			to, _ := record.Get("to")
			edgeType, _ := record.Get("type")
			props, _ := record.Get("props")

			propsMap, _ := props.(map[string]interface{})

			edges = append(edges, map[string]interface{}{
				"from":       from,
				"to":         to,
				"type":       edgeType,
				"properties": propsMap,
			})
		}
		return edges, nil
	})

	if err != nil {
		return nil, fmt.Errorf("ListEdges: %w", err)
	}

	edges, _ := result.([]map[string]interface{})
	return edges, nil
}

// ListEntities returns up to `limit` entity nodes, optionally filtered by
// type, and scoped to allowedFileIDs (Stage-0 permission filtering per
// INVARIANT-1 / tasks.md T186). A node is included if either:
//   - it carries a `source_file_id` property that is in allowedFileIDs, or
//   - allowedFileIDs is nil (permission scoping disabled/not applicable, e.g.
//     internal callers), but NEVER when allowedFileIDs is a non-nil empty
//     slice (that means the caller has access to nothing).
//
// Nodes that lack a `source_file_id` property entirely are excluded once
// permission scoping is enabled, since their provenance cannot be verified —
// this is the secure-by-default behavior INVARIANT-1 requires until
// ingestion (Group B) stamps every extracted entity with its source file.
func (qb *QueryBuilder) ListEntities(ctx context.Context, entityType string, allowedFileIDs []int, limit int) ([]map[string]interface{}, error) {
	if entityType != "" && !validCypherIdentifier(entityType) {
		return nil, fmt.Errorf("ListEntities: invalid entity type %q", entityType)
	}

	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	if allowedFileIDs != nil && len(allowedFileIDs) == 0 {
		// Explicit empty allow-list: user has no access to anything.
		return []map[string]interface{}{}, nil
	}

	params := map[string]interface{}{"limit": limit}
	var whereClauses []string

	if allowedFileIDs != nil {
		ids := make([]interface{}, len(allowedFileIDs))
		for i, id := range allowedFileIDs {
			ids[i] = id
		}
		params["allowed_ids"] = ids
		whereClauses = append(whereClauses, "n.source_file_id IN $allowed_ids")
	}

	matchClause := "MATCH (n)"
	if entityType != "" {
		matchClause = fmt.Sprintf("MATCH (n:%s)", entityType)
	}

	query := matchClause
	if len(whereClauses) > 0 {
		query += " WHERE " + whereClauses[0]
	}
	query += " RETURN n.id as id, labels(n) as labels, properties(n) as props LIMIT $limit"

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		var entities []map[string]interface{}
		for res.Next(ctx) {
			record := res.Record()
			id, _ := record.Get("id")
			labels, _ := record.Get("labels")
			props, _ := record.Get("props")

			labelList, _ := labels.([]interface{})
			label := ""
			if len(labelList) > 0 {
				label, _ = labelList[0].(string)
			}
			propsMap, _ := props.(map[string]interface{})

			entities = append(entities, map[string]interface{}{
				"id":         id,
				"type":       label,
				"properties": propsMap,
			})
		}
		return entities, nil
	})

	if err != nil {
		return nil, fmt.Errorf("ListEntities: %w", err)
	}

	entities, _ := result.([]map[string]interface{})
	return entities, nil
}

// CountAllNodes returns the total node count across all labels. Used by
// GET /api/stats/overview when no label filter is given (GetEntityCount's
// Cypher template requires a non-empty label).
func (qb *QueryBuilder) CountAllNodes(ctx context.Context) (int64, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, "MATCH (n) RETURN count(n) as count", nil)
		if err != nil {
			return nil, err
		}
		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			return count.(int64), nil
		}
		return int64(0), nil
	})

	if err != nil {
		return 0, fmt.Errorf("CountAllNodes: %w", err)
	}

	return result.(int64), nil
}

func (qb *QueryBuilder) GetRelationshipCount(ctx context.Context) (int64, error) {
	session := qb.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	query := "MATCH ()-[r]->() RETURN count(r) as count"

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, query, nil)
		if err != nil {
			return nil, err
		}

		if res.Next(ctx) {
			record := res.Record()
			count, _ := record.Get("count")
			return count.(int64), nil
		}

		return int64(0), nil
	})

	if err != nil {
		return 0, fmt.Errorf("GetRelationshipCount: %w", err)
	}

	return result.(int64), nil
}
