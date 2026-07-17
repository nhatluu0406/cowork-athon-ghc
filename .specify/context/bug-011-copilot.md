# Implementation Batch: BUG-011

> **Copilot instructions:**
> - Do NOT use @workspace or @codebase.
> - Implement tasks **in order**, one at a time.
> - After each task reply `TASK-ID done` before proceeding.
> - Mark each completed task `[x]` in tasks.md.
> - Total context: ~8,444 tokens across 7 tasks.

---


## Task 1/7: TASK-BUG-011-01


### ACCEPTANCE CRITERIA

- [ ] `ProcessJob` creates a `git.Client` from `repo.Path` (DB), not `o.repoConfig.Path`
- [ ] If `repo.Path == ""`, job is marked `failed` with message "repository path not configured"; no panic
- [ ] If path is not a valid git repo, `GetHeadCommit` error propagates as job `failed`; no panic
- [ ] Repo ID 1 (original startup repo) continues to index correctly

### CODE SCOPE

// 2 files, max 150 lines each

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
		"repo_id", repoID,
		"old_commit", oldCommit,
		"new_commit", newCommit,
	)

	// Get current repository state
	repository, err := o.db.GetRepository(ctx, repoID)
	if err != nil {
		return nil, fmt.Errorf("get repository: %w", err)
	}

	// If oldCommit is empty and no active epoch, use special marker for full diff from root
	if oldCommit == "" && repository.ActiveEpoch == 0 {
		o.logger.Info("First-time indexing: using root commit marker")
		// Use 4b825dc642cb6eb9a060e54bf8d69288fbee4904 (git's magic hash for empty tree)
		// or just use newCommit with git diff --root in the diff logic
		oldCommit = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
	}

	targetEpoch := repository.ActiveEpoch + 1

	// Create index job
	job := &metadata.IndexJob{
		RepoID:      repoID,
		OldCommit:   oldCommit,
		NewCommit:   newCommit,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobQueued,
	}

	jobID, err := o.db.CreateJob(ctx, job)
	if err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	result := &IndexResult{
		JobID:       jobID,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobRunning,
	}

	// Update job status to running
	if err := o.db.UpdateJobStatus(ctx, jobID, metadata.JobRunning, ""); err != nil {
		o.logger.Error("Failed to update job status", "error", err)
	}

	// Step 1: Plan
	o.logger.Info("Creating index plan", "job_id", jobID)
	plan, err := o.planner.Plan(ctx, oldCommit, newCommit)
	if err != nil {
		result.Status = metadata.JobFailed
		result.Error = fmt.Errorf("create plan: %w", err)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobFailed, result.Error.Error())
		return result, result.Error
	}

	if plan.IsEmpty() {
		o.logger.Info("No changes detected", "job_id", jobID)
		result.Status = metadata.JobDone
		result.Duration = time.Since(startTime)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobDone, "")
		return result, nil
	}

	o.logger.Info("Index plan created",
		"job_id", jobID,
		"added", len(plan.AddedFiles),
		"modified", len(plan.ModifiedFiles),
		"deleted", len(plan.DeletedFiles),
		"renamed", len(plan.RenamedFiles),
// ... (256 more lines — read full file if needed)
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
	cmd.Dir = c.repoPath

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff: %w", err)
	}

	return parseGitDiff(string(output))
}

func (c *gitClient) GetFileContent(ctx context.Context, commit, path string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", "show", fmt.Sprintf("%s:%s", commit, path))
	cmd.Dir = c.repoPath

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git show %s:%s: %w", commit, path, err)
	}

	return output, nil
}

func (c *gitClient) IsClean(ctx context.Context) (bool, error) {
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = c.repoPath

	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("git status: %w", err)
	}

	return len(strings.TrimSpace(string(output))) == 0, nil
}

func (c *gitClient) GetBlobHash(ctx context.Context, commit, path string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "ls-tree", commit, path)
	cmd.Dir = c.repoPath

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git ls-tree: %w", err)
	}

	// Output format: <mode> <type> <hash>\t<path>
	// Example: 100644 blob abc123def456\tREADME.md
	parts := strings.Fields(string(output))
	if len(parts) < 3 {
		return "", fmt.Errorf("unexpected git ls-tree output: %s", output)
	}

	return parts[2], nil
}

// parseGitDiff parses git diff --name-status output
func parseGitDiff(output string) ([]FileChange, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	changes := make([]FileChange, 0, len(lines))

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		status := ChangeStatus(parts[0][0:1])
		change := FileChange{
// ... (64 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-01 done` to proceed.

---

## Task 2/7: TASK-BUG-011-02


### ACCEPTANCE CRITERIA

- [ ] `buildCodeGraph` receives correct per-repo path
- [ ] Empty-path guard: if path is empty, log warning and return nil (non-fatal)

### CODE SCOPE

// 1 files, max 150 lines each

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
		"repo_id", repoID,
		"old_commit", oldCommit,
		"new_commit", newCommit,
	)

	// Get current repository state
	repository, err := o.db.GetRepository(ctx, repoID)
	if err != nil {
		return nil, fmt.Errorf("get repository: %w", err)
	}

	// If oldCommit is empty and no active epoch, use special marker for full diff from root
	if oldCommit == "" && repository.ActiveEpoch == 0 {
		o.logger.Info("First-time indexing: using root commit marker")
		// Use 4b825dc642cb6eb9a060e54bf8d69288fbee4904 (git's magic hash for empty tree)
		// or just use newCommit with git diff --root in the diff logic
		oldCommit = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
	}

	targetEpoch := repository.ActiveEpoch + 1

	// Create index job
	job := &metadata.IndexJob{
		RepoID:      repoID,
		OldCommit:   oldCommit,
		NewCommit:   newCommit,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobQueued,
	}

	jobID, err := o.db.CreateJob(ctx, job)
	if err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	result := &IndexResult{
		JobID:       jobID,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobRunning,
	}

	// Update job status to running
	if err := o.db.UpdateJobStatus(ctx, jobID, metadata.JobRunning, ""); err != nil {
		o.logger.Error("Failed to update job status", "error", err)
	}

	// Step 1: Plan
	o.logger.Info("Creating index plan", "job_id", jobID)
	plan, err := o.planner.Plan(ctx, oldCommit, newCommit)
	if err != nil {
		result.Status = metadata.JobFailed
		result.Error = fmt.Errorf("create plan: %w", err)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobFailed, result.Error.Error())
		return result, result.Error
	}

	if plan.IsEmpty() {
		o.logger.Info("No changes detected", "job_id", jobID)
		result.Status = metadata.JobDone
		result.Duration = time.Since(startTime)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobDone, "")
		return result, nil
	}

	o.logger.Info("Index plan created",
		"job_id", jobID,
		"added", len(plan.AddedFiles),
		"modified", len(plan.ModifiedFiles),
		"deleted", len(plan.DeletedFiles),
		"renamed", len(plan.RenamedFiles),
// ... (256 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-02 done` to proceed.

---

## Task 3/7: TASK-BUG-011-03


### ACCEPTANCE CRITERIA

- [ ] `getRunningJobForRepo` returns `(nil, sql.ErrNoRows)` when no running jobs exist (unchanged)
- [ ] When inner job created by `metadata.CreateJob` is running (user_email=NULL, config_json=NULL), scan succeeds
- [ ] Subsequent trigger returns HTTP 409 Conflict (not HTTP 500)

### CODE SCOPE

// 1 files, max 150 lines each

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

	// Parse request body
	var req IndexTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}

	// Get user email from JWT context (if authenticated)
	userEmail := getUserEmailFromContext(ctx)

	// Check if there's already a running job for this repo (NFR-08: 1 job per repo)
	existingJob, err := s.getRunningJobForRepo(ctx, repoID)
	if err != nil && err != sql.ErrNoRows {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to check existing jobs: %w", err))
		return
	}
	if existingJob != nil {
		respondError(w, http.StatusConflict, fmt.Errorf("an index job is already running for this repository (job_id: %s)", existingJob.JobID))
		return
	}

	// Create index job
	configJSON, _ := json.Marshal(req)

	// Create metadata job using standard DB interface
	metadataJob := &metadata.IndexJob{
		RepoID:    repoID,
		Status:    "queued",
		CreatedAt: time.Now(),
	}

	// Insert job into database and get numeric ID
	jobNumID, err := s.db.CreateJob(ctx, metadataJob)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to create index job: %w", err))
		return
	}

	// Use numeric ID for ProcessJob (ensures DB updates work correctly)
	jobIDStr := fmt.Sprintf("%d", jobNumID)

	// Queue job for processing (async)
	if s.indexOrchestrator != nil {
		// Create indexer job with numeric ID
		indexerJob := &indexer.IndexJob{
			JobID:       jobIDStr,
			RepoID:      repoID,
			Status:      "queued",
			Progress:    0,
			TriggeredBy: "manual",
			UserEmail:   userEmail,
			ConfigJSON:  string(configJSON),
			CreatedAt:   time.Now(),
		}
		// Use background context to avoid context cancellation from request timeout
		// ProcessJob runs async and should not be tied to request lifecycle
		bgCtx := context.Background()
		go s.indexOrchestrator.ProcessJob(bgCtx, indexerJob)
	}

	// Return response with numeric ID
	resp := IndexTriggerResponse{
		JobID:     jobIDStr,
		Status:    "queued",
		RepoID:    repoID,
		StartedAt: time.Now(),
		Message:   "Indexing job queued successfully",
	}

// ... (299 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-03 done` to proceed.

---

## Task 4/7: TASK-BUG-011-04


### ACCEPTANCE CRITERIA

- [ ] One trigger → one job in the jobs table (not two)
- [ ] Outer job transitions: `queued → running → validating → publishing → done/failed`
- [ ] User sees correct live status while indexing
- [ ] Existing integration tests for IndexIncremental still pass

### CODE SCOPE

// 1 files, max 150 lines each

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
		"repo_id", repoID,
		"old_commit", oldCommit,
		"new_commit", newCommit,
	)

	// Get current repository state
	repository, err := o.db.GetRepository(ctx, repoID)
	if err != nil {
		return nil, fmt.Errorf("get repository: %w", err)
	}

	// If oldCommit is empty and no active epoch, use special marker for full diff from root
	if oldCommit == "" && repository.ActiveEpoch == 0 {
		o.logger.Info("First-time indexing: using root commit marker")
		// Use 4b825dc642cb6eb9a060e54bf8d69288fbee4904 (git's magic hash for empty tree)
		// or just use newCommit with git diff --root in the diff logic
		oldCommit = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
	}

	targetEpoch := repository.ActiveEpoch + 1

	// Create index job
	job := &metadata.IndexJob{
		RepoID:      repoID,
		OldCommit:   oldCommit,
		NewCommit:   newCommit,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobQueued,
	}

	jobID, err := o.db.CreateJob(ctx, job)
	if err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	result := &IndexResult{
		JobID:       jobID,
		TargetEpoch: targetEpoch,
		Status:      metadata.JobRunning,
	}

	// Update job status to running
	if err := o.db.UpdateJobStatus(ctx, jobID, metadata.JobRunning, ""); err != nil {
		o.logger.Error("Failed to update job status", "error", err)
	}

	// Step 1: Plan
	o.logger.Info("Creating index plan", "job_id", jobID)
	plan, err := o.planner.Plan(ctx, oldCommit, newCommit)
	if err != nil {
		result.Status = metadata.JobFailed
		result.Error = fmt.Errorf("create plan: %w", err)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobFailed, result.Error.Error())
		return result, result.Error
	}

	if plan.IsEmpty() {
		o.logger.Info("No changes detected", "job_id", jobID)
		result.Status = metadata.JobDone
		result.Duration = time.Since(startTime)
		o.db.UpdateJobStatus(ctx, jobID, metadata.JobDone, "")
		return result, nil
	}

	o.logger.Info("Index plan created",
		"job_id", jobID,
		"added", len(plan.AddedFiles),
		"modified", len(plan.ModifiedFiles),
		"deleted", len(plan.DeletedFiles),
		"renamed", len(plan.RenamedFiles),
// ... (256 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-04 done` to proceed.

---

## Task 5/7: TASK-BUG-011-05
**[P]**


### ACCEPTANCE CRITERIA

- [ ] In production (no Vite proxy), trigger sends to `POST /api/v1/repos/{id}/index` — no 404
- [ ] In dev (Vite proxy), behavior unchanged

### CODE SCOPE

// 1 files, max 150 lines each

### src/Frontend/src/components/indexing/TriggerIndexModal.tsx
```
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/api/client'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useProducts, useProductRepos } from '@/hooks/useProducts'

interface TriggerIndexModalProps {
  open: boolean
  onClose: () => void
}

export function TriggerIndexModal({ open, onClose }: TriggerIndexModalProps) {
  const queryClient = useQueryClient()
  const [forceFull, setForceFull] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<number | ''>('')
  const [selectedRepoId, setSelectedRepoId] = useState<number | ''>('')

  const { data: products = [] } = useProducts()
  const { data: repos = [] } = useProductRepos(
    selectedProductId !== '' ? selectedProductId : 0
  )

  // Resolve display name for selected repo
  const selectedRepo = repos.find(r => r.repo_id === selectedRepoId)
  const selectedProduct = products.find(p => p.id === selectedProductId)

  const handleProductChange = (productId: number | '') => {
    setSelectedProductId(productId)
    setSelectedRepoId('') // reset repo when product changes
  }

  const handleTrigger = async () => {
    if (isSubmitting) return

    // Require repo selection
    if (selectedRepoId === '') {
      toast.error('リポジトリを選択してください')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await client.post(`/api/v1/repos/${selectedRepoId}/index`, {
        force: forceFull,
        incremental: !forceFull,
      })

      if (response.data) {
        const repoName = selectedRepo?.display_name || selectedRepo?.path || `Repo ${selectedRepoId}`
        const productName = selectedProduct?.name || ''
        toast.success(`[${productName}] ${repoName} のインデックスジョブを開始しました`)
        queryClient.invalidateQueries({ queryKey: ['jobs'] })
        onClose()
        setForceFull(false)
        setSelectedProductId('')
        setSelectedRepoId('')
      }
    } catch (error: any) {
      console.error('インデックストリガーエラー:', error)
      if (error.response?.status === 409) {
        toast.error('インデックスジョブが既に実行中です')
      } else {
        toast.error('インデックス開始に失敗しました')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!isSubmitting) {
          onClose()
          setForceFull(false)
          setSelectedProductId('')
          setSelectedRepoId('')
        }
      }}
      title="インデックストリガー"
      footer={
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => {
              if (!isSubmitting) {
                onClose()
                setForceFull(false)
                setSelectedProductId('')
                setSelectedRepoId('')
              }
            }}
            disabled={isSubmitting}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleTrigger}
            disabled={isSubmitting || selectedRepoId === ''}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                トリガー中...
              </div>
            ) : (
              'トリガー'
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Project selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            プロジェクト <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedProductId}
            onChange={(e) =>
              handleProductChange(e.target.value === '' ? '' : Number(e.target.value))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
            disabled={isSubmitting}
          >
            <option value="">プロジェクトを選択...</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </div>

        {/* Repo selector — shown only when product is selected */}
        {selectedProductId !== '' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              リポジトリ <span className="text-red-500">*</span>
            </label>
            {repos.length === 0 ? (
// ... (56 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-05 done` to proceed.

---

## Task 6/7: TASK-BUG-011-06
**[P]**


### ACCEPTANCE CRITERIA

- [ ] `TestProcessJobUsesPerRepoPath`: registers repo with path `/repo2`, triggers ProcessJob → mock gitClient records `NewClient("/repo2")` was called
- [ ] `TestProcessJobEmptyPath`: repo with empty path → ProcessJob marks job `failed`, no panic

### CODE SCOPE

// 1 files, max 150 lines each

### src/Backend/internal/indexer/orchestrator_test.go
```
// not found: src/Backend/internal/indexer/orchestrator_test.go
```

> Confirm: reply `TASK-BUG-011-06 done` to proceed.

---

## Task 7/7: TASK-BUG-011-07
**[P]**


### ACCEPTANCE CRITERIA

- [ ] `TestGetRunningJobNullColumns`: seed DB with job that has NULL user_email/config_json and status='running' → `getRunningJobForRepo` returns job without error
- [ ] `TestGetR

### CODE SCOPE

// 1 files, max 150 lines each

### src/Backend/internal/api/handlers_index_test.go
```
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockDBForIndex extends MinimalMockDB for index handler testing
type MockDBForIndex struct {
	MinimalMockDB
	jobs map[int64]map[string]interface{}
}

// Test: handleTriggerIndex POST endpoint
func TestHandleTriggerIndex_Success(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/1/index", bytes.NewBufferString(`{
		"force": false,
		"incremental": true
	}`))
	req.Header.Set("Content-Type", "application/json")

	// Add path parameters
	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	// Create mock server
	server := &Server{
		db:                &MockDBForIndex{},
		indexOrchestrator: nil, // Will be nil for test
	}

	server.handleTriggerIndex(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response IndexTriggerResponse
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response.JobID)
	assert.Equal(t, "queued", response.Status)
	assert.Equal(t, int64(1), response.RepoID)
	assert.NotEmpty(t, response.Message)
}

// Test: handleTriggerIndex with invalid repo ID
func TestHandleTriggerIndex_InvalidRepoID(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/invalid/index", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")

	vars := map[string]string{"id": "invalid"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleTriggerIndex(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// Test: handleTriggerIndex with invalid JSON
func TestHandleTriggerIndex_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/repos/1/index", bytes.NewBufferString(`{invalid json}`))
	req.Header.Set("Content-Type", "application/json")

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleTriggerIndex(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// Test: handleIndexStatus GET endpoint
func TestHandleIndexStatus_Success(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/repos/1/index/status?job_id=idx-1", nil)

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleIndexStatus(w, req)

	// Note: Will fail without proper DB implementation, but tests the endpoint structure
	// In real implementation, this would check DB
	assert.NotEqual(t, http.StatusInternalServerError, w.Code)
}

// Test: handleIndexStatus missing job_id parameter
func TestHandleIndexStatus_MissingJobID(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/repos/1/index/status", nil)

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleIndexStatus(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// Test: handleIndexHistory GET endpoint
func TestHandleIndexHistory_Success(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/repos/1/index/history?limit=20", nil)

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleIndexHistory(w, req)

	// Should return 200 or 500 (depending on DB implementation)
	assert.True(t, w.Code == http.StatusOK || w.Code == http.StatusInternalServerError)
}

// Test: handleIndexHistory with custom limit
func TestHandleIndexHistory_CustomLimit(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/repos/1/index/history?limit=50", nil)

	vars := map[string]string{"id": "1"}
	req = mux.SetURLVars(req, vars)

	w := httptest.NewRecorder()

	server := &Server{db: &MockDBForIndex{}}
	server.handleIndexHistory(w, req)

	assert.True(t, w.Code == http.StatusOK || w.Code == http.StatusInternalServerError)
}

// ... (182 more lines — read full file if needed)
```

> Confirm: reply `TASK-BUG-011-07 done` to proceed.

---