package graph

import (
	"context"
	"fmt"
	"regexp"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

var (
	validLabelRegex = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	validTypeRegex  = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)
)

type Neo4jStore struct {
	driver neo4j.DriverWithContext
}

type Node struct {
	ID         string
	Label      string
	Properties map[string]any
}

type Relationship struct {
	FromID     string
	ToID       string
	Type       string
	Properties map[string]any
}

type QueryResult struct {
	Nodes         []*Node
	Relationships []*Relationship
}

func NewNeo4jStore(uri, user, pass string) (*Neo4jStore, error) {
	driver, err := neo4j.NewDriverWithContext(uri, neo4j.BasicAuth(user, pass, ""))
	if err != nil {
		return nil, fmt.Errorf("failed to create Neo4j driver: %w", err)
	}
	ctx := context.Background()
	if err := driver.VerifyConnectivity(ctx); err != nil {
		return nil, fmt.Errorf("failed to verify Neo4j connectivity: %w", err)
	}
	return &Neo4jStore{driver: driver}, nil
}

func (s *Neo4jStore) Close(ctx context.Context) error {
	return s.driver.Close(ctx)
}

func (s *Neo4jStore) Driver() neo4j.DriverWithContext {
	return s.driver
}

func (s *Neo4jStore) CreateNode(ctx context.Context, node *Node) error {
	if !validLabelRegex.MatchString(node.Label) {
		return fmt.Errorf("invalid node label: %s (must match ^[A-Za-z_][A-Za-z0-9_]*$)", node.Label)
	}

	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	query := fmt.Sprintf(`CREATE (n:%s {id: $id}) SET n += $properties RETURN n`, node.Label)
	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		params := map[string]any{
			"id":         node.ID,
			"properties": node.Properties,
		}
		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}
		_, err = result.Single(ctx)
		return nil, err
	})
	return err
}

func (s *Neo4jStore) CreateRelationship(ctx context.Context, rel *Relationship) error {
	if !validTypeRegex.MatchString(rel.Type) {
		return fmt.Errorf("invalid relationship type: %s (must match ^[A-Z_][A-Z0-9_]*$)", rel.Type)
	}

	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	query := fmt.Sprintf(`MATCH (from {id: $fromID}) MATCH (to {id: $toID}) CREATE (from)-[r:%s]->(to) SET r += $properties RETURN r`, rel.Type)
	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		params := map[string]any{
			"fromID":     rel.FromID,
			"toID":       rel.ToID,
			"properties": rel.Properties,
		}
		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}
		_, err = result.Single(ctx)
		return nil, err
	})
	return err
}

func (s *Neo4jStore) Query(ctx context.Context, cypher string, params map[string]any) (*QueryResult, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	_, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		_, err := tx.Run(ctx, cypher, params)
		return nil, err
	})

	if err != nil {
		return nil, fmt.Errorf("Neo4j query failed: %w", err)
	}
	return &QueryResult{}, nil
}

func (s *Neo4jStore) Traverse(ctx context.Context, startID string, maxDepth int) (*QueryResult, error) {
	query := fmt.Sprintf(`MATCH (start {id: $startID}) MATCH path = (start)-[*1..%d]-(n) RETURN DISTINCT n, relationships(path) as rels`, maxDepth)
	return s.Query(ctx, query, map[string]any{"startID": startID})
}

func (s *Neo4jStore) GetNode(ctx context.Context, id string) (*Node, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		records, err := tx.Run(ctx, "MATCH (n {id: $id}) RETURN n", map[string]any{"id": id})
		if err != nil {
			return nil, err
		}
		record, err := records.Single(ctx)
		return record, err
	})

	if err != nil {
		return nil, fmt.Errorf("node not found: %s", id)
	}

	record := result.(neo4j.Record)
	node, ok := record.Get("n")
	if !ok {
		return nil, fmt.Errorf("node not found: %s", id)
	}
	return &Node{
		ID:         id,
		Properties: node.(neo4j.Node).Props,
	}, nil
}

func (s *Neo4jStore) DeleteNode(ctx context.Context, id string) error {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		_, err := tx.Run(ctx, "MATCH (n {id: $id}) DETACH DELETE n", map[string]any{"id": id})
		return nil, err
	})
	return err
}

func (s *Neo4jStore) Run(ctx context.Context, query string, params map[string]any) (neo4j.ResultWithContext, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)
	return session.Run(ctx, query, params)
}

func (s *Neo4jStore) ExecuteTx(ctx context.Context, fn func(tx neo4j.ManagedTransaction) (any, error)) error {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)
	_, err := session.ExecuteWrite(ctx, neo4j.ManagedTransactionWork(fn))
	return err
}
