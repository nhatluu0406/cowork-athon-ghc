package unit_test

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// SetupTestDB creates an in-memory SQLite database for testing
func SetupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("Failed to create test database: %v", err)
	}

	// Create tables
	schema := `
	CREATE TABLE model_versions (
		id INTEGER PRIMARY KEY,
		model_type TEXT NOT NULL,
		base_model TEXT NOT NULL,
		version_tag TEXT NOT NULL UNIQUE,
		fine_tuning_job_id TEXT,
		training_pairs_count INTEGER,
		validation_accuracy REAL,
		is_active BOOLEAN DEFAULT 0,
		promoted_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE ab_test_cohorts (
		id INTEGER PRIMARY KEY,
		model_version_id INTEGER NOT NULL,
		cohort_name TEXT NOT NULL,
		traffic_percentage REAL NOT NULL,
		start_at DATETIME NOT NULL,
		end_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(model_version_id, cohort_name)
	);

	CREATE TABLE ab_test_results (
		id INTEGER PRIMARY KEY,
		cohort_id INTEGER NOT NULL,
		query_id INTEGER NOT NULL,
		model_version_id INTEGER NOT NULL,
		accuracy_score REAL,
		latency_ms INTEGER,
		token_usage INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE fine_tuning_jobs (
		id INTEGER PRIMARY KEY,
		model_type TEXT NOT NULL,
		base_model TEXT NOT NULL,
		training_pairs_count INTEGER,
		status TEXT NOT NULL DEFAULT 'queued',
		anthropic_job_id TEXT,
		error_message TEXT,
		started_at DATETIME,
		completed_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE query_logs (
		id INTEGER PRIMARY KEY,
		user_id TEXT,
		query_text TEXT,
		intent TEXT,
		results_count INTEGER,
		latency_ms INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE feedback_events (
		id INTEGER PRIMARY KEY,
		query_id INTEGER,
		user_id TEXT,
		feedback_type TEXT,
		comment TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(query_id) REFERENCES query_logs(id)
	);
	`

	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		t.Fatalf("Failed to create schema: %v", err)
	}

	return db
}

// TeardownTestDB closes the database connection
func TeardownTestDB(t *testing.T, db *sql.DB) {
	if err := db.Close(); err != nil {
		t.Logf("Warning: Failed to close test database: %v", err)
	}
}
