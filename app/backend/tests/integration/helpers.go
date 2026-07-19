// +build integration

package integration

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

// setupTestDB initializes a test database connection (PostgreSQL or SQLite)
// Checks for DATABASE_URL environment variable for PostgreSQL, falls back to SQLite
func setupTestDB(t *testing.T) *sql.DB {
	dbURL := os.Getenv("DATABASE_URL")

	// If PostgreSQL connection string is provided, use it
	if dbURL != "" {
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			t.Skipf("Cannot connect to PostgreSQL test database: %v", err)
		}

		if err := db.PingContext(context.Background()); err != nil {
			t.Skipf("Cannot ping PostgreSQL test database: %v", err)
		}

		return db
	}

	// Fall back to SQLite for local integration testing
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Skipf("Cannot create SQLite test database: %v", err)
	}

	if err := db.PingContext(context.Background()); err != nil {
		t.Skipf("Cannot ping SQLite test database: %v", err)
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

// TestContext provides a context with timeout for integration tests
type TestContext struct {
	Context context.Context
	Cancel  context.CancelFunc
}

// NewTestContext creates a new context with timeout
func NewTestContext(t *testing.T, timeout time.Duration) *TestContext {
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	return &TestContext{
		Context: ctx,
		Cancel:  cancel,
	}
}

// Close cancels the context
func (tc *TestContext) Close() {
	if tc.Cancel != nil {
		tc.Cancel()
	}
}

// IntegrationTestHelper provides utilities for integration tests
type IntegrationTestHelper struct {
	DB           *sql.DB
	MockServer   *MockM365Server
	TestContext  *TestContext
	t             *testing.T
}

// NewIntegrationTestHelper creates a new integration test helper
func NewIntegrationTestHelper(t *testing.T) *IntegrationTestHelper {
	return &IntegrationTestHelper{
		DB:          setupTestDB(t),
		MockServer:  NewMockM365Server(),
		TestContext: NewTestContext(t, 30*time.Second),
		t:           t,
	}
}

// Close cleans up all resources
func (h *IntegrationTestHelper) Close() {
	if h.TestContext != nil {
		h.TestContext.Close()
	}

	if h.MockServer != nil {
		h.MockServer.Close()
	}

	teardownTestDB(h.t, h.DB)
}

// Exec executes a query in the test database
func (h *IntegrationTestHelper) Exec(query string, args ...interface{}) (sql.Result, error) {
	return h.DB.ExecContext(h.TestContext.Context, query, args...)
}

// Query queries the test database
func (h *IntegrationTestHelper) Query(query string, args ...interface{}) (*sql.Rows, error) {
	return h.DB.QueryContext(h.TestContext.Context, query, args...)
}

// QueryRow queries a single row in the test database
func (h *IntegrationTestHelper) QueryRow(query string, args ...interface{}) *sql.Row {
	return h.DB.QueryRowContext(h.TestContext.Context, query, args...)
}

// MustExec executes a query and fails the test if it errors
func (h *IntegrationTestHelper) MustExec(query string, args ...interface{}) sql.Result {
	result, err := h.Exec(query, args...)
	if err != nil {
		h.t.Fatalf("query failed: %v (query: %s)", err, query)
	}
	return result
}

// AssertRowCount asserts the number of rows in a table
func (h *IntegrationTestHelper) AssertRowCount(tableName string, expected int) {
	var count int
	err := h.QueryRow("SELECT COUNT(*) FROM " + tableName).Scan(&count)
	if err != nil && err != sql.ErrNoRows {
		h.t.Fatalf("failed to count rows: %v", err)
	}

	if count != expected {
		h.t.Errorf("expected %d rows in %s, got %d", expected, tableName, count)
	}
}
