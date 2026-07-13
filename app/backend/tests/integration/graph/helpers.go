// +build integration

package graph

import (
	"context"
	"database/sql"
	"testing"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	_ "github.com/lib/pq"
)

// setupTestDB initializes a test PostgreSQL database connection
func setupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("postgres", "postgres://test:test@localhost:5432/m365kg_test")
	if err != nil {
		t.Skipf("Cannot connect to test database: %v", err)
	}

	if err := db.Ping(); err != nil {
		t.Skipf("Cannot ping test database: %v", err)
	}

	return db
}

// setupTestNeo4j initializes a test Neo4j database connection
func setupTestNeo4j(t *testing.T) neo4j.DriverWithContext {
	driver, err := neo4j.NewDriverWithContext(
		"bolt://localhost:7687",
		neo4j.BasicAuth("neo4j", "password", ""),
	)
	if err != nil {
		t.Skipf("Cannot connect to test Neo4j: %v", err)
	}

	if err := driver.VerifyConnectivity(context.Background()); err != nil {
		t.Skipf("Cannot verify Neo4j connectivity: %v", err)
	}

	return driver
}
