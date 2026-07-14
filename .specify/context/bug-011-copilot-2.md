# BUG-011 (Part 2/3): TASK-BUG-011-04 → TASK-BUG-011-06

> **Copilot instructions:**
> - Do NOT use @workspace or @codebase — all context is in this file.
> - ⚠️  **First message only**: include `#file:` — remove it from ALL replies.
> - Implement tasks **in order**, one at a time.
> - After EACH task: reply `TASK-ID done` (no #file:) before proceeding.
> - Mark each completed task `[x]` in tasks.md.
> - Context: ~1,513 tokens | 3 tasks | Part 2/3

---


## Task 1/3: TASK-BUG-011-04


### ACCEPTANCE CRITERIA

- [ ] One trigger → one job in the jobs table (not two)
- [ ] Outer job transitions: `queued → running → validating → publishing → done/failed`
- [ ] User sees correct live status while indexing
- [ ] Existing integration tests for IndexIncremental still pass

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

> Reply `TASK-BUG-011-04 done` (without #file:) to continue.

---

## Task 2/3: TASK-BUG-011-05
**[P]**


### ACCEPTANCE CRITERIA

- [ ] In production (no Vite proxy), trigger sends to `POST /api/v1/repos/{id}/index` — no 404
- [ ] In dev (Vite proxy), behavior unchanged

### CODE SCOPE

// 1 files, max 80 lines each

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
// ... (126 more lines — read full file if needed)
```

> Reply `TASK-BUG-011-05 done` (without #file:) to continue.

---

## Task 3/3: TASK-BUG-011-06
**[P]**


### ACCEPTANCE CRITERIA

- [ ] `TestProcessJobUsesPerRepoPath`: registers repo with path `/repo2`, triggers ProcessJob → mock gitClient records `NewClient("/repo2")` was called
- [ ] `TestProcessJobEmptyPath`: repo with empty path → ProcessJob marks job `failed`, no panic

### CODE SCOPE

// 1 files, max 80 lines each

### src/Backend/internal/indexer/orchestrator_test.go
```
// not found: src/Backend/internal/indexer/orchestrator_test.go
```

> Reply `TASK-BUG-011-06 done` (without #file:) to continue.

---