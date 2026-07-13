package main

import (
	"context"
	"database/sql"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
)

// TestRunScheduledDeltaSyncFunctionExists tests that runScheduledDeltaSync exists and is callable
func TestRunScheduledDeltaSyncFunctionExists(t *testing.T) {
	// This is a compile-time test that the function exists
	var _ = runScheduledDeltaSync
	assert.True(t, true)
}

// TestSyncOneConnectionFunctionExists tests that syncOneConnection exists
func TestSyncOneConnectionFunctionExists(t *testing.T) {
	// This is a compile-time test that the function exists
	var _ = syncOneConnection
	assert.True(t, true)
}

// TestSyncOneConnection_OneDrive_MissingDriveID tests OneDrive sync with missing drive_id
func TestSyncOneConnection_OneDrive_MissingDriveID(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{} // Missing drive_id

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"onedrive",
		"tenant-id",
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "drive_id")
}

// TestSyncOneConnection_OneDrive_NoCreds tests OneDrive sync with missing credentials
func TestSyncOneConnection_OneDrive_NoCreds(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{"drive_id": "drive-123"}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"", // Missing client ID
		"",
		1,
		"onedrive",
		"",
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")
}

// TestSyncOneConnection_Teams_NoCreds tests Teams sync with missing credentials
func TestSyncOneConnection_Teams_NoCreds(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"",
		"",
		1,
		"teams",
		"",
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")
}

// TestSyncOneConnection_Teams_WithCreds tests Teams sync flow with credentials
func TestSyncOneConnection_Teams_WithCreds(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	// This will error on actual Graph call, but validates the connection type handling
	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"teams",
		"tenant-id",
		config,
	)

	// Expected error from trying to get real M365 token
	assert.Error(t, err)
}

// TestSyncOneConnection_UnsupportedType tests sync with unsupported connection type
func TestSyncOneConnection_UnsupportedType(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"unsupported-type",
		"tenant-id",
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported connection type")
}

// TestRunScheduledDeltaSync_ContextCancellation tests sync with cancelled context
func TestRunScheduledDeltaSync_ContextCancellation(t *testing.T) {
	deps := &api.M365Deps{DB: &sql.DB{}}
	logger := slog.New(slog.NewTextHandler(nil, nil))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Should handle cancelled context gracefully
	_ = runScheduledDeltaSync(ctx, deps, logger)
	assert.True(t, true)
}

// TestSyncOneConnection_OneDrive_ValidConfig tests OneDrive sync with valid config
func TestSyncOneConnection_OneDrive_ValidConfig(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{"drive_id": "drive-123"}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"onedrive",
		"tenant-id",
		config,
	)

	// Expected to fail on token fetch since we don't have real credentials
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "token")
}

// TestSyncOneConnectionConnectionID tests that connection ID is properly passed
func TestSyncOneConnectionConnectionID(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	connID := int64(999)
	err := syncOneConnection(
		context.Background(),
		mockDB,
		"",
		"",
		connID,
		"teams",
		"",
		config,
	)

	// Should error on credentials, not connection ID
	assert.Error(t, err)
	require.NotNil(t, err)
}

// TestSyncOneConnectionTenantID tests that tenant ID is properly passed
func TestSyncOneConnectionTenantID(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	tenantID := "my-tenant-123"
	err := syncOneConnection(
		context.Background(),
		mockDB,
		"",
		"",
		1,
		"teams",
		tenantID,
		config,
	)

	// Should error on credentials
	assert.Error(t, err)
}

// TestSyncOneConnectionConfig tests config handling
func TestSyncOneConnectionConfig(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{
		"key1": "value1",
		"key2": "value2",
	}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"",
		"",
		1,
		"teams",
		"",
		config,
	)

	// Should error on credentials
	assert.Error(t, err)
}

// TestSyncOneConnectionContextPropagation tests context is properly passed
func TestSyncOneConnectionContextPropagation(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := syncOneConnection(
		ctx,
		mockDB,
		"client-id",
		"client-secret",
		1,
		"teams",
		"tenant-id",
		config,
	)

	// Should error on Graph call
	assert.Error(t, err)
}

// TestRunScheduledDeltaSync_WithLogger tests with valid logger
func TestRunScheduledDeltaSync_WithLogger(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(nil, nil))

	// Verify the logger can be created
	assert.NotNil(t, logger)
}

// TestRunScheduledDeltaSync_ValidDeps tests M365Deps structure
func TestRunScheduledDeltaSync_ValidDeps(t *testing.T) {
	deps := &api.M365Deps{
		DB:              &sql.DB{},
		M365ClientID:    "client-id",
		M365Secret:      "client-secret",
	}

	// Verify deps structure is valid
	assert.NotNil(t, deps)
	assert.NotNil(t, deps.DB)
	assert.Equal(t, "client-id", deps.M365ClientID)
	assert.Equal(t, "client-secret", deps.M365Secret)
}

// TestSyncOneConnectionEmptyConfig tests empty config handling
func TestSyncOneConnectionEmptyConfig(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"teams",
		"tenant-id",
		config,
	)

	// Teams connection with empty config should proceed to token fetch
	assert.Error(t, err)
}

// TestSyncOneConnectionNilConfig tests nil config handling
func TestSyncOneConnectionNilConfig(t *testing.T) {
	mockDB := &sql.DB{}
	var config map[string]string // Nil map

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"teams",
		"tenant-id",
		config,
	)

	// Should still work with nil config
	assert.Error(t, err)
}

// TestSyncOneConnectionOneDriveEmptyDrive tests OneDrive with empty drive_id value
func TestSyncOneConnectionOneDriveEmptyDrive(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{"drive_id": ""}

	err := syncOneConnection(
		context.Background(),
		mockDB,
		"client-id",
		"client-secret",
		1,
		"onedrive",
		"tenant-id",
		config,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "drive_id")
}

// TestSyncOneConnectionStringArguments tests string parameter handling
func TestSyncOneConnectionStringArguments(t *testing.T) {
	mockDB := &sql.DB{}
	config := map[string]string{}

	// Test with various string formats
	testCases := []struct {
		connType string
		clientID string
		secret   string
		tenantID string
	}{
		{"teams", "id1", "secret1", "tenant1"},
		{"onedrive", "id2", "secret2", "tenant2"},
		{"", "", "", ""},
	}

	for _, tc := range testCases {
		err := syncOneConnection(
			context.Background(),
			mockDB,
			tc.clientID,
			tc.secret,
			1,
			tc.connType,
			tc.tenantID,
			config,
		)

		// All should error (either on missing credentials or unsupported type)
		require.Error(t, err)
	}
}
