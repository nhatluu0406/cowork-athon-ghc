package scheduler

import (
	"context"
	"log/slog"
	"time"
)

type ReevaluatorScheduler struct {
	interval time.Duration
	ticker   *time.Ticker
	done     chan struct{}
}

func NewReevaluatorScheduler(interval time.Duration) *ReevaluatorScheduler {
	return &ReevaluatorScheduler{
		interval: interval,
		done:     make(chan struct{}),
	}
}

func (rs *ReevaluatorScheduler) Start(ctx context.Context, evalFunc func(context.Context) error) {
	rs.ticker = time.NewTicker(rs.interval)

	go func() {
		slog.InfoContext(ctx, "reevaluator scheduler started", "interval", rs.interval)

		for {
			select {
			case <-rs.ticker.C:
				evalCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
				if err := evalFunc(evalCtx); err != nil {
					slog.ErrorContext(evalCtx, "reevaluation failed", "error", err)
				} else {
					slog.InfoContext(evalCtx, "reevaluation cycle completed")
				}
				cancel()

			case <-rs.done:
				slog.InfoContext(ctx, "reevaluator scheduler stopped")
				return

			case <-ctx.Done():
				slog.InfoContext(ctx, "reevaluator scheduler context cancelled")
				return
			}
		}
	}()
}

func (rs *ReevaluatorScheduler) Stop() error {
	if rs.ticker != nil {
		rs.ticker.Stop()
	}
	close(rs.done)
	return nil
}

type ReevaluationJobStatus struct {
	LastRun             time.Time
	NextRun             time.Time
	IsRunning           bool
	LastError           string
	CandidatesProcessed int64
	EdgeCount           int64
	SuccessCount        int64
	FailureCount        int64
}

func (rs *ReevaluatorScheduler) GetStatus() *ReevaluationJobStatus {
	return &ReevaluationJobStatus{
		NextRun: time.Now().Add(rs.interval),
	}
}
