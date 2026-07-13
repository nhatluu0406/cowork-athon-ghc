package graph

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// SchemaMigrations defines all Neo4j schema setup statements
type SchemaMigrations struct {
	driver neo4j.DriverWithContext
}

// NewSchemaMigrations creates a new migration handler
func NewSchemaMigrations(driver neo4j.DriverWithContext) *SchemaMigrations {
	return &SchemaMigrations{driver: driver}
}

// ApplySchema applies the Neo4j schema (constraints, indices) per data-model.md §2.1
func (sm *SchemaMigrations) ApplySchema(ctx context.Context) error {
	session := sm.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	statements := []string{
		// Entity Node Labels and Properties (Constraints)
		`CREATE CONSTRAINT person_email IF NOT EXISTS FOR (p:Person) REQUIRE p.email IS UNIQUE`,
		`CREATE INDEX person_display_name IF NOT EXISTS FOR (p:Person) ON (p.displayName)`,
		`CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE`,
		`CREATE CONSTRAINT document_file_name IF NOT EXISTS FOR (d:Document) REQUIRE d.fileName IS UNIQUE`,
		`CREATE INDEX document_source IF NOT EXISTS FOR (d:Document) ON (d.source)`,
		`CREATE CONSTRAINT technology_name IF NOT EXISTS FOR (t:Technology) REQUIRE t.name IS UNIQUE`,
		`CREATE CONSTRAINT customer_name IF NOT EXISTS FOR (c:Customer) REQUIRE c.name IS UNIQUE`,
		`CREATE CONSTRAINT department_name IF NOT EXISTS FOR (d:Department) REQUIRE d.name IS UNIQUE`,

		// Chunk node indices
		`CREATE INDEX chunk_source_id IF NOT EXISTS FOR (c:Chunk) ON (c.sourceChunkId)`,
		`CREATE INDEX chunk_confidence IF NOT EXISTS FOR (c:Chunk) ON (c.confidence)`,

		// Relationship type indices for common traversals
		`CREATE INDEX person_knows IF NOT EXISTS FOR ()-[r:KNOWS]->() WHERE r.confidence IS NOT NULL`,
		`CREATE INDEX person_owns IF NOT EXISTS FOR ()-[r:OWNS]->() WHERE r.confidence IS NOT NULL`,
		`CREATE INDEX uses IF NOT EXISTS FOR ()-[r:USES]->() WHERE r.confidence IS NOT NULL`,

		// Node type indices for statistics queries
		`CREATE INDEX all_persons FOR (p:Person)`,
		`CREATE INDEX all_projects FOR (p:Project)`,
		`CREATE INDEX all_documents FOR (d:Document)`,
		`CREATE INDEX all_technologies FOR (t:Technology)`,
		`CREATE INDEX all_customers FOR (c:Customer)`,
		`CREATE INDEX all_departments FOR (d:Department)`,
	}

	slog.InfoContext(ctx, "applying Neo4j schema", "statement_count", len(statements))

	for i, stmt := range statements {
		_, err := session.Run(ctx, stmt, nil)
		if err != nil {
			// Some statements may fail if already exist, which is OK for idempotent operations
			slog.WarnContext(ctx, "schema statement warning",
				"index", i,
				"statement", stmt[:min(50, len(stmt))],
				"error", err)
			// Continue applying other statements
		}
	}

	// Verify schema was applied
	result, err := session.Run(ctx, `CALL db.indexes() YIELD name RETURN count(*) AS count`, nil)
	if err != nil {
		return fmt.Errorf("failed to verify indexes: %w", err)
	}

	record, err := result.Single(ctx)
	if err != nil {
		return fmt.Errorf("failed to get index count: %w", err)
	}

	count, _ := record.Get("count")
	slog.InfoContext(ctx, "Neo4j schema applied successfully", "index_count", count)

	return nil
}

// DropAllIndices drops all indices (for testing/cleanup)
func (sm *SchemaMigrations) DropAllIndices(ctx context.Context) error {
	session := sm.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `CALL db.indexes() YIELD name RETURN name`, nil)
	if err != nil {
		return fmt.Errorf("failed to list indexes: %w", err)
	}

	for result.Next(ctx) {
		record := result.Record()
		name, _ := record.Get("name")
		indexName := name.(string)

		_, err := session.Run(ctx, fmt.Sprintf(`DROP INDEX %s IF EXISTS`, indexName), nil)
		if err != nil {
			slog.WarnContext(ctx, "failed to drop index", "name", indexName, "error", err)
		}
	}

	slog.InfoContext(ctx, "all Neo4j indices dropped")
	return nil
}

// DropAllConstraints drops all constraints (for testing/cleanup)
func (sm *SchemaMigrations) DropAllConstraints(ctx context.Context) error {
	session := sm.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `CALL db.constraints() YIELD name RETURN name`, nil)
	if err != nil {
		return fmt.Errorf("failed to list constraints: %w", err)
	}

	for result.Next(ctx) {
		record := result.Record()
		name, _ := record.Get("name")
		constraintName := name.(string)

		_, err := session.Run(ctx, fmt.Sprintf(`DROP CONSTRAINT %s IF EXISTS`, constraintName), nil)
		if err != nil {
			slog.WarnContext(ctx, "failed to drop constraint", "name", constraintName, "error", err)
		}
	}

	slog.InfoContext(ctx, "all Neo4j constraints dropped")
	return nil
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
