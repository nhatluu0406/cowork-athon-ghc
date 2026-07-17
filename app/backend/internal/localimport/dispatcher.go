package localimport

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"
)

// Dispatcher manages a queue of import jobs and distributes them to worker goroutines.
type Dispatcher struct {
	queue       chan *ImportJob
	workers     int
	processor   *Processor
	jobStore    *ImportJobStore
	logger      *slog.Logger
	mu          sync.Mutex
	wg          sync.WaitGroup
	stop        chan struct{}
	running     bool
}

// NewDispatcher creates a new Dispatcher with a bounded queue and worker pool.
func NewDispatcher(processor *Processor, jobStore *ImportJobStore, logger *slog.Logger) *Dispatcher {
	workers := runtime.GOMAXPROCS(0)
	if workers > 4 {
		workers = 4
	}
	if workers < 1 {
		workers = 1
	}

	return &Dispatcher{
		queue:     make(chan *ImportJob, 100),
		workers:   workers,
		processor: processor,
		jobStore:  jobStore,
		logger:    logger,
		stop:      make(chan struct{}),
	}
}

// Start launches the worker goroutines.
func (d *Dispatcher) Start(ctx context.Context) {
	d.mu.Lock()
	if d.running {
		d.mu.Unlock()
		return
	}
	d.running = true
	d.mu.Unlock()

	for i := 0; i < d.workers; i++ {
		d.wg.Add(1)
		go d.workerLoop(ctx, i)
	}
}

// Stop shuts down the dispatcher.
func (d *Dispatcher) Stop() {
	d.mu.Lock()
	if !d.running {
		d.mu.Unlock()
		return
	}
	d.running = false
	d.mu.Unlock()

	close(d.stop)
	d.wg.Wait()
}

// Enqueue adds a job to the queue, returning error if queue is full.
func (d *Dispatcher) Enqueue(job *ImportJob) error {
	select {
	case d.queue <- job:
		return nil
	case <-d.stop:
		return fmt.Errorf("dispatcher is stopped")
	default:
		return fmt.Errorf("job queue is full")
	}
}

// MarkStaleJobs marks any running jobs as stale (for startup cleanup).
func (d *Dispatcher) MarkStaleJobs(ctx context.Context) error {
	return d.jobStore.MarkStaleJobs(ctx)
}

// workerLoop processes jobs from the queue.
func (d *Dispatcher) workerLoop(ctx context.Context, workerID int) {
	defer d.wg.Done()

	for {
		select {
		case <-d.stop:
			d.logger.Info("worker stopped", "worker_id", workerID)
			return
		case job := <-d.queue:
			if job == nil {
				return
			}
			d.processJob(ctx, job, workerID)
		}
	}
}

// processJob executes an import job.
func (d *Dispatcher) processJob(ctx context.Context, job *ImportJob, workerID int) {
	d.logger.Info("job processing started", "job_id", job.ID, "worker_id", workerID)
	startTime := time.Now()

	// Create a timeout context for the job (no hardcoded timeout for MVP; can add later)
	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	err := d.processor.Run(jobCtx, job)
	if err != nil {
		d.logger.Error("job processing failed", "job_id", job.ID, "error", err)
		if err := d.jobStore.UpdateStatus(ctx, job.ID, JobFailed); err != nil {
			d.logger.Error("failed to mark job failed", "error", err, "job_id", job.ID)
		}
	} else {
		d.logger.Info("job processing completed", "job_id", job.ID, "duration", time.Since(startTime))
	}
}
