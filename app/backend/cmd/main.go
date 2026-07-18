package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/rad-system/m365-knowledge-graph/internal/api"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/brain"
	"github.com/rad-system/m365-knowledge-graph/internal/common"
	"github.com/rad-system/m365-knowledge-graph/internal/connectors"
	"github.com/rad-system/m365-knowledge-graph/internal/embedding"
	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
	"github.com/rad-system/m365-knowledge-graph/internal/graph"
	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/rad-system/m365-knowledge-graph/internal/metadata"
	"github.com/rad-system/m365-knowledge-graph/internal/nlp"
	"github.com/rad-system/m365-knowledge-graph/internal/parsers"
	"github.com/rad-system/m365-knowledge-graph/internal/retrieval"
	"github.com/rad-system/m365-knowledge-graph/internal/scheduler"
	"github.com/rad-system/m365-knowledge-graph/internal/websocket"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
	logger := slog.Default()
	logger.Info("m365-knowledge-graph starting")

	// Load config from environment
	cfg, err := common.LoadConfig()
	if err != nil {
		logger.Error("failed to load config", "err", err)
		os.Exit(1)
	}
	if err := cfg.Validate(); err != nil {
		logger.Error("invalid config", "err", err)
		os.Exit(1)
	}

	logger.Info("starting with dual-stack database configuration", "db_type", cfg.DBType)

	// Use factory pattern to instantiate the right database driver based on DB_TYPE
	repo, err := metadata.NewRepository(cfg.DBType, cfg.DBUrl)
	if err != nil {
		logger.Error("failed to initialize database", "err", err, "db_type", cfg.DBType)
		os.Exit(1)
	}
	defer repo.Close(context.Background())
	logger.Info("database repository initialized", "db_type", cfg.DBType)

	// Initialize graph store and driver based on DB_TYPE
	var graphStore interface{} // will be either *Neo4jStore or *LanceDBStore
	var neoDriver neo4j.DriverWithContext // will be nil for sqlite_lancedb

	if cfg.DBType == "postgres_neo4j" {
		neoStore, err := graph.NewNeo4jStore(cfg.Neo4jUri, cfg.Neo4jUser, cfg.Neo4jPass)
		if err != nil {
			logger.Error("failed to connect to Neo4j", "err", err)
			os.Exit(1)
		}
		defer neoStore.Close(context.Background())
		graphStore = neoStore
		neoDriver = neoStore.Driver() // Extract the driver for use in retrieval stages
		logger.Info("Neo4j graph store initialized")
	} else if cfg.DBType == "sqlite_lancedb" {
		// For Option 2, get the underlying SQLite DB to pass to LanceDB
		sqliteDB, err := getUnderlyingSQLiteDB(repo)
		if err != nil {
			logger.Error("failed to extract SQLite DB for LanceDB", "err", err)
			os.Exit(1)
		}
		lanceStore, err := graph.NewLanceDBStore(sqliteDB)
		if err != nil {
			logger.Error("failed to initialize LanceDB vector store", "err", err)
			os.Exit(1)
		}
		defer lanceStore.Close(context.Background())
		graphStore = lanceStore
		logger.Info("LanceDB vector store initialized")
	}

	// T115: Initialize WebSocket hub early (after auth is created below)

	// Build dependent services used by handlers
	feedbackStore := feedback.NewFeedbackStore(repo.Conn())
	feedbackAnalyzer := feedback.NewFeedbackAnalyzer(repo.Conn())
	improver := feedback.NewImprover(repo.Conn())

	// Group C/D wiring: embedding client + store + retrieval pipeline.
	// LLMSVC_ADDR may be unset in some environments — SemanticSearch and
	// AnswerGenerator both degrade gracefully when their embedder/LLM
	// interface arguments are a true nil interface (see below) rather than
	// panicking, per stages.go's nil checks.
	//
	// IMPORTANT: we deliberately keep these as interface-typed variables
	// (not *embedding.SvcAdapter or *embedding.CustomAPIClient) and only assign into them when
	// configured. Assigning a typed-nil pointer into an interface
	// parameter produces a NON-nil interface (nil pointer + concrete type
	// info), which would silently defeat the `== nil` guards in stages.go.
	var (
		embedRuntime retrieval.EmbeddingRuntime
		llmClient    retrieval.LLMClient
	)

	// T171: Try llm-svc (gRPC) first if LLMSVC_ADDR is configured
	if cfg.LLMSvcAddr != "" {
		var svcAdapter *embedding.SvcAdapter
		var err error

		if cfg.LLMSvcTLS {
			svcAdapter, err = embedding.NewSvcAdapterWithTLS(cfg.LLMSvcAddr, cfg.LLMEmbedModel, cfg.LLMModel, cfg.LLMSvcCertFile)
		} else {
			svcAdapter, err = embedding.NewSvcAdapter(cfg.LLMSvcAddr, cfg.LLMEmbedModel, cfg.LLMModel)
		}

		if err != nil {
			logger.Warn("failed to create llm-svc adapter; falling back to custom API", "err", err)
		} else {
			embedRuntime = svcAdapter
			llmClient = svcAdapter
			logger.Info("llm-svc adapter initialized", "addr", cfg.LLMSvcAddr, "tls", cfg.LLMSvcTLS)
		}
	}

	// T176a: Removed fallback to custom API. All LLM operations now require llm-svc
	// (LLMSVC_ADDR); LLM_API_BASE_URL is no longer read by the Go backend at all
	// (per spec §3.5).

	embeddingStore := embedding.NewStore(repo.Conn())

	embeddingModelID, err := embeddingStore.EnsureModel(context.Background(), cfg.LLMEmbedModel, "", 1536)
	if err != nil {
		logger.Warn("failed to ensure embedding model row; semantic search will be degraded", "err", err)
	}

	// T177-T181: Create BrainClient for task-type tagging and routing per NLP_MODE
	var brainClient *brain.BrainClient
	if cfg.LLMSvcAddr != "" {
		var err error
		if cfg.LLMSvcTLS {
			brainClient, err = brain.NewBrainClientWithTLS(cfg.LLMSvcAddr, cfg.LLMSvcCertFile)
		} else {
			brainClient, err = brain.NewBrainClient(cfg.LLMSvcAddr)
		}
		if err != nil {
			logger.Warn("failed to create brain client; wiring will use fallback implementations", "err", err)
		}
	}

	permissionFilter := retrieval.NewPermissionFilter(repo.Conn())

	// T178: Create intent detector with optional brain client for task-type tagging
	var intentDetector *retrieval.IntentDetector
	if brainClient != nil {
		intentDetector = retrieval.NewIntentDetectorWithBrainClient(brainClient)
	} else {
		intentDetector = retrieval.NewIntentDetector()
	}

	// Only create Neo4j-dependent components if using postgres_neo4j option
	var entityRecognizer *retrieval.QueryEntityRecognizer
	var graphExpander *retrieval.GraphExpander
	if neoDriver != nil {
		entityRecognizer = retrieval.NewQueryEntityRecognizer(neoDriver)
		graphExpander = retrieval.NewGraphExpander(neoDriver)
	}

	semanticSearch := retrieval.NewSemanticSearch(repo.Conn(), embedRuntime, similaritySearcherAdapter{store: embeddingStore}, embeddingModelID)

	// T173: Create reranker with optional brain client for LLM-based reranking
	var reranker *retrieval.Reranker
	if brainClient != nil {
		reranker = retrieval.NewRerankerWithBrainClient(brainClient)
	} else {
		reranker = retrieval.NewReranker()
	}

	// T180: Create context packer with optional brain client for compression
	var contextPacker *retrieval.ContextPacker
	if brainClient != nil {
		contextPacker = retrieval.NewContextPackerWithBrainClient(brainClient)
	} else {
		contextPacker = retrieval.NewContextPacker()
	}

	// T174: Create answer generator with optional brain client for specialized generation
	var answerGenerator *retrieval.AnswerGenerator
	if brainClient != nil {
		answerGenerator = retrieval.NewAnswerGeneratorWithBrainClient(brainClient, llmClient)
	} else {
		answerGenerator = retrieval.NewAnswerGenerator(llmClient)
	}

	retriever := retrieval.NewRetriever(repo.Conn(), permissionFilter, intentDetector, entityRecognizer,
		semanticSearch, graphExpander, reranker, contextPacker, answerGenerator)

	// T184: Auth deps — Entra ID OIDC (user-delegated auth-code flow) + our
	// own JWT issuance/verification.
	entraAuth := auth.NewEntraIDAuth(cfg.M365TenantID, cfg.M365ClientID, cfg.M365ClientSecret)
	jwtAuth := auth.NewJWTAuth(cfg.JWTSecret)

	// T115: Initialize WebSocket hub with JWT auth and start its run loop
	hub := websocket.NewHub(jwtAuth)
	go hub.Run()
	logger.Info("WebSocket hub started")

	// T185/T186: real graph query layer (shared QueryBuilder over the
	// context-aware Neo4j driver already constructed above for retrieval).
	// For sqlite_lancedb, queryBuilder will be nil and graph queries will be unsupported.
	var queryBuilder *graph.QueryBuilder
	if neoDriver != nil {
		queryBuilder = graph.NewQueryBuilder(neoDriver)
	}

	// T056: Create graph builder for entity extraction (Option 1 only)
	var graphBuilder *graph.GraphBuilder
	if cfg.DBType == "postgres_neo4j" {
		if neoStore, ok := graphStore.(*graph.Neo4jStore); ok {
			graphBuilder = graph.NewGraphBuilder(neoStore)
			logger.Info("Graph builder initialized for Neo4j entity extraction")
		}
	}

	// T047: Create NLP extractor for entity extraction via llm-svc
	var extractor *nlp.Extractor
	if brainClient != nil {
		extractor = nlp.NewExtractorWithLLMSvc(brainClient, llmClient)
		logger.Info("NLP extractor initialized with llm-svc")
	} else if llmClient != nil {
		extractor = nlp.NewExtractor(llmClient)
		logger.Info("NLP extractor initialized with fallback LLM client")
	}

	// T187: M365 connection persistence + connector triggering deps.
	m365Deps := &api.M365Deps{
		DB:           repo.Conn(),
		M365ClientID: cfg.M365ClientID,
		M365Secret:   cfg.M365ClientSecret,
	}

	// Group G: Permission extraction during ingestion (T149-T151).
	// PermissionExtractor is wired into scheduled delta sync to populate
	// permission_cache via ExtractAndCache as files are ingested.
	graphClient := connectors.NewGraphClient(func() (string, error) {
		tokenResp, err := entraAuth.ClientCredentialsToken(context.Background())
		if err != nil {
			return "", fmt.Errorf("failed to get app-only token for permission extraction: %w", err)
		}
		return tokenResp.AccessToken, nil
	})
	permissionExtractor := connectors.NewPermissionExtractor(repo.Conn(), graphClient)

	// T022: Initialize local import components (Phase 3)
	localSourceStore := localimport.NewLocalSourceStore(repo.Conn())
	localJobStore := localimport.NewImportJobStore(repo.Conn())
	localFileStore := localimport.NewLocalFileStore(repo.Conn())

	// Create extractor and chunker for local import
	localExtractor := localimport.NewExtractor()
	localChunker := parsers.NewChunker(512, 128)

	// Create local file scanner and delta resolver
	localDeltaResolver := localimport.NewDeltaResolver(localFileStore)

	// T044: Create Neo4j client for local documents
	// For sqlite_lancedb, localNeo4jClient will be nil and entity extraction to Neo4j will be skipped.
	var localNeo4jClient *localimport.LocalNeo4jClient
	if neoDriver != nil {
		localNeo4jClient = localimport.NewLocalNeo4jClient(neoDriver)
	}

	// T046: Create NLP extractor for entity extraction
	// Note: nlpExtractor can be nil if neither brainClient nor llmClient is available;
	// in that case, entity extraction is skipped during import but the import continues.
	var localNLPExtractor *nlp.Extractor
	if llmClient != nil {
		localNLPExtractor = nlp.NewExtractor(llmClient)
	}

	// Create processor for import jobs
	localChunkStore := metadata.NewChunkStore(repo.Conn())
	localProcessor := localimport.NewProcessor(
		localDeltaResolver,
		localExtractor,
		localChunker,
		embedRuntime,
		embeddingStore,   // C2: persist local chunk vectors under the retrieval model
		embeddingModelID, // C2: same model id retrieval's SemanticSearch queries
		localFileStore,
		localSourceStore,
		localChunkStore,
		localJobStore,
		localNeo4jClient,
		localNLPExtractor,
		logger,
	)

	// Create dispatcher with worker pool
	localDispatcher := localimport.NewDispatcher(localProcessor, localJobStore, logger)
	localDispatcher.MarkStaleJobs(context.Background())
	go localDispatcher.Start(context.Background())

	// Create local import handler dependencies
	localImportDeps := &localimport.LocalImportDeps{
		SourceStore: localSourceStore,
		JobStore:    localJobStore,
		Dispatcher:  localDispatcher,
		JWTAuth:     jwtAuth,
	}

	// T114: Initialize router and register all handler groups
	// T022: Pass allowed origins from config for CORS middleware
	router := api.NewRouter(cfg.AllowedOrigins)

	// T056: Create entity extraction dependencies
	entityExtractDeps := &api.EntityExtractDeps{
		DB:              repo.Conn(),
		Extractor:       extractor,
		GraphBuilder:    graphBuilder,
		Hub:             hub,
		ExtractionQueue: make(chan api.ExtractionTask, 100),
	}

	registerRoutes(router, hub, feedbackStore, feedbackAnalyzer, retriever,
		entraAuth, jwtAuth, cfg.OAuthRedirectURI, cfg.DevLoginUsername, cfg.DevLoginPassword,
		queryBuilder, repo.Conn(), permissionFilter, m365Deps, localImportDeps, entityExtractDeps, extractor, graphBuilder)

	// T056: Start extraction worker pool for asynchronous entity extraction
	if entityExtractDeps != nil && entityExtractDeps.Extractor != nil {
		api.InitExtractionWorker(context.Background(), entityExtractDeps, 2) // 2 worker threads
		logger.Info("entity extraction workers started")
	}

	// T115: Start background scheduler jobs
	schedulerCtx, cancelSchedulers := context.WithCancel(context.Background())
	defer cancelSchedulers()

	deltaSyncScheduler := scheduler.NewDeltaSyncScheduler(cfg.DeltaSyncInterval)
	deltaSyncScheduler.Start(schedulerCtx, func(ctx context.Context) error {
		// T125: wire to the real delta sync coordinator (connectors.onedrive/
		// teams are implemented — see runScheduledDeltaSync in scheduled_sync.go,
		// which mirrors HandleM365Sync's per-connection logic across every
		// active m365_connections row instead of relying only on the manual
		// POST /api/m365/sync endpoint).
		// Group G: Pass permissionExtractor so RefreshCache is called after sync.
		return runScheduledDeltaSync(ctx, m365Deps, permissionExtractor, logger)
	})
	defer deltaSyncScheduler.Stop()
	logger.Info("delta sync scheduler started", "interval", cfg.DeltaSyncInterval)

	reevaluatorScheduler := scheduler.NewReevaluatorScheduler(30 * time.Minute)
	reevaluatorScheduler.Start(schedulerCtx, func(ctx context.Context) error {
		// Select low-confidence candidates for reevaluation.
		// Actual re-extraction via the NLP LLM is Group D/B remediation work
		// (tasks.md T131-T135); this wiring only surfaces the candidate scan.
		candidates, err := improver.SelectCandidatesForReevaluation(ctx, 0.5, 30*24*time.Hour)
		if err != nil {
			return err
		}
		logger.InfoContext(ctx, "reevaluation candidates found", "count", len(candidates))
		return nil
	})
	defer reevaluatorScheduler.Stop()
	logger.Info("reevaluator scheduler started")

	srv := &http.Server{
		Addr:         cfg.Host + ":" + strconv.Itoa(cfg.Port),
		Handler:      router,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
		}
	}()

	logger.Info("server listening", "addr", srv.Addr)

	// Wait for shutdown signal
	<-done
	logger.Info("shutdown signal received, gracefully shutting down")

	cancelSchedulers()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", "err", err)
		os.Exit(1)
	}

	logger.Info("server shutdown complete")
}

// similaritySearcherAdapter wraps embedding.Store to implement retrieval.SimilaritySearcher
type similaritySearcherAdapter struct {
	store *embedding.Store
}

func (a similaritySearcherAdapter) SearchSimilar(ctx context.Context, modelID int64, queryVec []float32, topK int) ([]retrieval.ScoredChunkResult, error) {
	scoredChunks, err := a.store.SearchSimilar(ctx, modelID, queryVec, topK)
	if err != nil {
		return nil, err
	}

	// Convert embedding.ScoredChunk to retrieval.ScoredChunkResult
	results := make([]retrieval.ScoredChunkResult, len(scoredChunks))
	for i, sc := range scoredChunks {
		results[i] = retrieval.ScoredChunkResult{
			ChunkID: sc.ChunkID,
			Score:   sc.Score,
		}
	}
	return results, nil
}

// Helper function to extract the underlying SQLite DB from the SQLiteDriver
// This is needed to pass to LanceDBStore since it expects a *sql.DB directly
func getUnderlyingSQLiteDB(repo metadata.Repository) (*sql.DB, error) {
	if sqliteDriver, ok := repo.(*metadata.SQLiteDriver); ok {
		return sqliteDriver.GetDB()
	}
	return nil, fmt.Errorf("repository is not an SQLiteDriver")
}
