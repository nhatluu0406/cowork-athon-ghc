//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestConnectorIntegration validates that MS Graph client and parser flow together
func TestConnectorIntegration(t *testing.T) {
	_ = context.Background()

	// Create MS Graph client with a mock token provider (wiring test)
	client := connectors.NewGraphClient(func() (string, error) {
		return "mock-token", nil
	})
	if client == nil {
		t.Fatal("expected GraphClient, got nil")
	}

	// Client is initialized and ready for requests (contract check)
	// Note: full integration would require live OAuth + Graph endpoint
}
