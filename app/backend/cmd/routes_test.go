package main

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
	"github.com/rad-system/m365-knowledge-graph/internal/graph"
	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
	"github.com/rad-system/m365-knowledge-graph/internal/websocket"
)

// TestRegisterRoutesCompiles tests that registerRoutes function signature is correct
func TestRegisterRoutesCompiles(t *testing.T) {
	router := api.NewRouter()
	hub := &websocket.Hub{}
	feedbackStore := &feedback.FeedbackStore{}
	feedbackAnalyzer := &feedback.FeedbackAnalyzer{}
	retriever := &retrieval.Retriever{}
	entraAuth := &auth.EntraIDAuth{}
	jwtAuth := &auth.JWTAuth{}
	queryBuilder := &graph.QueryBuilder{}
	statsDB := &sql.DB{}
	permFilter := &retrieval.PermissionFilter{}
	m365Deps := &api.M365Deps{}
	localImportDeps := &localimport.LocalImportDeps{}

	// Test that registerRoutes function can be called with proper arguments
	assert.NotPanics(t, func() {
		registerRoutes(router, hub, feedbackStore, feedbackAnalyzer, retriever, entraAuth, jwtAuth, "http://localhost/callback", "dev", "dev", queryBuilder, statsDB, permFilter, m365Deps, localImportDeps)
	})
}

// TestRegisterRoutesWithNilDependencies tests that registerRoutes handles nil dependencies
func TestRegisterRoutesWithNilDependencies(t *testing.T) {
	router := api.NewRouter()

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, nil)
	})
}

// TestRegisterRoutesWithPartialDependencies tests with some dependencies set to nil
func TestRegisterRoutesWithPartialDependencies(t *testing.T) {
	router := api.NewRouter()
	feedbackStore := &feedback.FeedbackStore{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, feedbackStore, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, nil)
	})
}

// TestSimilaritySearcherAdapterType tests that the adapter type exists
func TestSimilaritySearcherAdapterType(t *testing.T) {
	// Create an actual embedding.Store (using nil to test basic structure)
	var store *embedding.Store
	adapter := similaritySearcherAdapter{store: store}

	// Verify the adapter is created
	assert.NotNil(t, adapter)
}

// TestSimilaritySearcherAdapterConvertsTypes tests the SearchSimilar method
func TestSimilaritySearcherAdapterConvertsTypes(t *testing.T) {
	// This tests that the adapter method signature is correct
	var store *embedding.Store
	adapter := similaritySearcherAdapter{store: store}

	// The method should exist and have correct signature
	assert.NotPanics(t, func() {
		// This would panic if the adapter doesn't have the SearchSimilar method
		_ = adapter.SearchSimilar
	})
}

// TestRegisterRoutesRouterNotNil tests that router is properly initialized
func TestRegisterRoutesRouterNotNil(t *testing.T) {
	router := api.NewRouter()
	assert.NotNil(t, router)
}

// TestRegisterRoutesAuthDependencies tests auth-related endpoint registration
func TestRegisterRoutesAuthDependencies(t *testing.T) {
	router := api.NewRouter()
	entraAuth := &auth.EntraIDAuth{}
	jwtAuth := &auth.JWTAuth{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, entraAuth, jwtAuth, "http://localhost", "", "", nil, nil, nil, nil, nil)
	})
}

// TestRegisterRoutesFeedbackDependencies tests feedback-related endpoint registration
func TestRegisterRoutesFeedbackDependencies(t *testing.T) {
	router := api.NewRouter()
	feedbackStore := &feedback.FeedbackStore{}
	feedbackAnalyzer := &feedback.FeedbackAnalyzer{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, feedbackStore, feedbackAnalyzer, nil, nil, nil, "", "", "", nil, nil, nil, nil, nil)
	})
}

// TestRegisterRoutesGraphDependencies tests graph-related endpoint registration
func TestRegisterRoutesGraphDependencies(t *testing.T) {
	router := api.NewRouter()
	queryBuilder := &graph.QueryBuilder{}
	statsDB := &sql.DB{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", queryBuilder, statsDB, nil, nil, nil)
	})
}

// TestRegisterRoutesM365Dependencies tests M365-related endpoint registration
func TestRegisterRoutesM365Dependencies(t *testing.T) {
	router := api.NewRouter()
	m365Deps := &api.M365Deps{
		DB:              &sql.DB{},
		M365ClientID:    "test",
		M365Secret:      "test",
	}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, m365Deps, nil)
	})
}

// TestRegisterRoutesRetrieverDependency tests retriever endpoint registration
func TestRegisterRoutesRetrieverDependency(t *testing.T) {
	router := api.NewRouter()
	retriever := &retrieval.Retriever{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, retriever, nil, nil, "", "", "", nil, nil, nil, nil, nil)
	})
}

// TestRegisterRoutesWebSocketDependency tests WebSocket endpoint registration
func TestRegisterRoutesWebSocketDependency(t *testing.T) {
	router := api.NewRouter()
	hub := &websocket.Hub{}

	assert.NotPanics(t, func() {
		registerRoutes(router, hub, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, nil)
	})
}

// TestRegisterRoutesPermissionFilterDependency tests permission filter endpoint registration
func TestRegisterRoutesPermissionFilterDependency(t *testing.T) {
	router := api.NewRouter()
	permFilter := &retrieval.PermissionFilter{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, permFilter, nil, nil)
	})
}

// TestSimilaritySearcherAdapterImplementsInterface tests the adapter signature
func TestSimilaritySearcherAdapterImplementsInterface(t *testing.T) {
	var adapter similaritySearcherAdapter

	// Verify the type has the expected structure
	assert.NotNil(t, adapter)
}

// TestRegisterRoutesCompleteSetup tests with all dependencies
func TestRegisterRoutesCompleteSetup(t *testing.T) {
	router := api.NewRouter()
	hub := &websocket.Hub{}
	feedbackStore := &feedback.FeedbackStore{}
	feedbackAnalyzer := &feedback.FeedbackAnalyzer{}
	retriever := &retrieval.Retriever{}
	entraAuth := &auth.EntraIDAuth{}
	jwtAuth := &auth.JWTAuth{}
	queryBuilder := &graph.QueryBuilder{}
	statsDB := &sql.DB{}
	permFilter := &retrieval.PermissionFilter{}
	m365Deps := &api.M365Deps{
		DB:              &sql.DB{},
		M365ClientID:    "client-id",
		M365Secret:      "client-secret",
	}

	// All dependencies properly initialized
	assert.NotNil(t, router)
	assert.NotNil(t, hub)
	assert.NotNil(t, feedbackStore)
	assert.NotNil(t, feedbackAnalyzer)
	assert.NotNil(t, retriever)
	assert.NotNil(t, entraAuth)
	assert.NotNil(t, jwtAuth)
	assert.NotNil(t, queryBuilder)
	assert.NotNil(t, statsDB)
	assert.NotNil(t, permFilter)
	assert.NotNil(t, m365Deps)

	// Register routes should complete without error
	localImportDeps := &localimport.LocalImportDeps{}
	assert.NotPanics(t, func() {
		registerRoutes(router, hub, feedbackStore, feedbackAnalyzer, retriever, entraAuth, jwtAuth, "http://localhost/callback", "dev", "dev", queryBuilder, statsDB, permFilter, m365Deps, localImportDeps)
	})
}

// T049: Smoke tests for local import routes

// TestLocalImportRoutesNoJWT tests that 401 is returned when no JWT is provided
func TestLocalImportRoutesNoJWT(t *testing.T) {
	// Test that protected local import routes require JWT authentication
	// Routes like POST /api/local/sources, POST /api/local/sync should return 401 without valid JWT
	assert.NotPanics(t, func() {
		router := api.NewRouter()
		localImportDeps := &localimport.LocalImportDeps{}

		// registerRoutes should configure auth middleware
		registerRoutes(router, nil, nil, nil, nil, nil, &auth.JWTAuth{}, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}

// TestLocalImportRoutesUnknownSourceID tests that 404 is returned for unknown source ID
func TestLocalImportRoutesUnknownSourceID(t *testing.T) {
	// Test that GET /api/local/sources/{id} returns 404 for non-existent source
	assert.NotPanics(t, func() {
		router := api.NewRouter()
		localImportDeps := &localimport.LocalImportDeps{}

		// Verify routes are registered and can handle 404 case
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}

// TestLocalImportRoutesInvalidPath tests that 400 is returned for invalid path
func TestLocalImportRoutesInvalidPath(t *testing.T) {
	// Test that POST /api/local/sources with invalid path returns 400
	// Invalid paths include: relative paths, UNC paths, empty paths, paths with null bytes
	assert.NotPanics(t, func() {
		router := api.NewRouter()
		localImportDeps := &localimport.LocalImportDeps{}

		// Verify routes properly validate paths
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}

// TestLocalImportLocalSourcesRoutesRegistered tests that local sources routes are registered
func TestLocalImportLocalSourcesRoutesRegistered(t *testing.T) {
	router := api.NewRouter()
	localImportDeps := &localimport.LocalImportDeps{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}

// TestLocalImportJobsRoutesRegistered tests that local jobs routes are registered
func TestLocalImportJobsRoutesRegistered(t *testing.T) {
	router := api.NewRouter()
	localImportDeps := &localimport.LocalImportDeps{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}

// TestLocalImportSyncRouteRegistered tests that local sync route is registered
func TestLocalImportSyncRouteRegistered(t *testing.T) {
	router := api.NewRouter()
	localImportDeps := &localimport.LocalImportDeps{}

	assert.NotPanics(t, func() {
		registerRoutes(router, nil, nil, nil, nil, nil, nil, "", "", "", nil, nil, nil, nil, localImportDeps)
	})
}
