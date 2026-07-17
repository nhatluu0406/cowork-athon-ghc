// +build integration

package retrieval

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// Connection defaults match docker-compose.yml at the repo root; override via
// env vars for CI or alternate environments.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func setupTestDB(t *testing.T) *sql.DB {
	dsn := envOr("TEST_DATABASE_URL", "postgres://m365kg:m365kg_dev_password@localhost:5432/m365kg?sslmode=disable")
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("cannot open test database: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Skipf("cannot connect to test database (is docker-compose up?): %v", err)
	}
	return db
}

func setupTestNeo4j(t *testing.T) neo4j.DriverWithContext {
	uri := envOr("TEST_NEO4J_URI", "bolt://localhost:7687")
	user := envOr("TEST_NEO4J_USERNAME", "neo4j")
	pass := envOr("TEST_NEO4J_PASSWORD", "m365kg_dev_password")

	driver, err := neo4j.NewDriverWithContext(uri, neo4j.BasicAuth(user, pass, ""))
	if err != nil {
		t.Skipf("cannot create Neo4j driver: %v", err)
	}
	if err := driver.VerifyConnectivity(context.Background()); err != nil {
		t.Skipf("cannot connect to test Neo4j (is docker-compose up?): %v", err)
	}
	return driver
}

// cleanupFeedbackFixtures removes rows this test suite inserted, keyed by a
// unique marker in user_id/query_text, so repeated runs don't accumulate.
func cleanupTestFixtures(t *testing.T, db *sql.DB, marker string) {
	t.Helper()
	_, _ = db.Exec(`DELETE FROM permission_cache WHERE user_id LIKE $1`, marker+"%")
	_, _ = db.Exec(`DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE content_hash LIKE $1)`, marker+"%")
	_, _ = db.Exec(`DELETE FROM chunks WHERE content_hash LIKE $1`, marker+"%")
	_, _ = db.Exec(`DELETE FROM m365_files WHERE source_id LIKE $1`, marker+"%")
}
