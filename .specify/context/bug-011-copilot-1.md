# BUG-011 (Part 1/3): TASK-BUG-011-01 → TASK-BUG-011-03

> **Copilot instructions:**
> - Do NOT use @workspace or @codebase — all context is in this file.
> - ⚠️  **First message only**: include `#file:` — remove it from ALL replies.
> - Implement tasks **in order**, one at a time.
> - After EACH task: reply `TASK-ID done` (no #file:) before proceeding.
> - Mark each completed task `[x]` in tasks.md.
> - Context: ~2,705 tokens | 3 tasks | Part 1/3

---


## Task 1/3: TASK-BUG-011-01


### ACCEPTANCE CRITERIA

- [ ] `ProcessJob` creates a `git.Client` from `repo.Path` (DB), not `o.repoConfig.Path`
- [ ] If `repo.Path == ""`, job is marked `failed` with message "repository path not configured"; no panic
- [ ] If path is not a valid git repo, `GetHeadCommit` error propagates as job `failed`; no panic
- [ ] Repo ID 1 (original startup repo) continues to index correctly

### CODE SCOPE

// 2 files, max 80 lines each

### src/Backend/internal/indexer/orchestrator.go
```
package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/dungpd4/rad-system/internal/epoch"
	"github.com/dungpd4/rad-system/internal/git"
	"github.com/dungpd4/rad-system/internal/graph"
	"github.com/dungpd4/rad-system/internal/metadata"
	"github.com/dungpd4/rad-system/internal/planner"
	"github.com/dungpd4/rad-system/internal/repo"
)

// Orchestrator coordinates the entire indexing process
type Orchestrator interface {
	// IndexIncremental performs incremental indexing
	IndexIncremental(ctx context.Context, repoID int64, oldCommit, newCommit string) (*IndexResult, error)

	// IndexFull performs full reindexing
	IndexFull(ctx context.Context, repoID int64) (*IndexResult, error)

	// ProcessJob processes a manual indexing job (REQ-007 v1.1)
	ProcessJob(ctx context.Context, job interface{}) error
}

type orchestrator struct {
	db           metadata.DB
	gitClient    git.Client
	planner      planner.Planner
	builder      epoch.Builder
	validator    epoch.Validator
	publisher    epoch.Publisher
	graphBuilder graph.GraphBuilder
	repoConfig   *repo.Config
	logger       *slog.Logger
}

// NewOrchestrator creates a new indexing orchestrator
func NewOrchestrator(
	db metadata.DB,
	gitClient git.Client,
	config *repo.Config,
	logger *slog.Logger,
) Orchestrator {
	// Initialize graph builder components (FR-04)
	graphStore := graph.NewMetadataGraphStore(db)
	nodeExtractor := graph.NewDBSymbolNodeExtractor(db)
	graphBuilder := graph.NewGraphBuilder(graphStore, nodeExtractor)

	return &orchestrator{
		db:           db,
		gitClient:    gitClient,
		planner:      planner.NewPlanner(gitClient, config),
		builder:      epoch.NewBuilder(db, gitClient, logger),
		validator:    epoch.NewValidator(db, logger),
		publisher:    epoch.NewPublisher(db, logger),
		graphBuilder: graphBuilder,
		repoConfig:   config,
		logger:       logger,
	}
}

// IndexResult represents the result of an indexing operation
type IndexResult struct {
	JobID       int64
	TargetEpoch int64
	Status      metadata.JobStatus
	Error       error
	Duration    time.Duration
}

func (o *orchestrator) IndexIncremental(ctx context.Context, repoID int64, oldCommit, newCommit string) (*IndexResult, error) {
	startTime := time.Now()

	o.logger.Info("Starting incremental indexing",
// ... (326 more lines — read full file if needed)
```

### src/Backend/internal/git/client.go
```
package git

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Client provides Git operations
type Client interface {
	// GetHeadCommit returns current HEAD commit SHA
	GetHeadCommit(ctx context.Context) (string, error)

	// Diff returns file changes between commits
	Diff(ctx context.Context, oldCommit, newCommit string) ([]FileChange, error)

	// GetFileContent returns file content at specific commit
	GetFileContent(ctx context.Context, commit, path string) ([]byte, error)

	// IsClean returns true if working tree is clean
	IsClean(ctx context.Context) (bool, error)

	// GetBlobHash returns the blob hash for a file
	GetBlobHash(ctx context.Context, commit, path string) (string, error)

	// Add stages files for commit
	Add(path string) error

	// Commit creates a commit with message
	Commit(message string) (string, error)

	// Push pushes changes to remote
	Push(branch string) error
}

// ChangeStatus represents the status of a file change
type ChangeStatus string

const (
	ChangeAdded    ChangeStatus = "A"
	ChangeModified ChangeStatus = "M"
	ChangeDeleted  ChangeStatus = "D"
	ChangeRenamed  ChangeStatus = "R"
	ChangeCopied   ChangeStatus = "C"
)

// FileChange represents a file change in git diff
type FileChange struct {
	Status   ChangeStatus
	OldPath  string
	NewPath  string
	BlobHash string
}

// gitClient implements Client interface
type gitClient struct {
	repoPath string
}

// NewClient creates a new Git client
func NewClient(repoPath string) Client {
	return &gitClient{repoPath: repoPath}
}

func (c *gitClient) GetHeadCommit(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = c.repoPath

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

func (c *gitClient) Diff(ctx context.Context, oldCommit, newCommit string) ([]FileChange, error) {
	// Use --name-status with -M to detect renames
	cmd := exec.CommandContext(ctx, "git", "diff", "--name-status", "-M", oldCommit, newCommit)
// ... (134 more lines — read full file if needed)
```

> Reply `TASK-BUG-011-01 done` (without #file:) to continue.

---

## Task 2/3: TASK-BUG-011-02


### ACCEPTANCE CRITERIA

- [ ] `buildCodeGraph` receives correct per-repo path
- [ ] Empty-path guard: if path is empty, log warning and return nil (non-fatal)

### CODE SCOPE

// 1 files, max 80 lines each

### src/Backend/internal/indexer/orchestrator.go
```
package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/dungpd4/rad-system/internal/epoch"
	"github.com/dungpd4/rad-system/internal/git"
	"github.com/dungpd4/rad-system/internal/graph"
	"github.com/dungpd4/rad-system/internal/metadata"
	"github.com/dungpd4/rad-system/internal/planner"
	"github.com/dungpd4/rad-system/internal/repo"
)

// Orchestrator coordinates the entire indexing process
type Orchestrator interface {
	// IndexIncremental performs incremental indexing
	IndexIncremental(ctx context.Context, repoID int64, oldCommit, newCommit string) (*IndexResult, error)

	// IndexFull performs full reindexing
	IndexFull(ctx context.Context, repoID int64) (*IndexResult, error)

	// ProcessJob processes a manual indexing job (REQ-007 v1.1)
	ProcessJob(ctx context.Context, job interface{}) error
}

type orchestrator struct {
	db           metadata.DB
	gitClient    git.Client
	planner      planner.Planner
	builder      epoch.Builder
	validator    epoch.Validator
	publisher    epoch.Publisher
	graphBuilder graph.GraphBuilder
	repoConfig   *repo.Config
	logger       *slog.Logger
}

// NewOrchestrator creates a new indexing orchestrator
func NewOrchestrator(
	db metadata.DB,
	gitClient git.Client,
	config *repo.Config,
	logger *slog.Logger,
) Orchestrator {
	// Initialize graph builder components (FR-04)
	graphStore := graph.NewMetadataGraphStore(db)
	nodeExtractor := graph.NewDBSymbolNodeExtractor(db)
	graphBuilder := graph.NewGraphBuilder(graphStore, nodeExtractor)

	return &orchestrator{
		db:           db,
		gitClient:    gitClient,
		planner:      planner.NewPlanner(gitClient, config),
		builder:      epoch.NewBuilder(db, gitClient, logger),
		validator:    epoch.NewValidator(db, logger),
		publisher:    epoch.NewPublisher(db, logger),
		graphBuilder: graphBuilder,
		repoConfig:   config,
		logger:       logger,
	}
}

// IndexResult represents the result of an indexing operation
type IndexResult struct {
	JobID       int64
	TargetEpoch int64
	Status      metadata.JobStatus
	Error       error
	Duration    time.Duration
}

func (o *orchestrator) IndexIncremental(ctx context.Context, repoID int64, oldCommit, newCommit string) (*IndexResult, error) {
	startTime := time.Now()

	o.logger.Info("Starting incremental indexing",
// ... (326 more lines — read full file if needed)
```

> Reply `TASK-BUG-011-02 done` (without #file:) to continue.

---

## Task 3/3: TASK-BUG-011-03


### ACCEPTANCE CRITERIA

- [ ] `getRunningJobForRepo` returns `(nil, sql.ErrNoRows)` when no running jobs exist (unchanged)
- [ ] When inner job created by `metadata.CreateJob` is running (user_email=NULL, config_json=NULL), scan succeeds
- [ ] Subsequent trigger returns HTTP 409 Conflict (not HTTP 500)

### CODE SCOPE

// 1 files, max 80 lines each

### src/Backend/internal/api/handlers_index.go
```
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	_ "modernc.org/sqlite"

	"github.com/gorilla/mux"

	"github.com/dungpd4/rad-system/internal/indexer"
	"github.com/dungpd4/rad-system/internal/metadata"
)

// IndexTriggerRequest is the request body for triggering manual indexing
type IndexTriggerRequest struct {
	Force       bool   `json:"force"`       // true = force reindex ignoring existing epochs
	Incremental bool   `json:"incremental"` // true = incremental, false = full scan
	CommitHash  string `json:"commit_hash"` // optional: index up to specific commit
}

// IndexTriggerResponse is the response for triggering manual indexing
type IndexTriggerResponse struct {
	JobID     string    `json:"job_id"`
	Status    string    `json:"status"`
	RepoID    int64     `json:"repo_id"`
	StartedAt time.Time `json:"started_at"`
	Message   string    `json:"message"`
}

// IndexStatusResponse is the response for index status query
type IndexStatusResponse struct {
	JobID                     string `json:"job_id"`
	Status                    string `json:"status"`
	Progress                  int    `json:"progress"`
	CurrentFile               string `json:"current_file,omitempty"`
	FilesProcessed            int    `json:"files_processed"`
	FilesTotal                int    `json:"files_total"`
	SymbolsFound              int    `json:"symbols_found"`
	ElapsedSeconds            int    `json:"elapsed_seconds"`
	EstimatedRemainingSeconds int    `json:"estimated_remaining_seconds,omitempty"`
}

// IndexHistoryItem represents a single index job in history
type IndexHistoryItem struct {
	JobID        string     `json:"job_id"`
	Status       string     `json:"status"`
	StartedAt    time.Time  `json:"started_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	DurationSecs int        `json:"duration_seconds,omitempty"`
	FilesIndexed int        `json:"files_indexed"`
	SymbolsFound int        `json:"symbols_found"`
	EpochCreated int64      `json:"epoch_created,omitempty"`
	TriggeredBy  string     `json:"triggered_by"`
	UserEmail    string     `json:"user,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
}

// IndexHistoryResponse is the response for index history query
type IndexHistoryResponse struct {
	Jobs  []IndexHistoryItem `json:"jobs"`
	Total int                `json:"total"`
}

// handleTriggerIndex triggers a manual indexing job (POST /api/v1/repos/{id}/index)
func (s *Server) handleTriggerIndex(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	repoIDStr := vars["id"]

	repoID, err := strconv.ParseInt(repoIDStr, 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid repo_id: %w", err))
		return
	}
// ... (369 more lines — read full file if needed)
```

> Reply `TASK-BUG-011-03 done` (without #file:) to continue.

---