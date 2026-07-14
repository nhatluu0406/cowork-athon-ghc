// +build integration

package connectors

import (
	"database/sql"
	"testing"

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

// teardownTestDB closes a test database connection
func teardownTestDB(t *testing.T, db *sql.DB) {
	if db != nil {
		if err := db.Close(); err != nil {
			t.Logf("Error closing test database: %v", err)
		}
	}
}
