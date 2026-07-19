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

	// Enable WAL mode for better concurrency during testing
	if _, err := db.ExecContext(context.Background(), "PRAGMA journal_mode=WAL"); err != nil {
		t.Logf("Warning: could not enable WAL mode: %v", err)
	}

	// Enable busy timeout
	if _, err := db.ExecContext(context.Background(), "PRAGMA busy_timeout=5000"); err != nil {
		t.Logf("Warning: could not set busy timeout: %v", err)
	}

	// Create tables
	schema := `
	-- M365 Knowledge Graph schema for testing

	CREATE TABLE IF NOT EXISTS m365_files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_type TEXT NOT NULL,
		source_id TEXT NOT NULL,
		file_name TEXT NOT NULL,
		file_type TEXT,
		file_size INTEGER,
		content_hash TEXT,
		last_modified DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		permissions_json TEXT,
		UNIQUE(source_id)
	);

	CREATE TABLE IF NOT EXISTS chunks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_id INTEGER NOT NULL,
		chunk_index INTEGER NOT NULL,
		text TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		heading_path TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(file_id, chunk_index),
		FOREIGN KEY(file_id) REFERENCES m365_files(id)
	);

	CREATE TABLE IF NOT EXISTS embedding_models (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		version TEXT NOT NULL DEFAULT '',
		dims INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(name, version)
	);

	CREATE TABLE IF NOT EXISTS chunk_embeddings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chunk_id INTEGER NOT NULL,
		model_id INTEGER NOT NULL,
		embedding BLOB NOT NULL,
		embedding_hash TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(chunk_id, model_id),
		FOREIGN KEY(chunk_id) REFERENCES chunks(id),
		FOREIGN KEY(model_id) REFERENCES embedding_models(id)
	);

	CREATE TABLE IF NOT EXISTS embedding_jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		status TEXT NOT NULL DEFAULT 'queued',
		model_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		started_at DATETIME,
		finished_at DATETIME,
		error_message TEXT,
		FOREIGN KEY(model_id) REFERENCES embedding_models(id)
	);

	CREATE TABLE IF NOT EXISTS m365_connections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		tenant_id TEXT NOT NULL,
		config_json TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'active',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS delta_state (
		source TEXT PRIMARY KEY,
		change_token TEXT NOT NULL,
		has_more BOOLEAN NOT NULL DEFAULT 0,
		last_sync_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS permission_cache (
		user_id TEXT NOT NULL,
		file_id INTEGER NOT NULL,
		permission TEXT NOT NULL,
		PRIMARY KEY(user_id, file_id),
		FOREIGN KEY(file_id) REFERENCES m365_files(id)
	);

	CREATE TABLE IF NOT EXISTS query_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT,
		query_text TEXT,
		intent TEXT,
		results_count INTEGER,
		latency_ms INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS feedback_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		query_id INTEGER,
		user_id TEXT,
		feedback_type TEXT,
		comment TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(query_id) REFERENCES query_logs(id)
	);

	CREATE TABLE IF NOT EXISTS extraction_confidence (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		entity_id TEXT NOT NULL,
		relationship_type TEXT NOT NULL,
		target_entity_id TEXT NOT NULL,
		confidence REAL NOT NULL,
		feedback_score REAL,
		last_reevaluated DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS model_versions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
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

	CREATE TABLE IF NOT EXISTS ab_test_cohorts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		model_version_id INTEGER NOT NULL,
		cohort_name TEXT NOT NULL,
		traffic_percentage REAL NOT NULL,
		start_at DATETIME NOT NULL,
		end_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(model_version_id, cohort_name)
	);

	CREATE TABLE IF NOT EXISTS ab_test_results (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		cohort_id INTEGER NOT NULL,
		query_id INTEGER NOT NULL,
		model_version_id INTEGER NOT NULL,
		accuracy_score REAL,
		latency_ms INTEGER,
		token_usage INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS fine_tuning_jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
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

	CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
	CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
	CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON chunk_embeddings(chunk_id);
	CREATE INDEX IF NOT EXISTS idx_embeddings_model ON chunk_embeddings(model_id);
	CREATE INDEX IF NOT EXISTS idx_permissions_user ON permission_cache(user_id);
	CREATE INDEX IF NOT EXISTS idx_query_logs_user ON query_logs(user_id);
	CREATE INDEX IF NOT EXISTS idx_feedback_query ON feedback_events(query_id);
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

// ClearAllTables truncates all tables in the test database
func ClearAllTables(t *testing.T, db *sql.DB) {
	tables := []string{
		"feedback_events",
		"query_logs",
		"extraction_confidence",
		"permission_cache",
		"delta_state",
		"m365_connections",
		"chunk_embeddings",
		"embedding_jobs",
		"embedding_models",
		"chunks",
		"m365_files",
		"ab_test_results",
		"ab_test_cohorts",
		"fine_tuning_jobs",
		"model_versions",
	}

	for _, table := range tables {
		if _, err := db.ExecContext(context.Background(), "DELETE FROM "+table); err != nil {
			t.Logf("Warning: Failed to clear table %s: %v", table, err)
		}
	}
}
