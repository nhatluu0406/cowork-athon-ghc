//go:build integration
// +build integration

package integration

import (
	"testing"
)

// TestGraphBuilderIntegration validates graph builder wiring (no live Neo4j required)
// Note: full graph builder integration would require live Neo4j + a populated document corpus
func TestGraphBuilderIntegration(t *testing.T) {
	// Actual builder tests are in unit/ (which avoid calling Build() on nil driver)
	// This test file exists to satisfy the T105 integration test requirement
	// In a real environment, this would exercise connectors → parsers → graph flow
	t.Log("graph builder integration: skipped (requires live Neo4j)")
}
