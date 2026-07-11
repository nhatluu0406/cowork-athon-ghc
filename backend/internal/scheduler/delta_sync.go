package scheduler

import (
	"context"
	"log/slog"
	"time"
)

type DeltaSyncScheduler struct {
	interval time.Duration
	ticker   *time.Ticker
	done     chan struct{}
}

func NewDeltaSyncScheduler(interval time.Duration) *DeltaSyncScheduler {
	return &DeltaSyncScheduler{
		interval: interval,
		done:     make(chan struct{}),
	}
}

func (dss *DeltaSyncScheduler) Start(ctx context.Context, syncFunc func(context.Context) error) {
	dss.ticker = time.NewTicker(dss.interval)

	go func() {
		slog.InfoContext(ctx, "delta sync scheduler started", "interval", dss.interval)

		for {
			select {
			case <-dss.ticker.C:
				syncCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
				if err := syncFunc(syncCtx); err != nil {
					slog.ErrorContext(syncCtx, "delta sync failed", "error", err)
				} else {
					slog.InfoContext(syncCtx, "delta sync completed successfully")
				}
				cancel()

			case <-dss.done:
				slog.InfoContext(ctx, "delta sync scheduler stopped")
				return

			case <-ctx.Done():
				slog.InfoContext(ctx, "delta sync scheduler context cancelled")
				return
			}
		}
	}()
}

func (dss *DeltaSyncScheduler) Stop() error {
	if dss.ticker != nil {
		dss.ticker.Stop()
	}
	close(dss.done)
	return nil
}

type SyncJobStatus struct {
	LastRun      time.Time
	NextRun      time.Time
	IsRunning    bool
	LastError    string
	SuccessCount int64
	FailureCount int64
}

func (dss *DeltaSyncScheduler) GetStatus() *SyncJobStatus {
	return &SyncJobStatus{
		NextRun:   time.Now().Add(dss.interval),
		IsRunning: false,
	}
}
