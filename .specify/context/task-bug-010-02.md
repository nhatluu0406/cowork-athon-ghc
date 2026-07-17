<!-- task=TASK-BUG-010-02 tokens~4401 -->


---
## TASK

# Task: TASK-BUG-010-02
**✅ COMPLETE**


---
## ACCEPTANCE CRITERIA

- [ ] Line added: `api.HandleFunc("/products", s.handleCreateProduct).Methods("POST")`
- [ ] Line is placed **before** the parameterized route `/products/{product_id:[0-9]+}`
- [ ] Line is in the `/api` subrouter section (after `api := s.router.PathPrefix("/api").Subrouter()`)
- [ ] Route registration follows the same pattern as existing routes
- [ ] Code compiles: `cd src/Backend && go build ./cmd/server/...`

---
## CODE SCOPE

<!-- 1 files -->

### src/Backend/internal/api/server.go
```
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"

	"github.com/dungpd4/rad-system/internal/analysis"
	"github.com/dungpd4/rad-system/internal/auth"
	"github.com/dungpd4/rad-system/internal/build"
	"github.com/dungpd4/rad-system/internal/graph"
	"github.com/dungpd4/rad-system/internal/graph/query"
	"github.com/dungpd4/rad-system/internal/indexer"
	"github.com/dungpd4/rad-system/internal/metadata"
	"github.com/dungpd4/rad-system/internal/onprem"
	"github.com/dungpd4/rad-system/internal/retriever"
	"github.com/dungpd4/rad-system/internal/upload"
	"github.com/dungpd4/rad-system/internal/vectordb"
)

// Server is the HTTP API server
type Server struct {
	router                  *mux.Router
	httpServer              *http.Server
	db                      metadata.DB
	orchestrator            indexer.Orchestrator
	indexOrchestrator       indexer.Orchestrator // REQ-007 v1.1: manual indexing
	retriever               retriever.Retriever
	analyzer                analysis.ImpactAnalyzer
	uploadService           *upload.Service
	vectorDB                vectordb.Client
	logger                  *slog.Logger
	authMode                string // "jwt", "apikey", or "hybrid"
	allowPublicRegistration bool
	jwtManager              *auth.JWTManager
	embeddingWorker         *indexer.EmbeddingWorker
	artifactManager         build.ArtifactManager // FR-05 Phase 9.3
	queryEngine             *query.QueryEngine    // FR-41 Phase 5
	wsHub                   *WSHub
	allowedOrigins          []string // CORS allowed origins
	websocketAuthRequired   bool     // BUG-007: Feature flag for WebSocket authentication
}

// Config holds server configuration
type Config struct {
	Host            string
	Port            int
	Retriever       retriever.Retriever
	Analyzer        analysis.ImpactAnalyzer
	UploadService   *upload.Service
	VectorDB        vectordb.Client
	Logger          *slog.Logger
	AuthMode        string              // "jwt", "apikey", or "hybrid"
	ArtifactManager build.ArtifactManager // FR-05 Phase 9.3
	AllowedOrigins  []string            // CORS allowed origins (from environment)
	WSHub           *WSHub              // WebSocket hub for real-time events
}

// NewServer creates a new API server
func NewServer(config Config, db metadata.DB, orchestrator indexer.Orchestrator) *Server {
	router := mux.NewRouter()

	// Check if public registration is allowed (default: true for backward compatibility)
	allowPublicReg := os.Getenv("RAD_ALLOW_PUBLIC_REGISTRATION")
	allowPublic := allowPublicReg == "" || allowPublicReg == "true"

	// Initialize JWT manager
	secret := os.Getenv("RAD_JWT_SECRET")
	if secret == "" {
		secret = "your-super-secret-jwt-key-change-in-production-12345"
	}
	tokenExpiry := 24 * time.Hour
	refreshExpiry := 7 * 24 * time.Hour
	jwtMgr, err := auth.NewJWTManager(secret, tokenExpiry, refreshExpiry)
	if err != nil {
		config.Logger.Error("Failed to create JWT manager", "error", err)
		jwtMgr = nil // Will cause errors later if auth is needed, but won't crash on startup
	}

	// Initialize graph store and query engine (FR-41)
	graphStore := graph.NewSQLiteGraphStore(db)
	queryEngine := query.NewQueryEngine(graphStore)

	// Use provided WebSocket hub or create a new one if not provided
	wsHub := config.WSHub
	if wsHub == nil {
		config.Logger.Warn("No WebSocket hub provided, creating new instance (events may not broadcast correctly)")
		wsHub = NewWSHub(config.Logger)
	}

	// BUG-007: Check if WebSocket authentication is required (default: true for security)
	wsAuthRequired := os.Getenv("WEBSOCKET_AUTH_REQUIRED")
	wsAuthEnabled := wsAuthRequired == "" || wsAuthRequired == "true"

	srv := &Server{
		router:                  router,
		db:                      db,
		orchestrator:            orchestrator,
		indexOrchestrator:       orchestrator, // REQ-007 v1.1: reuse for manual indexing
		retriever:               config.Retriever,
		analyzer:                config.Analyzer,
		uploadService:           config.UploadService,
		vectorDB:                config.VectorDB,
		logger:                  config.Logger,
		authMode:                config.AuthMode,
		allowPublicRegistration: allowPublic,
		jwtManager:              jwtMgr,
		artifactManager:         config.ArtifactManager,
		queryEngine:             queryEngine,
		wsHub:                   wsHub,
		allowedOrigins:          config.AllowedOrigins,
		websocketAuthRequired:   wsAuthEnabled,
	}

	// Register routes
	srv.registerRoutes()

	// Create HTTP server
	addr := fmt.Sprintf("%s:%d", config.Host, config.Port)
	srv.httpServer = &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return srv
}

func (s *Server) registerRoutes() {
	// Middleware (order matters: logging → CORS → auth)
	// Apply middleware FIRST, before registering routes
	// CORS must come before auth so preflight requests aren't blocked
	s.router.Use(s.loggingMiddleware)
	s.router.Use(s.corsMiddleware)
	s.router.Use(s.authMiddleware)

	// Health endpoint (accessible at both /health and /api/health)
	s.router.HandleFunc("/health", s.handleHealth).Methods("GET")

	// Index endpoints
	s.router.HandleFunc("/index", s.handleIndex).Methods("POST")

	// API endpoints
	api := s.router.PathPrefix("/api").Subrouter()
	api.HandleFunc("/health", s.handleHealth).Methods("GET")

	// Authentication endpoints (REQ-009)
	auth := api.PathPrefix("/auth").Subrouter()
	auth.HandleFunc("/register", s.HandleRegister).Methods("POST")
	auth.HandleFunc("/login", s.HandleLogin).Methods("POST")
	auth.HandleFunc("/logout", s.HandleLogout).Methods("POST")
	auth.HandleFunc("/refresh", s.HandleRefreshToken).Methods("POST")
	auth.HandleFunc("/profile", s.handleGetProfile).Methods("GET")
	auth.HandleFunc("/password", s.HandleChangePassword).Methods("PUT")
	auth.HandleFunc("/validate-password", s.HandleValidatePassword).Methods("POST")

	api.HandleFunc("/config", s.handleGetConfig).Methods("GET")
	api.HandleFunc("/config", s.handleUpdateConfig).Methods("PUT", "POST")
	api.HandleFunc("/config/validate", s.handleValidateConfig).Methods("POST")

	api.HandleFunc("/jobs", s.handleListJobs).Methods("GET")
	api.HandleFunc("/jobs/{job_id}", s.handleGetJob).Methods("GET")
	api.HandleFunc("/jobs/{job_id}/cancel", s.handleCancelJob).Methods("POST")

	api.HandleFunc("/stats", s.handleGetStats).Methods("GET")
	api.HandleFunc("/tokens", s.HandleGetTokenStats).Methods("GET")

	// Search and analysis endpoints
	api.HandleFunc("/retrieve", s.handleRetrieve).Methods("POST")
	api.HandleFunc("/analysis/impact", s.handleImpactAnalysis).Methods("POST")

	// Claude API test endpoint
	api.HandleFunc("/test-claude", s.handleTestClaude).Methods("POST")

	// Upload endpoints
	api.HandleFunc("/upload", s.handleUpload).Methods("POST")
	api.HandleFunc("/upload/history", s.handleGetUploadHistory).Methods("GET")
	api.HandleFunc("/upload/settings", s.handleGetUploadSettings).Methods("GET")
	api.HandleFunc("/upload/settings", s.handleUpdateUploadSettings).Methods("PUT")
	api.HandleFunc("/upload/validate", s.handleValidateUpload).Methods("POST")
	api.HandleFunc("/upload/{upload_id}", s.handleDeleteUpload).Methods("DELETE")

	// Remote Build status endpoints (REQ-003, BUG-005)
	api.HandleFunc("/build/status", s.handleGetBuildStatus).Methods("GET")
	api.HandleFunc("/build/status/{job_id}", s.handleGetBuildStatusByID).Methods("GET")

	// Tool query endpoints (REQ-003, BUG-005)
	api.HandleFunc("/tools/query", s.handleQueryTools).Methods("GET")

	// Visualization endpoints (REQ7)
	v1 := api.PathPrefix("/v1").Subrouter()

	// Graph visualization endpoints (FR-18, FR-20) - must be before parameterized routes
	v1.HandleFunc("/symbols/graph", s.handleGetSymbolGraph).Methods("GET")
	v1.HandleFunc("/files/tree", s.handleGetFileTree).Methods("GET")
	v1.HandleFunc("/dependencies", s.handleGetDependencies).Methods("GET")

	// File endpoints
	v1.HandleFunc("/files", s.handleListFiles).Methods("GET")
	v1.HandleFunc("/files/{file_id}", s.handleGetFile).Methods("GET")

	// Symbol endpoints
	v1.HandleFunc("/symbols", s.handleListSymbols).Methods("GET")
	v1.HandleFunc("/symbols/{symbol_id}", s.handleGetSymbol).Methods("GET")

	// Relation endpoints
	v1.HandleFunc("/relations", s.handleListRelations).Methods("GET")
	v1.HandleFunc("/relations/{relation_id}", s.handleGetRelation).Methods("GET")

	// Chunk endpoints
	v1.HandleFunc("/chunks", s.handleListChunks).Methods("GET")
	v1.HandleFunc("/chunks/{chunk_id}", s.handleGetChunk).Methods("GET")

	// Other endpoints
	v1.HandleFunc("/epochs", s.handleListEpochs).Methods("GET")
	v1.HandleFunc("/search", s.handleSearch).Methods("GET")

	// Manual indexing endpoints (REQ-007 v1.1)
	v1.HandleFunc("/repos/{id}/index", s.handleTriggerIndex).Methods("POST")
	v1.HandleFunc("/repos/{id}/index/status", s.handleIndexStatus).Methods("GET")
	v1.HandleFunc("/repos/{id}/index/history", s.handleIndexHistory).Methods("GET")

	// Per-repository exclusion pattern endpoints (REQ-019)
	// NOTE: literal-path sub-routes (/effective, /import) must be registered
	// before /{pattern_id} so gorilla/mux doesn't treat the literal as a variable.
	v1.HandleFunc("/repos/{id}/exclusion-patterns/effective", s.handleEffectiveExclusionPatterns).Methods("GET")
	v1.HandleFunc("/repos/{id}/exclusion-patterns/import", s.handleImportExclusionPatterns).Methods("POST")
	v1.HandleFunc("/repos/{id}/exclusion-patterns", s.handleCreateExclusionPattern).Methods("POST")
	v1.HandleFunc("/repos/{id}/exclusion-patterns", s.handleListExclusionPatterns).Methods("GET")
	v1.HandleFunc("/repos/{id}/exclusion-patterns/{pattern_id}", s.handleUpdateExclusionPattern).Methods("PUT")
	v1.HandleFunc("/repos/{id}/exclusion-patterns/{pattern_id}", s.handleDeleteExclusionPattern).Methods("DELETE")

	// Build history endpoints (FR-05 Phase 9.3)
	v1.HandleFunc("/builds", s.handleListBuildHistory).Methods("GET")
	v1.HandleFunc("/builds/analytics", s.handleGetBuildAnalytics).Methods("GET")
	v1.HandleFunc("/builds/{build_id}", s.handleGetBuildHistory).Methods("GET")
	v1.HandleFunc("/builds/{build_id}/artifacts", s.handleGetBuildArtifacts).Methods("GET")
	v1.HandleFunc("/builds/{build_id}/artifacts/{artifact_id}/download", s.handleDownloadArtifact).Methods("GET")

	// Demo/seed endpoint for testing (development only)
	v1.HandleFunc("/demo/seed", s.handleSeedDatabase).Methods("POST")

	// VectorDB endpoints
	v1.HandleFunc("/vectordb/stats", s.handleGetVectorDBStats).Methods("GET")
	v1.HandleFunc("/vectordb/records", s.handleListVectorRecords).Methods("GET")
	v1.HandleFunc("/vectordb/records/{vector_key}", s.handleGetVectorRecord).Methods("GET")
	v1.HandleFunc("/vectordb/health", s.handleVectorDBHealth).Methods("GET")

	// Embedding worker endpoints (REQ-002: FR-24 Performance Monitoring)
	v1.HandleFunc("/embedding/worker/status", s.handleEmbeddingWorkerStatus).Methods("GET")
	v1.HandleFunc("/embedding/stats", s.handleEmbeddingStats).Methods("GET")
	v1.HandleFunc("/embedding/metrics", s.handleEmbeddingMetrics).Methods("GET")

	// On-Premise endpoints (REQ-008: FR-05)
	settingsFilePath := os.Getenv("RAD_SETTINGS_FILE")
	if settingsFilePath == "" {
		// デフォルトは DATA_DIR 環境変数を使用、なければ ./data/settings.json
		dataDir := os.Getenv("DATA_DIR")
		if dataDir != "" {
			settingsFilePath = dataDir + "/settings.json"
		} else {
			settingsFilePath = "data/settings.json"
		}
	}
	settingsManager := onprem.NewSettingsManager(settingsFilePath, s.logger)
	onpremHandler := NewOnPremHandler(nil, nil, settingsManager, s.logger)
	v1.HandleFunc("/onprem/status", onpremHandler.HandleStatus).Methods("GET")
	v1.HandleFunc("/onprem/health", onpremHandler.HandleHealth).Methods("GET")
	v1.HandleFunc("/onprem/models", onpremHandler.HandleModels).Methods("GET")
	v1.HandleFunc("/onprem/switch", onpremHandler.HandleSwitch).Methods("POST")
	v1.HandleFunc("/onprem/settings", onpremHandler.HandleGetSettings).Methods("GET")
	v1.HandleFunc("/onprem/settings", onpremHandler.HandleUpdateSettings).Methods("PUT")

	// Product management endpoints (REQ-011)
	api.HandleFunc("/products", s.handleGetProducts).Methods("GET")
	api.HandleFunc("/products", s.handleCreateProduct).Methods("POST")
	api.HandleFunc("/products/{product_id:[0-9]+}", s.handleGetProduct).Methods("GET")
	api.HandleFunc("/products/{product_id:[0-9]+}", s.handleDeleteProduct).Methods("DELETE")
	api.HandleFunc("/products/{product_id:[0-9]+}/repos", s.handleGetProductRepos).Methods("GET")
	api.HandleFunc("/products/{product_id:[0-9]+}/repos", s.handleAddRepoToProduct).Methods("POST")
	api.HandleFunc("/products/{product_id:[0-9]+}/repos/{repo_id:[0-9]+}", s.handleRemoveRepoFromProduct).Methods("DELETE")
	api.HandleFunc("/products/{product_id:[0-9]+}/repos/{repo_id:[0-9]+}", s.handleUpdateRepoAssociation).Methods("PUT")

	// Admin endpoints (REQ-009B) - each handler wrapped with requireAdmin check
	adminListUsers := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleListUsers)).ServeHTTP(w, r)
	}
	adminCreateUser := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleCreateUser)).ServeHTTP(w, r)
	}
	adminGetUser := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleGetUser)).ServeHTTP(w, r)
	}
	adminUpdateUser := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleUpdateUser)).ServeHTTP(w, r)
	}
	adminDeleteUser := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleDeleteUser)).ServeHTTP(w, r)
	}
	adminResetPassword := func(w http.ResponseWriter, r *http.Request) {
		s.requireAdmin(http.HandlerFunc(s.HandleResetUserPassword)).ServeHTTP(w, r)
	}

	admin := api.PathPrefix("/admin").Subrouter()
	admin.HandleFunc("/users", adminListUsers).Methods("GET")
	admin.HandleFunc("/users", adminCreateUser).Methods("POST")
	admin.HandleFunc("/users/{id}", adminGetUser).Methods("GET")
	admin.HandleFunc("/users/{id}", adminUpdateUser).Methods("PUT")
	admin.HandleFunc("/users/{id}", adminDeleteUser).Methods("DELETE")
	admin.HandleFunc("/users/{id}/password", adminResetPassword).Methods("PUT")

	// Graph query endpoints (FR-41)
	api.HandleFunc("/graph/nodes", s.handleQueryNodes).Methods("GET")
	api.HandleFunc("/graph/nodes/{node_id}", s.handleGetGraphNode).Methods("GET")
	api.HandleFunc("/graph/edges", s.handleQueryEdges).Methods("GET")
	api.HandleFunc("/graph/query", s.handleComplexQuery).Methods("POST")
	api.HandleFunc("/graph/export", s.handleExportGraph).Methods("GET", "POST")
	api.HandleFunc("/graph/traverse", s.handleTraverseGraph).Methods("POST")
	api.HandleFunc("/graph/impact/{node_id}", s.handleGetImpact).Methods("GET")
	api.HandleFunc("/graph/dependencies/{node_id}", s.handleGetNodeDependencies).Methods("GET")
	api.HandleFunc("/graph/circular", s.handleGetCircularDeps).Methods("GET")
	api.HandleFunc("/graph/stats", s.handleGetGraphStats).Methods("GET")
	api.HandleFunc("/graph/snapshots/diff", s.handleGetSnapshotsDiff).Methods("GET")
	api.HandleFunc("/graph/snapshots/{snapshot_id}", s.handleGetSnapshot).Methods("GET")
	api.HandleFunc("/graph/snapshots", s.handleListSnapshots).Methods("GET")

	// WebSocket endpoint (BUG-007: wrapped with authentication)
	s.router.HandleFunc("/ws", s.handleWebSocket).Methods("GET")
}

// Start starts the HTTP server
func (s *Server) Start() error {
	s.logger.Info("Starting HTTP server", "addr", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("Shutting down HTTP server")
	return s.httpServer.Shutdown(ctx)
}

// Router returns the underlying router
func (s *Server) Router() *mux.Router {
	return s.router
}

// SetEmbeddingWorker sets the embedding worker reference for metrics
func (s *Server) SetEmbeddingWorker(worker *indexer.EmbeddingWorker) {
	s.embeddingWorker = worker
}

// handleWebSocket wraps the WebSocket handler with authentication (BUG-007)
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Check if authentication is required (feature flag for safe rollback)
	if s.websocketAuthRequired {
		// Validate JWT token before upgrading connection
		claims, err := s.ParseJWTFromRequest(r)
		if err != nil {
			s.logger.Warn("WebSocket authentication failed",
				"remote", r.RemoteAddr,
				"error", err.Error())

			// Return 401 Unauthorized with JSON error
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "authentication_required",
				"message": "Invalid or missing authentication token",
			})
			return
		}

		// Store user claims in request context for audit trail
		ctx := context.WithValue(r.Context(), "user_id", claims.UserID)
		ctx = context.WithValue(ctx, "email", claims.Email)
		ctx = context.WithValue(ctx, "role", claims.Role)
		r = r.WithContext(ctx)
	}

	// Upgrade to WebSocket and serve
	s.wsHub.ServeWS(w, r)
}
```