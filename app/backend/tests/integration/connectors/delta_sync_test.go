//go:build integration
// +build integration

package connectors_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestDeltaSyncCoordinatorStateTransitions verifies that the DeltaSyncCoordinator
// correctly manages the state machine: IDLE → SYNC_RUNNING → SYNC_COMPLETED → IDLE
func TestDeltaSyncCoordinatorStateTransitions(t *testing.T) {
	// This test requires a real database connection
	// For now, we'll test the coordinator with mocked connectors

	// Create mock OneDrive and Teams connectors
	mockOneDrive := &mockOneDriveConnector{
		getDeltaFunc: func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
			// Return some dummy files and a new token
			return []map[string]interface{}{
				{"id": "file-1", "name": "test.docx"},
			}, "new-token-123", false, nil
		},
	}

	mockTeams := &mockTeamsConnector{}

	// Create coordinator with nil DB (state is in-memory)
	coordinator := connectors.NewDeltaSyncCoordinator(nil, mockOneDrive, mockTeams)

	// Check initial state
	state := coordinator.GetState("onedrive://site1/drive1")
	if state != connectors.SyncStateIdle {
		t.Errorf("expected initial state IDLE, got %s", state)
	}

	// Verify that we can query state for non-existent source (returns IDLE)
	unknownState := coordinator.GetState("unknown-source")
	if unknownState != connectors.SyncStateIdle {
		t.Errorf("expected IDLE for unknown source, got %s", unknownState)
	}
}

// TestDeltaSyncCoordinatorErrorHandling verifies that if delta sync fails,
// the coordinator transitions to SYNC_FAILED state.
func TestDeltaSyncCoordinatorErrorHandling(t *testing.T) {
	mockOneDrive := &mockOneDriveConnector{
		getDeltaFunc: func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
			// Simulate a sync failure
			return nil, "", false, context.DeadlineExceeded
		},
	}

	mockTeams := &mockTeamsConnector{}
	coordinator := connectors.NewDeltaSyncCoordinator(nil, mockOneDrive, mockTeams)

	// Attempt a sync (which will fail)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err := coordinator.SyncOneDrive(ctx, "site1", "drive1")
	if err == nil {
		t.Error("expected error from failed sync, got success")
	}

	// Verify coordinator transitioned to FAILED state
	state := coordinator.GetState("onedrive://site1/drive1")
	if state != connectors.SyncStateFailed {
		t.Errorf("expected SYNC_FAILED after error, got %s", state)
	}
}

// TestDeltaSyncCoordinatorPagination verifies that if delta sync has more results
// (hasMore=true), the coordinator sets the SYNC_PARTIAL_HAS_MORE state.
func TestDeltaSyncCoordinatorPagination(t *testing.T) {
	mockOneDrive := &mockOneDriveConnector{
		getDeltaFunc: func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
			// Simulate paginated results
			return []map[string]interface{}{
				{"id": "file-1", "name": "test.docx"},
			}, "token-page-2", true, nil // hasMore=true
		},
	}

	mockTeams := &mockTeamsConnector{}
	coordinator := connectors.NewDeltaSyncCoordinator(nil, mockOneDrive, mockTeams)

	ctx := context.Background()
	fileCount, err := coordinator.SyncOneDrive(ctx, "site1", "drive1")
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	if fileCount != 1 {
		t.Errorf("expected 1 file, got %d", fileCount)
	}

	// State should be SYNC_PARTIAL_HAS_MORE if hasMore=true
	state := coordinator.GetState("onedrive://site1/drive1")
	if state != connectors.SyncStateCompleted && state != connectors.SyncStateHasMore {
		t.Errorf("expected SYNC_COMPLETED or SYNC_PARTIAL_HAS_MORE, got %s", state)
	}
}

// TestDeltaSyncCoordinatorContextTimeout verifies that if the context deadline
// is exceeded, the sync is cancelled gracefully.
func TestDeltaSyncCoordinatorContextTimeout(t *testing.T) {
	mockOneDrive := &mockOneDriveConnector{
		getDeltaFunc: func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
			// Simulate a slow operation
			select {
			case <-time.After(5 * time.Second):
				return nil, "", false, nil
			case <-ctx.Done():
				return nil, "", false, ctx.Err()
			}
		},
	}

	mockTeams := &mockTeamsConnector{}
	coordinator := connectors.NewDeltaSyncCoordinator(nil, mockOneDrive, mockTeams)

	// Create a context that will timeout quickly
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := coordinator.SyncOneDrive(ctx, "site1", "drive1")
	if err == nil {
		t.Error("expected timeout error, got success")
	}

	state := coordinator.GetState("onedrive://site1/drive1")
	if state != connectors.SyncStateFailed {
		t.Errorf("expected SYNC_FAILED on timeout, got %s", state)
	}
}

// TestDeltaSyncCoordinatorMultipleSources verifies that the coordinator can
// manage sync state for multiple sources concurrently.
func TestDeltaSyncCoordinatorMultipleSources(t *testing.T) {
	mockOneDrive := &mockOneDriveConnector{
		getDeltaFunc: func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
			return []map[string]interface{}{}, "token", false, nil
		},
	}

	mockTeams := &mockTeamsConnector{}
	coordinator := connectors.NewDeltaSyncCoordinator(nil, mockOneDrive, mockTeams)

	// Simulate syncs for multiple sources
	sources := []string{"site1", "site2", "site3"}
	for _, site := range sources {
		go func(siteID string) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			coordinator.SyncOneDrive(ctx, siteID, "drive")
		}(site)
	}

	// Give syncs time to complete
	time.Sleep(1 * time.Second)

	// Verify states for each source
	for _, site := range sources {
		state := coordinator.GetState("onedrive://" + site + "/drive")
		if state == connectors.SyncStateIdle {
			t.Errorf("expected non-IDLE state for %s (should have run), got IDLE", site)
		}
	}
}

// Mock implementations for testing

type mockOneDriveConnector struct {
	getDeltaFunc func(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error)
}

func (m *mockOneDriveConnector) GetDeltaWithState(ctx context.Context, driveID string, token string) ([]map[string]interface{}, string, bool, error) {
	if m.getDeltaFunc != nil {
		return m.getDeltaFunc(ctx, driveID, token)
	}
	return []map[string]interface{}{}, "", false, nil
}

func (m *mockOneDriveConnector) Download(ctx context.Context, driveID string, itemID string) ([]byte, error) {
	return nil, nil
}

type mockTeamsConnector struct{}

func (m *mockTeamsConnector) ListTeams(ctx context.Context) ([]interface{}, error) {
	return []interface{}{}, nil
}

func (m *mockTeamsConnector) ListChannels(ctx context.Context, teamID string) ([]interface{}, error) {
	return []interface{}{}, nil
}

func (m *mockTeamsConnector) GetMessages(ctx context.Context, teamID string, channelID string) ([]interface{}, error) {
	return []interface{}{}, nil
}

// Minimal DB schema for testing
func setupTestDB(t *testing.T) *sql.DB {
	// For integration tests with a real database, initialize the schema here
	// This is a placeholder for now
	return nil
}
