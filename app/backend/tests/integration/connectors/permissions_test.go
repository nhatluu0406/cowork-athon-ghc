//go:build integration
// +build integration

package connectors_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

// TestPermissionExtractionAndCache verifies that the GraphClient can extract
// and cache permissions from MS Graph's /sites/{siteId}/lists/{listId}/items/{itemId}
// sharing endpoint.
func TestPermissionExtractionAndCache(t *testing.T) {
	// Create a mock Graph API server that returns sharing information
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Mock response for /sites/{siteId}/drive/items/{itemId}/permissions
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		// Return a minimal sharing response
		io.WriteString(w, `{
			"value": [
				{
					"id": "perm-1",
					"grantedTo": {
						"user": {
							"id": "user-1",
							"displayName": "Alice",
							"email": "alice@example.com"
						}
					},
					"roles": ["read"]
				},
				{
					"id": "perm-2",
					"grantedTo": {
						"user": {
							"id": "user-2",
							"displayName": "Bob",
							"email": "bob@example.com"
						}
					},
					"roles": ["write"]
				}
			]
		}`)
	}))
	defer server.Close()

	// Create client pointed at mock server
	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	// Create a permissions extractor/cache component
	// (This assumes a permissions.go module exists with ExtractAndCache)
	permCache := connectors.NewPermissionCache(client)

	ctx := context.Background()

	// Extract permissions for a file
	perms, err := permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	if len(perms) != 2 {
		t.Errorf("expected 2 permissions, got %d", len(perms))
	}

	// Verify first permission
	if len(perms) > 0 {
		perm := perms[0]
		if perm["id"] != "perm-1" {
			t.Errorf("expected first perm id 'perm-1', got %v", perm["id"])
		}
	}
}

// TestPermissionCacheMiss verifies that if a permission is not in cache,
// it is fetched from the Graph API.
func TestPermissionCacheMiss(t *testing.T) {
	var callCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, `{"value": []}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	permCache := connectors.NewPermissionCache(client)
	ctx := context.Background()

	// First call should hit the Graph API
	_, _ = permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if callCount != 1 {
		t.Errorf("expected 1 API call, got %d", callCount)
	}

	// Second call for the same item should be cached (no additional call)
	_, _ = permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if callCount != 1 {
		t.Errorf("expected still 1 API call (cached), got %d", callCount)
	}

	// Different item should trigger a new call
	_, _ = permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-2")
	if callCount != 2 {
		t.Errorf("expected 2 API calls (cache miss for item-2), got %d", callCount)
	}
}

// TestPermissionAPIError verifies that if the Graph API returns an error,
// it is propagated appropriately.
func TestPermissionAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"error": {"code": "Authorization_RequestDenied"}}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	permCache := connectors.NewPermissionCache(client)
	ctx := context.Background()

	perms, err := permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if err == nil {
		t.Error("expected error on 403, got success")
	}
	if len(perms) > 0 {
		t.Error("expected empty permissions on error")
	}
}

// TestPermissionCacheEviction verifies that old cache entries can be evicted
// after a TTL (if cache eviction is implemented).
func TestPermissionCacheEviction(t *testing.T) {
	var callCount = 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, `{"value": [{"id": "perm-1"}]}`)
	}))
	defer server.Close()

	client := connectors.NewGraphClientWithBaseURL(
		func() (string, error) { return "mock-token", nil },
		server.URL,
	)

	// Create cache with very short TTL (e.g., 100ms)
	permCache := connectors.NewPermissionCacheWithTTL(client, 100)

	ctx := context.Background()

	// First call
	_, _ = permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if callCount != 1 {
		t.Errorf("expected 1 call, got %d", callCount)
	}

	// Immediate second call should be cached
	_, _ = permCache.ExtractAndCache(ctx, "site-1", "drive-1", "item-1")
	if callCount != 1 {
		t.Errorf("expected still 1 call (cached), got %d", callCount)
	}

	// Wait for TTL to expire
	// (This may not work if the TTL implementation isn't present)
	// For now, this is a placeholder
}

// TestPermissionFilterMultipleUsers verifies that permissions are correctly
// filtered per user (Stage-0 permission filtering).
func TestPermissionFilterMultipleUsers(t *testing.T) {
	// Scenario: file with permissions for alice@example.com and bob@example.com
	// Query from alice should include alice's access
	// Query from charlie should return no access

	permCache := connectors.NewPermissionCache(&mockGraphClient{})
	ctx := context.Background()

	// Mock cache with known permissions
	permCache.SetCacheEntry(
		"site-1:drive-1:item-1",
		[]map[string]interface{}{
			{"user_email": "alice@example.com", "role": "read"},
			{"user_email": "bob@example.com", "role": "write"},
		},
	)

	// User alice should see this file
	aliceCanAccess := permCache.CanAccess(ctx, "alice@example.com", "site-1", "drive-1", "item-1")
	if !aliceCanAccess {
		t.Error("expected alice to have access")
	}

	// User charlie should NOT see this file
	charlieCanAccess := permCache.CanAccess(ctx, "charlie@example.com", "site-1", "drive-1", "item-1")
	if charlieCanAccess {
		t.Error("expected charlie to NOT have access")
	}
}

// Mock Graph Client for testing
type mockGraphClient struct{}

func (m *mockGraphClient) Do(ctx context.Context, method, path string) (*http.Response, error) {
	return nil, nil
}

func (m *mockGraphClient) GetWithContext(ctx context.Context, path string) (*http.Response, error) {
	return nil, nil
}
