<!-- batch spec=BUG-005 tasks=15 tokens~21166 -->

# Implementation Batch: BUG-005
**15 tasks** — implement in order, mark each done before next.


============================================================
## TASK: TASK-BUG-005-01

### ACCEPTANCE CRITERIA

- [ ] Determined where build job state is stored (DB, in-memory, or none)
- [ ] Identified Go struct type for build jobs
- [ ] Identified query method (SQL query, interface call, or new implementation needed)
- [ ] Documented findings in `specs/BUG-005/data-source-findings.md`

### CODE SCOPE

<!-- 3 files, max 150 lines each -->

### src/Backend/internal/metadata/schema.go
```
package metadata

const schemaSQL = `
-- Table: repos
CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    product_id INTEGER,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'service' CHECK(role IN ('backend', 'frontend', 'infra', 'library', 'docs', 'other', 'service', 'integration')),
    search_weight REAL NOT NULL DEFAULT 1.0,
    active_epoch INTEGER NOT NULL DEFAULT 0,
    indexed_commit TEXT,
    pipeline_version TEXT NOT NULL,
    embed_model_id TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_active_epoch ON repos(active_epoch);
CREATE INDEX IF NOT EXISTS idx_repos_product_id ON repos(product_id);

-- Table: files
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('doc', 'code', 'ops')),
    language TEXT,
    blob_hash TEXT NOT NULL,
    loc INTEGER,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_files_repo_epoch ON files(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_files_repo_epoch_path ON files(repo_id, epoch, path);
CREATE INDEX IF NOT EXISTS idx_files_blob_hash ON files(blob_hash);

-- Table: symbols
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    symbol_key TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('function', 'class', 'interface', 'method', 'struct', 'enum', 'variable', 'constant')),
    signature TEXT,
    visibility TEXT CHECK(visibility IN ('public', 'private', 'internal', 'protected')),
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, symbol_key)
);

CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch ON symbols(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_file ON symbols(repo_id, epoch, file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_qname ON symbols(repo_id, epoch, qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_content_hash ON symbols(content_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);

-- Table: relations
CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    from_symbol_key TEXT NOT NULL,
    to_symbol_key TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('imports', 'extends', 'implements', 'calls', 'references', 'instantiates')),
    evidence_file_id INTEGER,
    evidence_span TEXT,
    relation_hash TEXT NOT NULL,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_file_id) REFERENCES files(id) ON DELETE SET NULL,
    UNIQUE(repo_id, epoch, from_symbol_key, to_symbol_key, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_repo_epoch ON relations(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(repo_id, epoch, from_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(repo_id, epoch, to_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(repo_id, epoch, relation_type);
CREATE INDEX IF NOT EXISTS idx_relations_from_epoch ON relations(from_symbol_key, repo_id, epoch);

-- Table: documents
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    blob_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repo_epoch ON documents(repo_id, epoch);

-- Table: uploads
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id TEXT NOT NULL UNIQUE,
    repo_id INTEGER NOT NULL,
    user_id TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT,
    target_path TEXT NOT NULL,
    git_commit_hash TEXT,
    git_commit_message TEXT,
    index_job_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'committed', 'indexed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uploads_repo_id ON uploads(repo_id);
CREATE INDEX IF NOT EXISTS idx_uploads_upload_id ON uploads(upload_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at);

-- Table: upload_settings
CREATE TABLE IF NOT EXISTS upload_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    auto_commit INTEGER NOT NULL DEFAULT 1,
    auto_push INTEGER NOT NULL DEFAULT 0,
    auto_index INTEGER NOT NULL DEFAULT 1,
    max_file_size INTEGER NOT NULL DEFAULT 10485760,
    allowed_extensions TEXT, -- JSON array
    default_branch TEXT NOT NULL DEFAULT 'main',
    commit_message_template TEXT NOT NULL DEFAULT 'Upload: {{filename}}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
// ... (495 more lines truncated — read full file if needed)
```

### src/Backend/internal/req3/websocket/build_scheduler.go
```
package websocket

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// BuildJobState represents the lifecycle state of a build job
type BuildJobState string

const (
	JobStatePending   BuildJobState = "pending"
	JobStateRunning   BuildJobState = "running"
	JobStateCompleted BuildJobState = "completed"
	JobStateFailed    BuildJobState = "failed"
	JobStateCancelled BuildJobState = "cancelled"
)

// BuildJob represents a build job with streaming capability
type BuildJob struct {
	ID          int64
	State       BuildJobState
	CreatedAt   time.Time
	StartedAt   *time.Time
	CompletedAt *time.Time
	ExitCode    *int
	ClientID    string // Client requesting the build
	TargetName  string // Build target (e.g., "linux/x64")
	OutputLines int64  // Total lines of output
	ErrorCount  int    // Number of error-level messages
}

// BuildScheduler manages build job lifecycle and WebSocket streaming
type BuildScheduler struct {
	streamMgr     *BuildStreamManager
	jobs          map[int64]*BuildJob
	mu            sync.RWMutex
	jobSubscribers map[int64]map[string]bool // jobID -> {clientID: bool}
	eventChan     chan *JobStateChange
	config        BuildSchedulerConfig
}

// BuildSchedulerConfig holds configuration for the scheduler
type BuildSchedulerConfig struct {
	MaxConcurrentJobs int
	StreamBufferSize  int
	OutputLineLimit   int64
	ErrorThreshold    int
}

// JobStateChange represents a state transition event
type JobStateChange struct {
	JobID    int64
	OldState BuildJobState
	NewState BuildJobState
	Reason   string
	Time     time.Time
}

// NewBuildScheduler creates a new build scheduler
func NewBuildScheduler(streamMgr *BuildStreamManager, config BuildSchedulerConfig) *BuildScheduler {
	return &BuildScheduler{
		streamMgr:      streamMgr,
		jobs:           make(map[int64]*BuildJob),
		jobSubscribers: make(map[int64]map[string]bool),
		eventChan:      make(chan *JobStateChange, config.StreamBufferSize),
		config:         config,
	}
}

// SubmitJob creates a new build job and starts streaming setup
func (bs *BuildScheduler) SubmitJob(ctx context.Context, jobID int64, clientID string, targetName string) (*BuildJob, error) {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	// Check concurrent job limit
	if len(bs.jobs) >= bs.config.MaxConcurrentJobs {
		return nil, fmt.Errorf("max concurrent jobs (%d) reached", bs.config.MaxConcurrentJobs)
	}

	// Check for duplicate
	if _, exists := bs.jobs[jobID]; exists {
		return nil, fmt.Errorf("job %d already exists", jobID)
	}

	job := &BuildJob{
		ID:         jobID,
		State:      JobStatePending,
		CreatedAt:  time.Now(),
		ClientID:   clientID,
		TargetName: targetName,
	}

	bs.jobs[jobID] = job
	bs.jobSubscribers[jobID] = make(map[string]bool)

	slog.InfoContext(ctx, "build job submitted",
		"job_id", jobID,
		"client_id", clientID,
		"target", targetName)

	// Auto-subscribe the requesting client
	bs.streamMgr.SubscribeToJob(ctx, clientID, jobID)
	bs.jobSubscribers[jobID][clientID] = true

	// Publish job started event
	_ = bs.streamMgr.PublishBuildStarted(ctx, jobID, map[string]string{
		"target":     targetName,
		"client":     clientID,
		"submitted":  job.CreatedAt.Format(time.RFC3339),
	})

	return job, nil
}

// StartJob transitions a job to running state
func (bs *BuildScheduler) StartJob(ctx context.Context, jobID int64) error {
	bs.mu.Lock()
	job, exists := bs.jobs[jobID]
	if !exists {
		bs.mu.Unlock()
		return fmt.Errorf("job %d not found", jobID)
	}

	if job.State != JobStatePending {
		bs.mu.Unlock()
		return fmt.Errorf("job %d is not in pending state", jobID)
	}

	now := time.Now()
	job.State = JobStateRunning
	job.StartedAt = &now
	bs.mu.Unlock()

	slog.InfoContext(ctx, "build job started",
		"job_id", jobID,
		"timestamp", now)

	// Publish to stream
	_ = bs.streamMgr.PublishBuildOutput(ctx, jobID, fmt.Sprintf("Build started at %s", now.Format(time.RFC3339)), "INFO")

	// Send state change event
	select {
	case bs.eventChan <- &JobStateChange{
		JobID:    jobID,
		OldState: JobStatePending,
		NewState: JobStateRunning,
// ... (367 more lines truncated — read full file if needed)
```

### src/Backend/internal/req3/websocket/types.go
```
// Package websocket provides real-time job streaming with resilient reconnection.
package websocket

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

// Message represents a WebSocket message to be transmitted.
type Message struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // "job.started", "index.progress", etc.
	Payload   []byte    `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
	Priority  int       `json:"priority"` // 0=lowest, 2=highest
}

// WebSocketMetrics tracks performance and connection statistics.
type WebSocketMetrics struct {
	ActiveConnections    int64
	TotalConnections     int64
	TotalMessages        int64
	TotalBytes           int64
	ReconnectionAttempts int64
	AverageBackoffDelay  time.Duration
	P95BackoffDelay      time.Duration
	P99BackoffDelay      time.Duration
}

// ConnectionStats tracks per-user statistics.
type ConnectionStats struct {
	UserID            string
	ClientID          string
	ConnectedSince    time.Time
	MessageCount      int64
	BytesSent         int64
	BytesReceived     int64
	LastMessageTime   time.Time
	ReconnectionCount int
}

// ReconnectBackoff implements exponential backoff with jitter per RFC 3164.
type ReconnectBackoff struct {
	initialDelay   time.Duration // 1s
	maxDelay       time.Duration // 60s
	multiplier     float64       // 1.5
	jitterFraction float64       // 0.1 (±10%)

	attempt   int
	lastDelay time.Duration
}

// NewReconnectBackoff creates a new backoff calculator.
func NewReconnectBackoff() *ReconnectBackoff {
	return &ReconnectBackoff{
		initialDelay:   1 * time.Second,
		maxDelay:       60 * time.Second,
		multiplier:     1.5,
		jitterFraction: 0.1,
		attempt:        0,
		lastDelay:      0,
	}
}

// NextDelay returns the next backoff delay and increments the attempt counter.
func (rb *ReconnectBackoff) NextDelay() time.Duration {
	if rb.attempt == 0 {
		rb.lastDelay = rb.initialDelay
	} else {
		// Exponential: delay * multiplier
		nextDelay := time.Duration(float64(rb.lastDelay) * rb.multiplier)
		if nextDelay > rb.maxDelay {
			nextDelay = rb.maxDelay
		}
		rb.lastDelay = nextDelay
	}

	// Add jitter: ±10%
	// For now, return base delay (jitter added at call site for testability)
	rb.attempt++
	return rb.lastDelay
}

// Reset resets the backoff to initial state.
func (rb *ReconnectBackoff) Reset() {
	rb.attempt = 0
	rb.lastDelay = 0
}

// GetAttempt returns the current attempt number.
func (rb *ReconnectBackoff) GetAttempt() int {
	return rb.attempt
}

// HeartbeatConfig configures heartbeat parameters.
type HeartbeatConfig struct {
	Interval           time.Duration // 30s (send ping)
	Timeout            time.Duration // 60s (expect pong)
	MissThreshold      int           // 2 (missed pongs → reconnect)
	MaxConcurrentPings int           // Prevent pileup
}

// DefaultHeartbeatConfig returns RFC 6455-compliant defaults.
func DefaultHeartbeatConfig() HeartbeatConfig {
	return HeartbeatConfig{
		Interval:           30 * time.Second,
		Timeout:            60 * time.Second,
		MissThreshold:      2,
		MaxConcurrentPings: 1,
	}
}

// ConnectionState represents the current connection state.
type ConnectionState string

const (
	StateConnecting   ConnectionState = "CONNECTING"
	StateConnected    ConnectionState = "CONNECTED"
	StateHeartbeat    ConnectionState = "HEARTBEAT"
	StateDisconnected ConnectionState = "DISCONNECTED"
	StateReconnecting ConnectionState = "RECONNECTING"
)

// HeartbeatMachine implements RFC 6455 heartbeat protocol.
type HeartbeatMachine struct {
	state            ConnectionState
	config           HeartbeatConfig
	lastPingSent     time.Time
	lastPongReceived time.Time
	missedPongs      int
	pongChan         chan struct{}
	ctx              context.Context
	cancel           context.CancelFunc
}

// NewHeartbeatMachine creates a new heartbeat state machine.
func NewHeartbeatMachine(config HeartbeatConfig) *HeartbeatMachine {
	ctx, cancel := context.WithCancel(context.Background())
	return &HeartbeatMachine{
		state:    StateConnecting,
		config:   config,
		pongChan: make(chan struct{}, config.MaxConcurrentPings),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// ... (70 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-02

### ACCEPTANCE CRITERIA

- [ ] Determined where tool results are stored
- [ ] Identified Go struct type for tool results
- [ ] Identified query method
- [ ] Documented findings in `specs/BUG-005/data-source-findings.md`

### CODE SCOPE

<!-- 3 files, max 150 lines each -->

### src/Backend/internal/metadata/schema.go
```
package metadata

const schemaSQL = `
-- Table: repos
CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    product_id INTEGER,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'service' CHECK(role IN ('backend', 'frontend', 'infra', 'library', 'docs', 'other', 'service', 'integration')),
    search_weight REAL NOT NULL DEFAULT 1.0,
    active_epoch INTEGER NOT NULL DEFAULT 0,
    indexed_commit TEXT,
    pipeline_version TEXT NOT NULL,
    embed_model_id TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_active_epoch ON repos(active_epoch);
CREATE INDEX IF NOT EXISTS idx_repos_product_id ON repos(product_id);

-- Table: files
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('doc', 'code', 'ops')),
    language TEXT,
    blob_hash TEXT NOT NULL,
    loc INTEGER,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_files_repo_epoch ON files(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_files_repo_epoch_path ON files(repo_id, epoch, path);
CREATE INDEX IF NOT EXISTS idx_files_blob_hash ON files(blob_hash);

-- Table: symbols
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    symbol_key TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('function', 'class', 'interface', 'method', 'struct', 'enum', 'variable', 'constant')),
    signature TEXT,
    visibility TEXT CHECK(visibility IN ('public', 'private', 'internal', 'protected')),
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, symbol_key)
);

CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch ON symbols(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_file ON symbols(repo_id, epoch, file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_epoch_qname ON symbols(repo_id, epoch, qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_content_hash ON symbols(content_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);

-- Table: relations
CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    from_symbol_key TEXT NOT NULL,
    to_symbol_key TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('imports', 'extends', 'implements', 'calls', 'references', 'instantiates')),
    evidence_file_id INTEGER,
    evidence_span TEXT,
    relation_hash TEXT NOT NULL,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_file_id) REFERENCES files(id) ON DELETE SET NULL,
    UNIQUE(repo_id, epoch, from_symbol_key, to_symbol_key, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_repo_epoch ON relations(repo_id, epoch);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(repo_id, epoch, from_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(repo_id, epoch, to_symbol_key);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(repo_id, epoch, relation_type);
CREATE INDEX IF NOT EXISTS idx_relations_from_epoch ON relations(from_symbol_key, repo_id, epoch);

-- Table: documents
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    blob_hash TEXT NOT NULL,
    indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, epoch, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repo_epoch ON documents(repo_id, epoch);

-- Table: uploads
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id TEXT NOT NULL UNIQUE,
    repo_id INTEGER NOT NULL,
    user_id TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT,
    target_path TEXT NOT NULL,
    git_commit_hash TEXT,
    git_commit_message TEXT,
    index_job_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'committed', 'indexed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uploads_repo_id ON uploads(repo_id);
CREATE INDEX IF NOT EXISTS idx_uploads_upload_id ON uploads(upload_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at);

-- Table: upload_settings
CREATE TABLE IF NOT EXISTS upload_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    auto_commit INTEGER NOT NULL DEFAULT 1,
    auto_push INTEGER NOT NULL DEFAULT 0,
    auto_index INTEGER NOT NULL DEFAULT 1,
    max_file_size INTEGER NOT NULL DEFAULT 10485760,
    allowed_extensions TEXT, -- JSON array
    default_branch TEXT NOT NULL DEFAULT 'main',
    commit_message_template TEXT NOT NULL DEFAULT 'Upload: {{filename}}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
// ... (495 more lines truncated — read full file if needed)
```

### src/Backend/internal/req3/websocket/build_stream_tools.go
```
package websocket

import (
	"context"
	"fmt"
)

// BuildStreamMCPTools provides MCP (Model Context Protocol) tool definitions for build streaming
type BuildStreamMCPTools struct {
	streamMgr *BuildStreamManager
}

// NewBuildStreamMCPTools creates a new MCP tools instance
func NewBuildStreamMCPTools(streamMgr *BuildStreamManager) *BuildStreamMCPTools {
	return &BuildStreamMCPTools{
		streamMgr: streamMgr,
	}
}

// MCPToolDefinition represents an MCP tool that can be called by AI models
type MCPToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// ToolResult represents the result of calling an MCP tool
type ToolResult struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// GetToolDefinitions returns all available build stream MCP tool definitions
func (bst *BuildStreamMCPTools) GetToolDefinitions() []MCPToolDefinition {
	return []MCPToolDefinition{
		{
			Name:        "subscribe_build_stream",
			Description: "Subscribe a client to a specific job's build output stream",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"client_id": map[string]interface{}{
						"type":        "string",
						"description": "Unique identifier for the client subscribing to the stream",
					},
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to subscribe to",
					},
				},
				"required": []string{"client_id", "job_id"},
			},
		},
		{
			Name:        "unsubscribe_build_stream",
			Description: "Unsubscribe a client from a job's build output stream",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"client_id": map[string]interface{}{
						"type":        "string",
						"description": "Unique identifier for the client unsubscribing",
					},
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to unsubscribe from",
					},
				},
				"required": []string{"client_id", "job_id"},
			},
		},
		{
			Name:        "publish_build_output",
			Description: "Publish a line of build output to all subscribers of a job",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish output for",
					},
					"line": map[string]interface{}{
						"type":        "string",
						"description": "Output line to publish",
					},
					"level": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"INFO", "WARN", "ERROR"},
						"description": "Log level (INFO, WARN, ERROR)",
					},
				},
				"required": []string{"job_id", "line"},
			},
		},
		{
			Name:        "publish_build_progress",
			Description: "Publish build progress to all subscribers (0-100%)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish progress for",
					},
					"progress": map[string]interface{}{
						"type":        "integer",
						"minimum":     0,
						"maximum":     100,
						"description": "Progress percentage (0-100)",
					},
				},
				"required": []string{"job_id", "progress"},
			},
		},
		{
			Name:        "publish_build_event",
			Description: "Publish a structured build event (started, completed, error, etc)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
						"type":        "integer",
						"description": "Job ID to publish event for",
					},
					"event_type": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"build.started", "build.completed", "build.error"},
						"description": "Type of event (started, completed, error)",
					},
					"message": map[string]interface{}{
						"type":        "string",
						"description": "Event message or description",
					},
					"exit_code": map[string]interface{}{
						"type":        "integer",
						"description": "Exit code (for build.completed events)",
					},
				},
				"required": []string{"job_id", "event_type"},
			},
		},
		{
			Name:        "get_stream_status",
			Description: "Get the current status of a build stream (active subscribers, event type)",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"job_id": map[string]interface{}{
// ... (292 more lines truncated — read full file if needed)
```

### src/Backend/internal/req3/websocket/types.go
```
// Package websocket provides real-time job streaming with resilient reconnection.
package websocket

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

// Message represents a WebSocket message to be transmitted.
type Message struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // "job.started", "index.progress", etc.
	Payload   []byte    `json:"payload"`
	Timestamp time.Time `json:"timestamp"`
	Priority  int       `json:"priority"` // 0=lowest, 2=highest
}

// WebSocketMetrics tracks performance and connection statistics.
type WebSocketMetrics struct {
	ActiveConnections    int64
	TotalConnections     int64
	TotalMessages        int64
	TotalBytes           int64
	ReconnectionAttempts int64
	AverageBackoffDelay  time.Duration
	P95BackoffDelay      time.Duration
	P99BackoffDelay      time.Duration
}

// ConnectionStats tracks per-user statistics.
type ConnectionStats struct {
	UserID            string
	ClientID          string
	ConnectedSince    time.Time
	MessageCount      int64
	BytesSent         int64
	BytesReceived     int64
	LastMessageTime   time.Time
	ReconnectionCount int
}

// ReconnectBackoff implements exponential backoff with jitter per RFC 3164.
type ReconnectBackoff struct {
	initialDelay   time.Duration // 1s
	maxDelay       time.Duration // 60s
	multiplier     float64       // 1.5
	jitterFraction float64       // 0.1 (±10%)

	attempt   int
	lastDelay time.Duration
}

// NewReconnectBackoff creates a new backoff calculator.
func NewReconnectBackoff() *ReconnectBackoff {
	return &ReconnectBackoff{
		initialDelay:   1 * time.Second,
		maxDelay:       60 * time.Second,
		multiplier:     1.5,
		jitterFraction: 0.1,
		attempt:        0,
		lastDelay:      0,
	}
}

// NextDelay returns the next backoff delay and increments the attempt counter.
func (rb *ReconnectBackoff) NextDelay() time.Duration {
	if rb.attempt == 0 {
		rb.lastDelay = rb.initialDelay
	} else {
		// Exponential: delay * multiplier
		nextDelay := time.Duration(float64(rb.lastDelay) * rb.multiplier)
		if nextDelay > rb.maxDelay {
			nextDelay = rb.maxDelay
		}
		rb.lastDelay = nextDelay
	}

	// Add jitter: ±10%
	// For now, return base delay (jitter added at call site for testability)
	rb.attempt++
	return rb.lastDelay
}

// Reset resets the backoff to initial state.
func (rb *ReconnectBackoff) Reset() {
	rb.attempt = 0
	rb.lastDelay = 0
}

// GetAttempt returns the current attempt number.
func (rb *ReconnectBackoff) GetAttempt() int {
	return rb.attempt
}

// HeartbeatConfig configures heartbeat parameters.
type HeartbeatConfig struct {
	Interval           time.Duration // 30s (send ping)
	Timeout            time.Duration // 60s (expect pong)
	MissThreshold      int           // 2 (missed pongs → reconnect)
	MaxConcurrentPings int           // Prevent pileup
}

// DefaultHeartbeatConfig returns RFC 6455-compliant defaults.
func DefaultHeartbeatConfig() HeartbeatConfig {
	return HeartbeatConfig{
		Interval:           30 * time.Second,
		Timeout:            60 * time.Second,
		MissThreshold:      2,
		MaxConcurrentPings: 1,
	}
}

// ConnectionState represents the current connection state.
type ConnectionState string

const (
	StateConnecting   ConnectionState = "CONNECTING"
	StateConnected    ConnectionState = "CONNECTED"
	StateHeartbeat    ConnectionState = "HEARTBEAT"
	StateDisconnected ConnectionState = "DISCONNECTED"
	StateReconnecting ConnectionState = "RECONNECTING"
)

// HeartbeatMachine implements RFC 6455 heartbeat protocol.
type HeartbeatMachine struct {
	state            ConnectionState
	config           HeartbeatConfig
	lastPingSent     time.Time
	lastPongReceived time.Time
	missedPongs      int
	pongChan         chan struct{}
	ctx              context.Context
	cancel           context.CancelFunc
}

// NewHeartbeatMachine creates a new heartbeat state machine.
func NewHeartbeatMachine(config HeartbeatConfig) *HeartbeatMachine {
	ctx, cancel := context.WithCancel(context.Background())
	return &HeartbeatMachine{
		state:    StateConnecting,
		config:   config,
		pongChan: make(chan struct{}, config.MaxConcurrentPings),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// ... (70 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-03

### ACCEPTANCE CRITERIA

- [ ] `BuildJob` struct defined with correct JSON tags
- [ ] `ToolResult` struct defined with correct JSON tags
- [ ] Field names match frontend expectations (camelCase in JSON)
- [ ] Field types compatible (string, time.Time → ISO8601, etc.)
- [ ] Types compile without errors

### CODE SCOPE

<!-- 2 files, max 150 lines each -->

### src/Frontend/src/api/apitypes.ts
```
<!-- not found: src/Frontend/src/api/apitypes.ts -->
```

### src/Backend/internal/api/query_types.go
```
package api

import "github.com/dungpd4/rad-system/internal/graph/query"

// QueryRequest represents a query request from the client
type QueryRequest struct {
	RepoID int64            `json:"repo_id,omitempty"`
	Query  query.GraphQuery `json:"query"`
}

// QueryResponse wraps query results for HTTP response
type QueryResponse struct {
	Nodes         []interface{}      `json:"nodes"`
	Edges         []interface{}      `json:"edges"`
	TraversalPath []TraversalPathDTO `json:"traversal_path,omitempty"`
	Stats         QueryStatsDTO      `json:"stats"`
}

// NodeDTO represents a node in query results
type NodeDTO struct {
	ID            string  `json:"id"`
	Type          string  `json:"type"`
	Name          string  `json:"name"`
	QualifiedName string  `json:"qualified_name"`
	Domain        string  `json:"domain"`
	File          string  `json:"file"`
	Line          int     `json:"line"`
	QualityScore  float64 `json:"quality_score"`
}

// EdgeDTO represents an edge in query results
type EdgeDTO struct {
	ID        string  `json:"id"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	Type      string  `json:"type"`
	Weight    float32 `json:"weight,omitempty"`
	CallCount int32   `json:"call_count,omitempty"`
	File      string  `json:"file,omitempty"`
	Line      int     `json:"line,omitempty"`
}

// TraversalPathDTO represents a node in traversal path
type TraversalPathDTO struct {
	NodeID   string `json:"node_id"`
	Depth    int    `json:"depth"`
	EdgeType string `json:"edge_type"`
}

// QueryStatsDTO represents query execution statistics
type QueryStatsDTO struct {
	NodesMatched     int   `json:"nodes_matched"`
	EdgesMatched     int   `json:"edges_matched"`
	TraversalApplied bool  `json:"traversal_applied"`
	CacheHit         bool  `json:"cache_hit"`
	DurationMs       int64 `json:"duration_ms"`
}
```

============================================================
## TASK: TASK-BUG-005-04

### ACCEPTANCE CRITERIA

- [ ] Handler function implemented with correct signature
- [ ] Queries active build jobs from authoritative source
- [ ] Returns JSON: `{"jobs": [...]}`
- [ ] Returns 200 OK on success
- [ ] Returns 500 Internal Server Error on query failure
- [ ] Returns 200 with empty array if no active jobs
- [ ] Includes structured logging (slog.InfoContext, slog.ErrorContext)
- [ ] Follows Go error handling patterns (wrap errors with context)

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_build_status.go
```
package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
)

// handleGetBuildStatus handles GET /api/build/status
// Lists all active build jobs
//
// TODO(BUG-005): Currently returns empty array. Full implementation requires:
// 1. Initialize BuildIntegration in main.go
// 2. Wire BuildIntegration to Server struct
// 3. Query BuildIntegration.ListBuildJobs(ctx, "")
//
// This minimal handler fixes the 404 error. Full functionality tracked in follow-up issue.
func (s *Server) handleGetBuildStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	slog.InfoContext(ctx, "handling GET /api/build/status request",
		"remote_addr", r.RemoteAddr,
		"user_agent", r.UserAgent(),
	)

	// TODO: Query BuildIntegration once wired
	// For now, return empty array to fix 404 error
	response := BuildStatusResponse{
		Jobs: []BuildJob{},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.ErrorContext(ctx, "failed to encode build status response",
			"error", err,
		)
		http.Error(w, `{"error": "internal server error"}`, http.StatusInternalServerError)
		return
	}

	slog.InfoContext(ctx, "successfully returned build status",
		"job_count", 0,
	)
}

// handleGetBuildStatusByID handles GET /api/build/status/{job_id}
// Returns status of a specific build job
//
// TODO(BUG-005): Currently returns 404-job-not-found. Full implementation requires:
// 1. Initialize BuildIntegration in main.go
// 2. Wire BuildIntegration to Server struct
// 3. Query BuildIntegration.GetBuildStatus(ctx, jobID)
//
// This minimal handler fixes the 404-route-not-found error by returning 404-job-not-found instead.
func (s *Server) handleGetBuildStatusByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["job_id"]

	if jobID == "" {
		slog.WarnContext(ctx, "missing job_id parameter")
		respondError(w, http.StatusBadRequest, "job_id is required")
		return
	}

	slog.InfoContext(ctx, "handling GET /api/build/status/:job_id request",
		"job_id", jobID,
		"remote_addr", r.RemoteAddr,
	)

	// TODO: Query BuildIntegration.GetBuildStatus(ctx, jobID)
	// For now, return 404-job-not-found (correct error, not routing 404)
	errorResponse := ErrorResponse{
		Error: fmt.Sprintf("job not found: %s (build integration not yet wired)", jobID),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		slog.ErrorContext(ctx, "failed to encode error response",
			"error", err,
		)
		return
	}

	slog.InfoContext(ctx, "job not found (integration not wired)",
		"job_id", jobID,
	)
}
```

============================================================
## TASK: TASK-BUG-005-05

### ACCEPTANCE CRITERIA

- [ ] Handler extracts `job_id` from `mux.Vars(r)`
- [ ] Queries job by ID from data source
- [ ] Returns 200 OK with JSON: `{"job": {...}}` if found
- [ ] Returns 404 Not Found with JSON: `{"error": "job not found"}` if not exists
- [ ] Returns 500 on query failure
- [ ] Validates `job_id` format (non-empty)
- [ ] Includes structured logging

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_build_status.go
```
package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
)

// handleGetBuildStatus handles GET /api/build/status
// Lists all active build jobs
//
// TODO(BUG-005): Currently returns empty array. Full implementation requires:
// 1. Initialize BuildIntegration in main.go
// 2. Wire BuildIntegration to Server struct
// 3. Query BuildIntegration.ListBuildJobs(ctx, "")
//
// This minimal handler fixes the 404 error. Full functionality tracked in follow-up issue.
func (s *Server) handleGetBuildStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	slog.InfoContext(ctx, "handling GET /api/build/status request",
		"remote_addr", r.RemoteAddr,
		"user_agent", r.UserAgent(),
	)

	// TODO: Query BuildIntegration once wired
	// For now, return empty array to fix 404 error
	response := BuildStatusResponse{
		Jobs: []BuildJob{},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.ErrorContext(ctx, "failed to encode build status response",
			"error", err,
		)
		http.Error(w, `{"error": "internal server error"}`, http.StatusInternalServerError)
		return
	}

	slog.InfoContext(ctx, "successfully returned build status",
		"job_count", 0,
	)
}

// handleGetBuildStatusByID handles GET /api/build/status/{job_id}
// Returns status of a specific build job
//
// TODO(BUG-005): Currently returns 404-job-not-found. Full implementation requires:
// 1. Initialize BuildIntegration in main.go
// 2. Wire BuildIntegration to Server struct
// 3. Query BuildIntegration.GetBuildStatus(ctx, jobID)
//
// This minimal handler fixes the 404-route-not-found error by returning 404-job-not-found instead.
func (s *Server) handleGetBuildStatusByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["job_id"]

	if jobID == "" {
		slog.WarnContext(ctx, "missing job_id parameter")
		respondError(w, http.StatusBadRequest, "job_id is required")
		return
	}

	slog.InfoContext(ctx, "handling GET /api/build/status/:job_id request",
		"job_id", jobID,
		"remote_addr", r.RemoteAddr,
	)

	// TODO: Query BuildIntegration.GetBuildStatus(ctx, jobID)
	// For now, return 404-job-not-found (correct error, not routing 404)
	errorResponse := ErrorResponse{
		Error: fmt.Sprintf("job not found: %s (build integration not yet wired)", jobID),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		slog.ErrorContext(ctx, "failed to encode error response",
			"error", err,
		)
		return
	}

	slog.InfoContext(ctx, "job not found (integration not wired)",
		"job_id", jobID,
	)
}
```

============================================================
## TASK: TASK-BUG-005-06

### ACCEPTANCE CRITERIA

- [ ] Handler parses query parameters correctly
- [ ] Validates `jobId` is provided (return 400 Bad Request if missing)
- [ ] Queries tool results filtered by `jobId`
- [ ] Optionally filters by `toolName` if provided
- [ ] Returns 200 OK with JSON: `{"results": [...]}`
- [ ] Returns 400 Bad Request if `jobId` missing
- [ ] Returns 500 on query failure
- [ ] Returns 200 with empty array if no results
- [ ] Includes structured logging

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_tools.go
```
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// handleQueryTools handles GET /api/tools/query
// Queries tool execution results filtered by jobId and optionally toolName
//
// Query parameters:
// - jobId (required): Filter results by job ID
// - toolName (optional): Filter results by tool name
//
// TODO(BUG-005): Tool result persistence not implemented yet.
// This handler returns empty array to fix 404 error.
// Full implementation requires:
// 1. Design tool result storage schema (SQLite table or in-memory)
// 2. Instrument MCP tool calls to persist results
// 3. Query interface for tool results
//
// Tracked in follow-up issue (after BUG-005 merge).
func (s *Server) handleQueryTools(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse query parameters
	jobID := r.URL.Query().Get("jobId")
	toolName := r.URL.Query().Get("toolName")

	slog.InfoContext(ctx, "handling GET /api/tools/query request",
		"job_id", jobID,
		"tool_name", toolName,
		"remote_addr", r.RemoteAddr,
	)

	// Validate required parameter
	if jobID == "" {
		slog.WarnContext(ctx, "missing required jobId parameter")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "jobId query parameter is required",
		})
		return
	}

	// TODO: Query tool results from storage
	// For now, return empty array with informational message
	message := "Tool result persistence not yet implemented. This endpoint will return data after storage layer is added."
	response := ToolQueryResponse{
		Results: []ToolResult{},
		Message: &message,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.ErrorContext(ctx, "failed to encode tool query response",
			"error", err,
		)
		http.Error(w, `{"error": "internal server error"}`, http.StatusInternalServerError)
		return
	}

	slog.InfoContext(ctx, "successfully returned tool query results",
		"result_count", 0,
		"job_id", jobID,
		"tool_name", toolName,
	)
}
```

============================================================
## TASK: TASK-BUG-005-07

### ACCEPTANCE CRITERIA

- [ ] Routes registered in `setupRoutes()` function
- [ ] Routes use correct HTTP methods (GET)
- [ ] Routes use correct paths (match frontend expectations exactly)
- [ ] Import statements added for handler files
- [ ] Code compiles without errors
- [ ] Routes appear after middleware registration (so middleware applies)

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

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

// ... (241 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-08
**[P]**

### ACCEPTANCE CRITERIA

- [ ] Test file created with `_test.go` suffix
- [ ] All test cases pass: `go test ./internal/api -run TestGetBuildStatus`
- [ ] Tests use `testing.T` and `testify/assert`
- [ ] Tests mock data source to avoid external dependencies
- [ ] Tests verify HTTP status codes (200, 404, 500)
- [ ] Tests verify JSON response structure
- [ ] Tests verify error messages
- [ ] Code coverage ≥80% for handlers_build_status.go

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_build_status_test.go
```
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHandleGetBuildStatus tests the build status list endpoint
func TestHandleGetBuildStatus(t *testing.T) {
	tests := []struct {
		name           string
		wantStatusCode int
		wantJobCount   int
	}{
		{
			name:           "Success - returns empty array",
			wantStatusCode: http.StatusOK,
			wantJobCount:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test server
			server := &Server{
				router: mux.NewRouter(),
			}

			// Create request
			req := httptest.NewRequest("GET", "/api/build/status", nil)
			w := httptest.NewRecorder()

			// Call handler
			server.handleGetBuildStatus(w, req)

			// Assert status code
			assert.Equal(t, tt.wantStatusCode, w.Code, "status code mismatch")

			// Parse response
			var response BuildStatusResponse
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err, "failed to decode response")

			// Assert response structure
			assert.NotNil(t, response.Jobs, "jobs array should not be nil")
			assert.Len(t, response.Jobs, tt.wantJobCount, "job count mismatch")

			// Assert Content-Type
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
		})
	}
}

// TestHandleGetBuildStatusByID tests the specific build status endpoint
func TestHandleGetBuildStatusByID(t *testing.T) {
	tests := []struct {
		name           string
		jobID          string
		wantStatusCode int
		wantErrorMsg   string
	}{
		{
			name:           "Job not found - returns 404-job-not-found",
			jobID:          "test-job-123",
			wantStatusCode: http.StatusNotFound,
			wantErrorMsg:   "job not found",
		},
		{
			name:           "Another job not found",
			jobID:          "nonexistent-job",
			wantStatusCode: http.StatusNotFound,
			wantErrorMsg:   "job not found",
		},
		{
			name:           "Empty job ID - bad request",
			jobID:          "",
			wantStatusCode: http.StatusBadRequest,
			wantErrorMsg:   "job_id is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test server with router (needed for mux.Vars)
			router := mux.NewRouter()
			server := &Server{
				router: router,
			}
			router.HandleFunc("/api/build/status/{job_id}", server.handleGetBuildStatusByID)

			// Create request
			url := "/api/build/status/" + tt.jobID
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()

			if tt.jobID == "" {
				// mux {job_id} requires ≥1 char, so empty path won't route.
				// Call handler directly; mux.Vars returns nil → vars["job_id"]="" → 400.
				server.handleGetBuildStatusByID(w, req)
			} else {
				// Serve the request through the router (so mux.Vars works)
				router.ServeHTTP(w, req)
			}

			// Assert status code
			assert.Equal(t, tt.wantStatusCode, w.Code, "status code mismatch")

			// Parse error response
			var errorResponse ErrorResponse
			err := json.NewDecoder(w.Body).Decode(&errorResponse)
			require.NoError(t, err, "failed to decode error response")

			// Assert error message contains expected substring
			assert.Contains(t, errorResponse.Error, tt.wantErrorMsg, "error message mismatch")

			// Assert Content-Type
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
		})
	}
}

// TestHandleGetBuildStatusByID_BadRequest tests invalid job ID cases
func TestHandleGetBuildStatusByID_BadRequest(t *testing.T) {
	// Create test server without router (to test direct call with empty vars)
	server := &Server{
		router: mux.NewRouter(),
	}

	// Create request without mux vars (simulates missing job_id)
	req := httptest.NewRequest("GET", "/api/build/status/", nil)
	w := httptest.NewRecorder()

	// Call handler directly (mux.Vars will return empty map)
	server.handleGetBuildStatusByID(w, req)

	// Assert 400 Bad Request
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Parse error response
	var errorResponse ErrorResponse
	err := json.NewDecoder(w.Body).Decode(&errorResponse)
	require.NoError(t, err)

	// Assert error message
// ... (41 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-09
**[P]**

### ACCEPTANCE CRITERIA

- [ ] Test file created
- [ ] All test cases pass
- [ ] Tests verify query parameter parsing
- [ ] Tests verify filtering logic
- [ ] Tests verify HTTP status codes
- [ ] Tests verify JSON response structure
- [ ] Code coverage ≥80% for handlers_tools.go

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_tools_test.go
```
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHandleQueryTools tests the tool query endpoint
func TestHandleQueryTools(t *testing.T) {
	tests := []struct {
		name           string
		queryParams    map[string]string
		wantStatusCode int
		wantResultsLen int
		wantErrorMsg   string
	}{
		{
			name: "Success - returns empty results with jobId",
			queryParams: map[string]string{
				"jobId": "test-job-123",
			},
			wantStatusCode: http.StatusOK,
			wantResultsLen: 0,
		},
		{
			name: "Success - with jobId and toolName",
			queryParams: map[string]string{
				"jobId":    "test-job-456",
				"toolName": "subscribe_build_stream",
			},
			wantStatusCode: http.StatusOK,
			wantResultsLen: 0,
		},
		{
			name:           "Missing jobId - returns 400",
			queryParams:    map[string]string{},
			wantStatusCode: http.StatusBadRequest,
			wantErrorMsg:   "jobId query parameter is required",
		},
		{
			name: "Only toolName without jobId - returns 400",
			queryParams: map[string]string{
				"toolName": "some-tool",
			},
			wantStatusCode: http.StatusBadRequest,
			wantErrorMsg:   "jobId query parameter is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test server
			server := &Server{
				router: mux.NewRouter(),
			}

			// Build query string
			url := "/api/tools/query"
			if len(tt.queryParams) > 0 {
				url += "?"
				first := true
				for k, v := range tt.queryParams {
					if !first {
						url += "&"
					}
					url += k + "=" + v
					first = false
				}
			}

			// Create request
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()

			// Call handler
			server.handleQueryTools(w, req)

			// Assert status code
			assert.Equal(t, tt.wantStatusCode, w.Code, "status code mismatch")

			// Assert Content-Type
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

			// Parse response based on status code
			if tt.wantStatusCode == http.StatusOK {
				var response ToolQueryResponse
				err := json.NewDecoder(w.Body).Decode(&response)
				require.NoError(t, err, "failed to decode success response")

				// Assert results array
				assert.NotNil(t, response.Results, "results array should not be nil")
				assert.Len(t, response.Results, tt.wantResultsLen, "result count mismatch")

				// Assert message exists (TODO note about persistence)
				assert.NotNil(t, response.Message, "message should be present")
				if response.Message != nil {
					assert.Contains(t, *response.Message, "not yet implemented", "message should mention implementation status")
				}
			} else {
				var errorResponse ErrorResponse
				err := json.NewDecoder(w.Body).Decode(&errorResponse)
				require.NoError(t, err, "failed to decode error response")

				// Assert error message
				assert.Contains(t, errorResponse.Error, tt.wantErrorMsg, "error message mismatch")
			}
		})
	}
}

// TestToolQueryResponseJSONSerialization tests JSON serialization matches frontend expectations
func TestToolQueryResponseJSONSerialization(t *testing.T) {
	// Create sample response
	message := "Tool result persistence not yet implemented"
	response := ToolQueryResponse{
		Results: []ToolResult{
			{
				ID:         "result-123",
				Tool:       "subscribe_build_stream",
				Status:     "success",
				Message:    "Subscribed to job stream",
				Output:     `{"job_id": 42}`,
				ExecutedAt: "2026-06-15T10:00:00Z",
			},
		},
		Message: &message,
	}

	// Marshal to JSON
	jsonBytes, err := json.Marshal(response)
	require.NoError(t, err)

	// Parse back
	var parsed ToolQueryResponse
	err = json.Unmarshal(jsonBytes, &parsed)
	require.NoError(t, err)

	// Assert field names are correct (JSON tags work)
	jsonStr := string(jsonBytes)
	assert.Contains(t, jsonStr, `"results"`, "missing results field")
	assert.Contains(t, jsonStr, `"message"`, "missing message field")
	assert.Contains(t, jsonStr, `"id"`, "missing id field in result")
	assert.Contains(t, jsonStr, `"tool"`, "missing tool field in result")
	assert.Contains(t, jsonStr, `"executed_at"`, "missing executed_at field")
// ... (46 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-10

### ACCEPTANCE CRITERIA

- [ ] Integration tests added with `//go:build integration` tag
- [ ] Tests start test HTTP server
- [ ] Tests make real HTTP requests
- [ ] Tests verify status codes 200 (not 404)
- [ ] Tests verify response body JSON structure
- [ ] Tests pass: `go test -tags=integration ./internal/api -run TestBuildStatus`

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/integration_test.go
```
//go:build integration
// +build integration

package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"log/slog"
)

// TestHealthEndpoint tests the /api/health endpoint
func TestHealthEndpoint(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(nil, nil))

	config := Config{
		Host:     "localhost",
		Port:     8080,
		Logger:   logger,
		AuthMode: "none",
	}

	// Create a mock DB and orchestrator
	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}

	server := NewServer(config, mockDB, mockOrch)
	require.NotNil(t, server)

	req, err := http.NewRequest("GET", "/api/health", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.router.ServeHTTP(rr, req)

	assert.True(t, rr.Code == http.StatusOK || rr.Code == http.StatusNotFound,
		"expected 200 or 404, got %d", rr.Code)
}

// TestCORSHeaders verifies CORS headers are set
func TestCORSHeaders(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(nil, nil))
	config := Config{
		Host:     "localhost",
		Port:     8080,
		Logger:   logger,
		AuthMode: "none",
	}

	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}
	server := NewServer(config, mockDB, mockOrch)

	req, err := http.NewRequest("GET", "/", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)

	assert.Equal(t, "*", rr.Header().Get("Access-Control-Allow-Origin"))
}

// TestLoggingMiddleware verifies requests are logged
func TestLoggingMiddleware(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(nil, nil))
	config := Config{
		Host:     "localhost",
		Port:     8080,
		Logger:   logger,
		AuthMode: "none",
	}

	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}
	server := NewServer(config, mockDB, mockOrch)

	req, err := http.NewRequest("GET", "/test", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.loggingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

// TestPreflight tests OPTIONS preflight requests
func TestPreflight(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(nil, nil))
	config := Config{
		Host:     "localhost",
		Port:     8080,
		Logger:   logger,
		AuthMode: "none",
	}

	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}
	server := NewServer(config, mockDB, mockOrch)

	req, err := http.NewRequest("OPTIONS", "/api/test", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Should not be called
		t.Fatal("handler should not be called for OPTIONS")
	})).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}
```

============================================================
## TASK: TASK-BUG-005-11

### ACCEPTANCE CRITERIA

- [ ] All existing tests pass: `go test ./internal/api -run TestListBuildHistory`
- [ ] No test failures introduced by new code
- [ ] Manual verification: `curl http://localhost:8080/api/v1/builds` returns 200
- [ ] No route conflicts logged on server startup

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### src/Backend/internal/api/handlers_build_history_test.go
```
package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"log/slog"

	"github.com/dungpd4/rad-system/internal/build"
)

// TestListBuildHistory_Success tests successful listing of builds
func TestListBuildHistory_Success(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	config := Config{
		Host:            "localhost",
		Port:            8080,
		Logger:          logger,
		AuthMode:        "none",
		ArtifactManager: build.NewArtifactManager(),
	}

	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}

	// Setup mock to return test builds
	testBuilds := []*build.RemoteBuild{
		{
			ID:            "build-1",
			JobID:         "job-1",
			Status:        "completed",
			ExitCode:      0,
			CacheHit:      true,
			StartTime:     time.Now(),
			EndTime:       time.Now().Add(5 * time.Second),
			ExecutionTime: 5 * time.Second,
			QueueTime:     1 * time.Second,
		},
	}
	mockDB.BuildHistoryResults = testBuilds

	server := NewServer(config, mockDB, mockOrch)
	require.NotNil(t, server)

	req, err := http.NewRequest("GET", "/api/v1/builds", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var result map[string]interface{}
	err = json.NewDecoder(rr.Body).Decode(&result)
	require.NoError(t, err)

	assert.NotNil(t, result["builds"])
	assert.NotNil(t, result["count"])
	assert.NotNil(t, result["limit"])
	assert.NotNil(t, result["offset"])
}

// TestListBuildHistory_WithFilters tests filtering parameters
func TestListBuildHistory_WithFilters(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	config := Config{
		Host:            "localhost",
		Port:            8080,
		Logger:          logger,
		AuthMode:        "none",
		ArtifactManager: build.NewArtifactManager(),
	}

	mockDB := &MinimalMockDB{}
	mockOrch := &BasicMockOrchestrator{}

	testBuilds := []*build.RemoteBuild{
		{
			ID:            "build-1",
			JobID:         "job-1",
			Status:        "completed",
			ExitCode:      0,
			CacheHit:      true,
			StartTime:     time.Now(),
			EndTime:       time.Now().Add(5 * time.Second),
			ExecutionTime: 5 * time.Second,
			QueueTime:     1 * time.Second,
		},
	}
	mockDB.BuildHistoryResults = testBuilds

	server := NewServer(config, mockDB, mockOrch)

	req, err := http.NewRequest("GET", "/api/v1/builds?status=completed&cache_hit=true&limit=10&offset=0", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var result map[string]interface{}
	err = json.NewDecoder(rr.Body).Decode(&result)
	require.NoError(t, err)

	assert.Equal(t, float64(10), result["limit"])
	assert.Equal(t, float64(0), result["offset"])
}

// TestListBuildHistory_EmptyResults tests empty build list
func TestListBuildHistory_EmptyResults(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	config := Config{
		Host:            "localhost",
		Port:            8080,
		Logger:          logger,
		AuthMode:        "none",
		ArtifactManager: build.NewArtifactManager(),
	}

	mockDB := &MinimalMockDB{}
	mockDB.BuildHistoryResults = []*build.RemoteBuild{}
	mockOrch := &BasicMockOrchestrator{}

	server := NewServer(config, mockDB, mockOrch)

	req, err := http.NewRequest("GET", "/api/v1/builds", nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	server.router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var result map[string]interface{}
	err = json.NewDecoder(rr.Body).Decode(&result)
	require.NoError(t, err)

	assert.Equal(t, float64(0), result["count"])
}

// TestGetBuildHistory_Success tests getting a single build
func TestGetBuildHistory_Success(t *testing.T) {
// ... (819 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-12

### ACCEPTANCE CRITERIA

- [ ] Backend starts without errors: `go run cmd/server/main.go`
- [ ] `curl http://localhost:8080/api/build/status` returns 200 (not 404)
- [ ] `curl http://localhost:8080/api/build/status/test-job-123` returns 200 or 404-job-not-found (not 404-route-not-found)
- [ ] `curl "http://localhost:8080/api/tools/query?jobId=test"` returns 200 (not 404)
- [ ] Frontend starts: `cd src/Frontend && npm run dev`
- [ ] Browser console shows NO 404 errors for `/api/build/status` or `/api/tools/query`
- [ ] Network tab shows 200 responses for these endpoints
- [ ] `useBuilds()` hook fetches data (check React DevTools or console logs)

============================================================
## TASK: TASK-BUG-005-13

### ACCEPTANCE CRITERIA

- [ ] Row added to Defect Tracking table:

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### docs/traceability/requirements-matrix.md
```
# Requirements Traceability Matrix

> **文書番号**: RAD-TRACE-001 &nbsp;|&nbsp; **最終更新**: 2026-06-19 (BUG-011 revised — root cause corrected)

---

## 📋 目次

- [要件 → 設計 マッピング](#要件--設計-マッピング)
- [要件 → 実装 マッピング](#要件--実装-マッピング)
- [要件 → テスト マッピング](#要件--テスト-マッピング)
- [不具合追跡 (BUG)](#不具合追跡-bug)
- [修正サマリー (2026-05-30)](#修正サマリー (2026-05-30))
---

## 要件 → 設計 マッピング

| 要件ID | 要件名 | 基本設計 | 詳細設計 | ステータス |
|---|---|---|---|---|
| REQ-001/FR-01 | ソース知識再構築 | basic-design.md §3.1 | detail-design.md §2.1 | ✅ |
| REQ-001/FR-02 | メタデータ抽出 | basic-design.md §3.2 | detail-design.md §2.2 | ✅ |
| REQ-001/FR-03 | 多解像度コード表現 | basic-design.md §3.3 | detail-design.md §2.3 | ✅ |
| REQ-001/FR-04 | コードグラフ構築 | basic-design.md §3.4 | detail-design.md §2.4 | ✅ |
| REQ-001/FR-05 | 品質スコアリング | basic-design.md §3.5 | detail-design.md §2.5 | ✅ |
| REQ-001/FR-06 | 競合検出 | basic-design.md §3.6 | detail-design.md §2.6 | ✅ |
| REQ-001/FR-07 | 正規知識生成 | basic-design.md §3.7 | detail-design.md §2.7 | ⏳ |
| REQ-001/FR-08 | インクリメンタルリビルド | basic-design.md §4.1 | detail-design.md §3.1 | ✅ |
| REQ-001/FR-09 | 検索パイプライン | basic-design.md §4.2 | detail-design.md §3.2 | ⏳ |
| REQ-001/FR-10 | コンテキストバジェット | basic-design.md §4.3 | detail-design.md §3.3 | ⏳ |
| REQ-001/FR-11 | ドリフト検出 | basic-design.md §4.4 | detail-design.md §3.4 | ⏳ |
| REQ-002/F-REQ-001 | LLM Runtime Interface | basic-design.md §5.1 | detail-design.md §4.1 | ⏳ |
| REQ-002/F-REQ-002 | Vector Store (LanceDB) | basic-design.md §5.2 | detail-design.md §4.2 | ⏳ |
| REQ-002/F-REQ-003 | Hybrid Retrieval | basic-design.md §5.3 | detail-design.md §4.3 | ⏳ |
| REQ-002/F-REQ-004 | MCP Integration | basic-design.md §6.1 | detail-design.md §5.1 | ⏳ |
| REQ-003/FR-3-01 | ビルドジョブ管理 | basic-design.md §7.1 | detail-design.md §6.1 | ✅ |
| REQ-003/FR-3-02 | ファイル同期 | basic-design.md §7.2 | detail-design.md §6.2 | ✅ |
| REQ-003/FR-3-03 | 3段階サンドボックス | basic-design.md §7.3 | detail-design.md §6.3 | ✅ |
| REQ-003/FR-3-04 | 成果物管理 | basic-design.md §7.4 | detail-design.md §6.4 | ✅ |
| REQ-003/FR-3-05 | リモートデバッグ (DAP) | basic-design.md §7.5 | detail-design.md §6.5 | ✅ |
| REQ-009A/FR-09A-01 | フロントエンド認証UI | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-009A/FR-09A-02 | JWT自動リフレッシュ | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-009A/FR-09A-03 | パスワード強度検証 | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-010/FR-10-01 | 多言語対応（UI） | CLAUDE.md §6.5 | CLAUDE.md §6.5 | ✅ |
| REQ-010/FR-10-02 | 言語切り替え | CLAUDE.md §6.5 | CLAUDE.md §6.5 | ✅ |
| REQ-010/FR-10-03 | バックエンドi18n | CLAUDE.md §7.2 | CLAUDE.md §7.2 | ✅ |

---

## 要件 → 実装 マッピング

| 要件ID | 実装ファイル | 状態 |
|---|---|---|
| REQ-001/FR-01 | `internal/req1/ingestion/parser_wrapper.go` | ✅ |
| REQ-001/FR-02 | `internal/req1/ingestion/metadata_builder.go` | ✅ |
| REQ-001/FR-03 | `internal/req1/storage/metadata_store.go` | ✅ |
| REQ-001/FR-04 | `internal/req1/graph/builder.go`, `traversal.go` | ✅ |
| REQ-001/FR-05 | `internal/req1/quality/scorer.go` | ✅ |
| REQ-001/FR-06 | `internal/req1/quality/conflict_detector.go` | ✅ |
| REQ-001/FR-07 | `internal/req1/storage/canonical_store.go` | ⏳ |
| REQ-001/FR-08 | `internal/epoch/copy_forward.go` | ✅ |
| REQ-001/FR-09 | `internal/req1/retrieval/pipeline.go` | ⏳ Phase 4-5 |
| REQ-001/FR-10 | `internal/req1/retrieval/packer.go` | ⏳ Phase 5 |
| REQ-001/FR-11 | `internal/req1/drift/detector.go` | ⏳ Phase 3 |
| REQ-002/F-REQ-001 | `internal/llm/runtime.go`, `openai.go`, `anthropic.go`, `ollama.go` | ⏳ |
| REQ-002/F-REQ-002 | `internal/vectordb/client.go`, `ingest.go`, `search.go` | ⏳ |
| REQ-002/F-REQ-003 | `internal/retriever/retriever.go` | ⏳ |
| REQ-002/F-REQ-004 | `internal/mcp/server.go`, `tools.go` | ⏳ |
| REQ-003/FR-3-01 | `internal/req3/build/service.go`, `queue.go` | ✅ |
| REQ-003/FR-3-02 | `internal/req3/sync/` | ✅ |
| REQ-003/FR-3-03 | `internal/req3/sandbox/` | ✅ |
| REQ-003/FR-3-04 | `internal/req3/artifact/` | ✅ |
| REQ-003/FR-3-05 | `internal/req3/debug/` | ✅ |
| REQ-009A/FR-09A-01 | `src/Frontend/src/pages/{Login,Register,Profile}.tsx`, `components/auth/` | ✅ |
| REQ-009A/FR-09A-02 | `src/Frontend/src/api/client.ts`, `hooks/useAuth.ts` | ✅ |
| REQ-009A/FR-09A-03 | `src/Frontend/src/components/auth/PasswordStrengthIndicator.tsx` | ✅ |
| REQ-010/FR-10-01 | `src/Frontend/src/i18n/config.ts`, `public/locales/{ja,en,vi}/*.json` | ✅ |
| REQ-010/FR-10-02 | `src/Frontend/src/components/common/LanguageSwitcher.tsx` | ✅ |
| REQ-010/FR-10-03 | `src/Backend/internal/i18n/i18n.go` | ✅ |

---

## 要件 → テスト マッピング

| 要件ID | テストファイル | テストID | 状態 |
|---|---|---|---|
| REQ-001/FR-01 | `tests/req1/unit/metadata_builder_test.go` | TC-R001-03 | ✅ |
| REQ-001/FR-02 | `tests/req1/unit/metadata_builder_test.go` | TC-R001-03 | ✅ |
| REQ-001/FR-04 | `tests/req1/unit/graph_test.go` | TC-R001-04 | ✅ |
| REQ-001/FR-05 | `tests/req1/unit/quality_scorer_test.go` | TC-R001-05 | ✅ |
| REQ-001/FR-06 | `tests/req1/unit/conflict_detector_test.go` | TC-R001-06 | ✅ |
| REQ-001/FR-08 | `tests/req1/correctness/incremental_equivalence_test.go` | TC-R001-01 | ✅ |
| REQ-001/FR-09 | `tests/req1/integration/pipeline_test.go` | TC-R001-07 | ⏳ |
| REQ-001 NFR | `tests/req1/performance/retrieval_benchmark_test.go` | TC-R001-08〜11 | ⏳ |
| REQ-009A/FR-09A-01 | `e2e/auth.spec.ts` | TC-AUTH-01〜10 | ✅ |
| REQ-009A/FR-09A-02 | `e2e/auth.spec.ts` | TC-AUTH-05, TC-AUTH-10 | ✅ |
| REQ-009A/FR-09A-03 | `e2e/auth.spec.ts` | TC-AUTH-07 | ✅ |
| REQ-010/FR-10-01 | `e2e/i18n.spec.ts` | TC-I18N-02, TC-I18N-05, TC-I18N-06 | ✅ |
| REQ-010/FR-10-02 | `e2e/i18n.spec.ts` | TC-I18N-02〜09 | ✅ |
| REQ-010/FR-10-03 | `internal/i18n/i18n_test.go` | TestDetectLanguage, TestGetMessage | ✅ |

---

## 不具合追跡 (BUG)

### 2026年5月 検出・修正分

| BUG ID | タイトル | 影響範囲 | ステータス | 修正者 | 修正日 |
|--------|---------|---------|-----------|--------|-------|
| BUG-001 | Files ページのファイルクリック後に空白画面が表示される | REQ-007 | ✅ FIXED | Claude Code | 2026-05-30 |
| BUG-002 | WebSocket 接続失敗エラー | REQ-003 | ✅ FIXED | Claude Code | 2026-05-30 |
| BUG-003-v1 | 502 Bad Gateway on /auth/profile Request | REQ-009A | ✅ FIXED | Claude Sonnet 4.5 | 2026-06-14 |
| BUG-003-v2 | WebSocket Connection Failure in Development Environment | REQ-004, Config | ✅ FIXED | Speckit Bug Investigator | 2026-06-15 |
| BUG-004 | Repository Registration Data Lost After Page Refresh | REQ-004, Frontend | ✅ FIXED | Speckit Implementer | 2026-06-15 |
| BUG-005 | Missing API Routes for Remote Build and Tools Query | REQ-003 | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-006 | 401 Error Does Not Trigger Login Redirect | REQ-009A | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-007 | WebSocket Connections Lack Authentication | REQ-004, REQ-003, Security | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-008 | 500 Internal Server Error when adding repository to product | REQ-004, REQ-011 | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-009 | 500 Internal Server Error - UNIQUE constraint on products.slug | REQ-004, REQ-011 | 📋 Open | Speckit Bug Investigator | 2026-06-16 |
| BUG-010 | Missing POST /api/products Endpoint | REQ-011 | 📋 Open | Speckit Bug Investigator | 2026-06-17 |
| BUG-011 | Cannot Start Index After Registering Product and Repository | REQ-011, REQ-007 | 🔍 Investigated — Fix Ready | Speckit Bug Investigator | 2026-06-19 |

### BUG-011 Detail

| Item | Content |
|------|---------|
| **Problem** | Triggering index for a product-registered repo always fails — job created (HTTP 201) but async pipeline errors out |
| **Root Cause (B1 — Primary)** | `orchestrator.gitClient` is fixed to startup `REPO_PATH`; `IndexFull` calls `GetHeadCommit` on wrong path → "not a git repository" error → job marked `failed` |
| **Root Cause (B2)** | `IndexIncremental` creates a second internal job; outer job stays `queued` throughout — no progress visible |
| **Root Cause (B3)** | `getRunningJobForRepo` scans nullable `user_email`/`config_json` into `string` → SQL scan error → HTTP 500 on retry |
| **Root Cause (A — latent)** | `TriggerIndexModal.tsx` has double `/api` URL prefix — masked by Vite proxy in dev, 404 in production |
| **Fix Plan** | `specs/BUG-011/plan.md` — 5 phases, 7 tasks |
| **Spec** | `specs/BUG-011/spec.md` |
| **Tasks** | `specs/BUG-011/tasks.md` |
| **Branch** | `fix/bug-011-multi-repo-indexing` |

### BUG-001 詳細

| 項目 | 内容 |
|------|------|
| **問題** | `/files/{id}` ルートが定義されていない → 詳細ページ表示不可 |
| **根本原因** | App.tsx に `FileDetail` ルート・import が未定義 |
| **修正内容** | `App.tsx` に 2行追加、`FileDetail.tsx` を 220行新規作成 |
| **影響範囲** | REQ-007 (Index Data Visualization) の Files ビュー |
| **テスト状態** | ユニット ✅、統合 ✅、E2E ⏳ |
| **仕様書** | `specs/BUG-001-file-detail-blank-page/spec.md` |
| **修正履歴** | `specs/BUG-001-file-detail-blank-page/history.md` |

### BUG-002 詳細

| 項目 | 内容 |
// ... (175 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-14

### ACCEPTANCE CRITERIA

- [ ] Row inserted at TOP of Unreleased table:

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### docs/history/change-log.md
```
# Change Log

## Unreleased

| Date | ID | Type | Summary | Impact |
|---|---:|---|---|---|
|2026-06-19|BUG-011|Bug Fix|Fix orchestrator gitClient scope — use per-repo path instead of startup REPO_PATH|High|
|2026-06-19|REQ-008|Architecture|Reranker architecture update — local rerank mandatory (model switchable via reranker-settings.json), Remote LLM optional enhancement added (REMOTE_LLM_RERANK_ENABLED, REMOTE_LLM_CANONICAL_ENABLED); new FR-11 spec created (✅ DONE)|Spec: +FR-11, updated basic-design, CLAUDE.md, FR-03|
|2026-06-19|REQ-008|Refactor|ONNX runtime refactoring — replaced `yalue/onnxruntime_go` with custom CGO package reused from translate-tool; fixed SmartRouter dead code (removed OLLAMA_ONLY, fixed resource leak in Close); updated build tags to `cgo,onnxruntime` (✅ DONE)|Backend: -1 external dep, +4 files, ~0 API surface change|
|2026-06-19|BUG-011|Bug Fix|Multi-repo indexing fails after product registration — orchestrator uses startup-fixed gitClient (REPO_PATH) instead of per-repo path; NULL scan error on retry; double job creation. Spec + plan + tasks ready. (🔍 Fix Ready — pending implementation)|High|
|2026-06-16|BUG-009|Investigation|500 error - UNIQUE constraint on products.slug — Auto-create logic attempts to create existing product (📋 Open)| High |
|2026-06-16|BUG-008|Bug Fix|500 error when adding repository — Pass-by-value bug prevents default values from being applied (✅ FIXED)| High |
|2026-06-16|BUG-007|Security Fix|WebSocket connections lack authentication — Implemented JWT auth for all WebSocket endpoints (✅ FIXED)| High |
|2026-06-16|BUG-006|Bug Fix|401 error does not trigger login redirect — Axios interceptor missing second 401 handler (✅ FIXED: globalLogout utility + App event listener)| High |
|2026-06-16|BUG-005|Bug Fix|Missing API Routes for Remote Build and Tools Query — REST endpoints not registered in backend (✅ FIXED: Routes registered, handlers implemented)| Medium |
|2026-06-15|BUG-004|Bug Fix|Repository Registration Data Lost After Page Refresh — Frontend state management anti-pattern (✅ FIXED: TanStack Query migration)| Medium |
|2026-06-15|BUG-003-v2|Bug Fix|WebSocket Connection Failure in Development Environment — Missing VITE_USE_PROXY configuration (✅ FIXED)| Medium |
|2026-06-14|BUG-003-v1|Bug Fix|Fix /auth/profile endpoint returning incomplete user data (HTTP 502) (✅ FIXED)| High — all authenticated users affected |
|2026-06-04|REQ-007|ENH|UI/UX Improvements - Knowledge page, Indexing status display, Button control| Frontend: +1 component, +5 files modified |
|2026-06-04|INFRA|BUG|API path fixes and polling optimization for jobs endpoint| Frontend: +3 files modified |
|2026-06-01|REQ-007|CR|Manual Index Trigger - Add button + API for on-demand indexing (v1.1)| Spec update: +3 APIs, +1 table, +4-6h work |
|2026-06-01|REQ-009A|FR|Frontend authentication UI - Login, Register, Profile pages with JWT auth| Frontend: +12 files |
|2026-06-01|REQ-010|FR|Internationalization (i18n) - ja/en/vi support with language switcher| Frontend/Backend: +33 files |
|2026-05-27|REQ-001|RQ|Bootstrap repository structure for Engineering Knowledge System| none |
|2026-05-27|REQ-002|RQ|Add initial IPA spec skeleton for Document Search (index/chunk/query)| none |
|2026-05-27|REQ-003|RQ|Add initial IPA spec skeleton for Engineering Knowledge System core (semantic graph, canonical knowledge, retrieval pipeline, incremental rebuild)| none |

## 2026-06-16 - BUG-008: 500 Internal Server Error when adding repository to product

### Bug Fix

**Root Cause:** Pass-by-value bug in `ValidateAddRepoRequest` function. The validation function receives `AddRepoRequest` by value instead of pointer, causing default value assignments (`role="service"`, `search_weight=1.0`) to modify a local copy that gets discarded. When optional fields are omitted, the original request struct retains zero values (empty string for role, 0.0 for search_weight), violating database CHECK constraint and causing 500 errors.

**Impact:** High severity for API clients. Frontend UI unaffected (always sends role field), but direct API calls via curl/Postman/scripts fail with 500 error when role field is omitted. Database records created with explicit role but omitted search_weight have incorrect value (0.0 instead of 1.0), degrading search relevance.

**Fix Summary:**
1. **Core Validation Fix (Phase 1):**
   - Changed `ValidateAddRepoRequest` signature from `func(req AddRepoRequest)` to `func(req *AddRepoRequest)`
   - Fixed boolean logic bug in search_weight validation (`<= 0 && != 0` → `< 0`)
   - Updated call site in `AddRepo` to pass `&req` instead of `req`

2. **Testing (Phase 2):**
   - Added 15 unit tests covering all validation scenarios
   - Added 4 integration tests with real database
   - Tests verify defaults are applied and explicit values are preserved
   - 100% coverage of ValidateAddRepoRequest logic

3. **Error Handling Enhancement (Phase 3):**
   - Added CHECK constraint violation detection in HTTP handler
   - Returns 400 Bad Request instead of 500 for constraint violations
   - Provides descriptive error code "CONSTRAINT_VIOLATION"

4. **Data Migration (Phase 4):**
   - Created `fix-search-weights` migration script
   - Finds and fixes repos with `search_weight = 0.0`
   - Supports dry-run mode, idempotent execution

5. **Manual Verification (Phase 5):**
   - Comprehensive verification guide with UI and API test scenarios
   - Database verification queries
   - Regression check procedures

6. **Documentation (Phase 6):**
   - Updated change-log.md (this file)
   - Created MANUAL_VERIFICATION.md guide

**Files Changed:**
- `src/Backend/internal/product/manager.go` — Fixed validation function signature
- `src/Backend/internal/product/impl.go` — Updated call site
- `src/Backend/internal/product/manager_test.go` — Added 15 unit tests
- `src/Backend/internal/product/backward_compat_test.go` — Added 4 integration tests
- `src/Backend/internal/product/handlers.go` — Enhanced error handling
- `src/Backend/cmd/fix-search-weights/main.go` — NEW: Migration script
- `specs/BUG-008/MANUAL_VERIFICATION.md` — NEW: Manual test guide

**Test Results:**
- Unit tests: ✅ 15 tests passing (all validation scenarios covered)
- Integration tests: ✅ 4 tests passing (database verification)
- Build: ✅ No compilation errors
- Vet: ✅ No static analysis warnings
- Total: 19 automated tests, 0 failures

**Acceptance Criteria:**
- ✅ ValidateAddRepoRequest uses pointer parameter
- ✅ Default role="service" applied when field is omitted or empty
- ✅ Default search_weight=1.0 applied when field is omitted or zero
- ✅ Explicit values preserved (not overwritten by defaults)
- ✅ Invalid role values return 400 Bad Request (not 500)
- ✅ Negative search_weight values return 400 Bad Request
- ✅ All unit and integration tests pass
- ✅ Build and vet succeed

**Migration Notes:**
- Run migration script to fix existing data:
  ```bash
  ./bin/fix-search-weights -db data/metadata.db -dry-run  # Check affected repos
  ./bin/fix-search-weights -db data/metadata.db           # Apply fix
  ```
- Migration is optional (only affects search relevance scoring)

**Constitutional Compliance:**
- ✅ INVARIANT-1: Correctness > Performance (fix prioritizes correct defaults)
- ✅ Go Coding Standard 5.3: Use pointers when function modifies caller's data
- ✅ Test Strategy (Section 8): 80% coverage target exceeded

**Backward Compatibility:**
- ✅ No API contract changes
- ✅ Frontend unaffected (already sends all fields)
- ✅ Fix makes backend honor documented defaults
- ✅ Easy to roll back (single commit revert)

**Risk Assessment:**
- Regression risk: Low (localized change, comprehensive tests)
- Migration risk: Low (idempotent script, search_weight fix is optional)
- Testing risk: Low (19 automated tests provide safety net)

---

## 2026-06-16 - BUG-007: WebSocket Connections Lack Authentication

### Security Fix

**Root Cause:** WebSocket authentication was not implemented during initial development despite all necessary authentication infrastructure existing for HTTP endpoints. Frontend hooks (`useWebSocket`, `useRemoteSocket`) connect immediately without checking `isAuthenticated` state, and backend handler (`WSHub.ServeWS`) accepts connections without validating JWT tokens.

**Impact:** High severity security vulnerability allowing unauthorized access to real-time system events (indexing progress, build output, system notifications). All users in all deployment environments affected.

**Fix Summary:**
1. **Backend (Phase 1):**
   - Created `ParseJWTFromRequest()` function to validate JWT from Authorization header or query parameter
   - Modified `WSHub.ServeWS` to require authentication before connection upgrade
   - Applied same authentication pattern to REQ-003 remote build WebSocket
   - Added feature flag `WEBSOCKET_AUTH_REQUIRED` (default: `true`) for phased deployment
   - Implemented 34 unit tests covering all authentication scenarios

2. **Frontend (Phase 2):**
   - Modified `useWebSocket` and `useRemoteSocket` to only connect when `isAuthenticated === true`
   - Added JWT token to WebSocket URL: `ws://host/ws?token=<JWT>`
   - Implemented 401 error handling (close code 1008/4401) without auto-reconnect
   - Added connection cleanup on logout
   - Implemented 19 unit tests

3. **Integration & Deployment (Phase 3):**
   - Created comprehensive integration test suite
   - Automated security verification script (`websocket-security-test.sh`)
   - Phased deployment guide with feature flag strategy
   - Rollback procedures (2-5 minute recovery time)

4. **Documentation (Phase 4):**
   - API documentation (`docs/api/websocket-api.md`)
   - Deployment guide (`specs/BUG-007/deployment.md`)
// ... (291 more lines truncated — read full file if needed)
```

============================================================
## TASK: TASK-BUG-005-15

### ACCEPTANCE CRITERIA

- [ ] Reviewed CLAUDE.md section 11.2
- [ ] Confirmed REQ-003 status: "✅ Complete | 100%"
- [ ] If any inaccuracies found, document in BUG-005 investigation for future fix
- [ ] No changes made (status is now accurate after this fix)

### CODE SCOPE

<!-- 1 files, max 150 lines each -->

### CLAUDE.md
```
<!-- CLAUDE.md: file too large (40035 bytes), skipped -->
```