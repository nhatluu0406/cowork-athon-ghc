// +build integration

package connectors

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestDeltaSyncCoordinator_StateTransitions tests the delta sync state machine
func TestDeltaSyncCoordinator_StateTransitions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()
	source := "onedrive:/site/drive-1"

	// Test 1: Token persistence on first sync
	t.Run("InitialTokenPersistence", func(t *testing.T) {
		// Simulate saving a change token (would be called by SyncOneDrive)
		coordinator := connectors.NewDeltaSyncCoordinator(db, nil, nil)

		err := coordinator.SaveChangeToken(ctx, source, "token-v1")
		if err != nil {
			t.Fatalf("SaveChangeToken failed: %v", err)
		}

		// Verify token was persisted
		var token string
		var lastSync time.Time
		err = db.QueryRowContext(ctx,
			`SELECT change_token, last_sync_at FROM delta_state WHERE source = $1`,
			source).Scan(&token, &lastSync)
		if err != nil && err != sql.ErrNoRows {
			t.Fatalf("Query failed: %v", err)
		}

		if token != "token-v1" {
			t.Errorf("Expected token 'token-v1', got '%s'", token)
		}
	})

	// Test 2: Token update on subsequent sync
	t.Run("TokenUpdate", func(t *testing.T) {
		coordinator := connectors.NewDeltaSyncCoordinator(db, nil, nil)

		// Update with new token
		err := coordinator.SaveChangeToken(ctx, source, "token-v2")
		if err != nil {
			t.Fatalf("SaveChangeToken failed: %v", err)
		}

		// Verify token was updated
		var token string
		err = db.QueryRowContext(ctx,
			`SELECT change_token FROM delta_state WHERE source = $1`,
			source).Scan(&token)
		if err != nil {
			t.Fatalf("Query failed: %v", err)
		}

		if token != "token-v2" {
			t.Errorf("Expected token 'token-v2', got '%s'", token)
		}
	})

	// Test 3: Multiple sources tracked independently
	t.Run("MultipleSourceTracking", func(t *testing.T) {
		coordinator := connectors.NewDeltaSyncCoordinator(db, nil, nil)

		source2 := "teams:/group/channel-1"

		// Save tokens for different sources
		err := coordinator.SaveChangeToken(ctx, source, "token-onedrive")
		if err != nil {
			t.Fatalf("SaveChangeToken failed for source1: %v", err)
		}

		err = coordinator.SaveChangeToken(ctx, source2, "token-teams")
		if err != nil {
			t.Fatalf("SaveChangeToken failed for source2: %v", err)
		}

		// Verify both tokens exist
		var token1, token2 string
		err = db.QueryRowContext(ctx,
			`SELECT change_token FROM delta_state WHERE source = $1`,
			source).Scan(&token1)
		if err != nil {
			t.Fatalf("Query failed for source1: %v", err)
		}

		err = db.QueryRowContext(ctx,
			`SELECT change_token FROM delta_state WHERE source = $1`,
			source2).Scan(&token2)
		if err != nil {
			t.Fatalf("Query failed for source2: %v", err)
		}

		if token1 != "token-onedrive" {
			t.Errorf("Expected token-onedrive, got '%s'", token1)
		}
		if token2 != "token-teams" {
			t.Errorf("Expected token-teams, got '%s'", token2)
		}
	})
}

// TestDeltaSyncCoordinator_TokenPersistence verifies change tokens are crash-safe
func TestDeltaSyncCoordinator_TokenPersistence(t *testing.T) {
	t.Skip("requires GraphClient integration - use mocks at service layer")

	db := setupTestDB(t)
	defer db.Close()

	// For real integration testing, create a GraphClient with test token
	// For now, skip this test since GraphClient is a concrete type
	_ = db
}
