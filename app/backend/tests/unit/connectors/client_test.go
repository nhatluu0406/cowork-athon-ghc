package connectors_test

import (
	"net/http"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
)

func TestNewGraphClient(t *testing.T) {
	tt := []struct {
		name    string
		wantErr bool
	}{
		{"creates client", false},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			tokenFunc := func() (string, error) { return "test-token", nil }
			client := connectors.NewGraphClient(tokenFunc)
			if client == nil {
				t.Fatal("expected client, got nil")
			}
		})
	}
}

func TestGraphClientDo(t *testing.T) {
	tt := []struct {
		name         string
		method       string
		path         string
		expectErr    bool
		expectStatus int
	}{
		{"GET request", "GET", "/me", false, http.StatusOK},
	}

	for _, tc := range tt {
		t.Run(tc.name, func(t *testing.T) {
			tokenFunc := func() (string, error) { return "test-token", nil }
			client := connectors.NewGraphClient(tokenFunc)

			// Note: full Do() test requires mocking HTTP responses
			// This skeleton ensures client can be instantiated
			if client == nil {
				t.Fatal("expected client, got nil")
			}
		})
	}
}
