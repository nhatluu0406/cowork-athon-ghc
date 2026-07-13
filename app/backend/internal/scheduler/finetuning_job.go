package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/feedback"
	"github.com/rad-system/m365-knowledge-graph/internal/finetuning"
)

type FineTuningJobRunner struct {
	orchestrator FineTuningOrchestrator
	improver     ConfidenceImprover
	minPairs     int64
}

type FineTuningOrchestrator interface {
	ScheduleFineTuningJob(ctx context.Context, modelType, baseModel string, minPairs int64) (*finetuning.FineTuningJob, error)
	PollAndCompleteJobs(ctx context.Context) error
}

type ConfidenceImprover interface {
	IdentifyLowConfidenceHotspots(ctx context.Context, threshold float64) ([]*feedback.LowConfidenceHotspot, error)
}

func NewFineTuningJobRunner(orchestrator FineTuningOrchestrator, improver ConfidenceImprover, minPairs int64) *FineTuningJobRunner {
	return &FineTuningJobRunner{
		orchestrator: orchestrator,
		improver:     improver,
		minPairs:     minPairs,
	}
}

// Run executes the fine-tuning job decision logic (called monthly or on-demand)
func (fjr *FineTuningJobRunner) Run(ctx context.Context) error {
	slog.InfoContext(ctx, "starting fine-tuning job evaluation")

	// 1. Check low-confidence hotspots (could trigger emergency retraining)
	hotspots, err := fjr.improver.IdentifyLowConfidenceHotspots(ctx, 0.5)
	if err != nil {
		slog.ErrorContext(ctx, "failed to identify low-confidence hotspots", "error", err)
		// Continue anyway, don't block the job
	}

	if len(hotspots) > 10 {
		slog.WarnContext(ctx, "high confidence drift detected, forcing fine-tuning", "hotspots", len(hotspots))
	}

	// 2. Schedule fine-tuning job for answer generator
	job, err := fjr.orchestrator.ScheduleFineTuningJob(ctx, "answer_generator", "claude-opus-4-8", fjr.minPairs)
	if err != nil {
		slog.ErrorContext(ctx, "failed to schedule fine-tuning job", "error", err)
		// This is not fatal - may just need more feedback data
		return nil
	}

	slog.InfoContext(ctx, "fine-tuning job scheduled successfully", "job_id", job.ID, "status", job.Status)
	return nil
}

// PollJobs polls in-flight fine-tuning jobs for completion
func (fjr *FineTuningJobRunner) PollJobs(ctx context.Context) error {
	return fjr.orchestrator.PollAndCompleteJobs(ctx)
}

type FineTuningScheduler struct {
	interval time.Duration
	ticker   *time.Ticker
	done     chan struct{}
}

func NewFineTuningScheduler(interval time.Duration) *FineTuningScheduler {
	return &FineTuningScheduler{
		interval: interval,
		done:     make(chan struct{}),
	}
}

func (fs *FineTuningScheduler) Start(ctx context.Context, jobRunner *FineTuningJobRunner) {
	fs.ticker = time.NewTicker(fs.interval)

	go func() {
		slog.InfoContext(ctx, "fine-tuning scheduler started", "interval", fs.interval)

		// Also run a polling job more frequently to check pending jobs
		pollTicker := time.NewTicker(1 * time.Hour)
		defer pollTicker.Stop()

		for {
			select {
			case <-fs.ticker.C:
				jobCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
				if err := jobRunner.Run(jobCtx); err != nil {
					slog.ErrorContext(jobCtx, "fine-tuning job run failed", "error", err)
				}
				cancel()

			case <-pollTicker.C:
				pollCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
				if err := jobRunner.PollJobs(pollCtx); err != nil {
					slog.ErrorContext(pollCtx, "fine-tuning job polling failed", "error", err)
				}
				cancel()

			case <-fs.done:
				slog.InfoContext(ctx, "fine-tuning scheduler stopped")
				return

			case <-ctx.Done():
				slog.InfoContext(ctx, "fine-tuning scheduler context cancelled")
				return
			}
		}
	}()
}

func (fs *FineTuningScheduler) Stop() error {
	if fs.ticker != nil {
		fs.ticker.Stop()
	}
	close(fs.done)
	return nil
}

type FineTuningJobStatus struct {
	LastRun       time.Time
	NextRun       time.Time
	IsRunning     bool
	LastError     string
	JobsQueued    int64
	JobsRunning   int64
	JobsCompleted int64
}

func (fs *FineTuningScheduler) GetStatus() *FineTuningJobStatus {
	return &FineTuningJobStatus{
		NextRun: time.Now().Add(fs.interval),
	}
}
