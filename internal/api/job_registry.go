package api

import (
	"context"
	"sync"
)

// JobRegistry holds cancel functions for running jobs so they can be cancelled by ID.
type JobRegistry struct {
	mu     sync.Mutex
	cancel map[string]context.CancelFunc
}

// NewJobRegistry creates a new job registry.
func NewJobRegistry() *JobRegistry {
	return &JobRegistry{cancel: make(map[string]context.CancelFunc)}
}

// Register creates a cancelable context for the job and stores the cancel function.
// Caller must call the returned cancel when the job finishes (e.g. defer) so the registry is cleaned.
func (r *JobRegistry) Register(jobID string) (ctx context.Context, cancel context.CancelFunc) {
	ctx, cancel = context.WithCancel(context.Background())
	r.mu.Lock()
	r.cancel[jobID] = cancel
	r.mu.Unlock()
	return ctx, cancel
}

// GetCancel returns the cancel function for the job if present.
func (r *JobRegistry) GetCancel(jobID string) context.CancelFunc {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cancel[jobID]
}

// Remove removes the job's cancel function (idempotent).
func (r *JobRegistry) Remove(jobID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.cancel, jobID)
}

// CancelAndRemove calls the job's cancel function and removes it from the registry.
// Returns true if the job was found and cancelled.
func (r *JobRegistry) CancelAndRemove(jobID string) bool {
	r.mu.Lock()
	cancel := r.cancel[jobID]
	delete(r.cancel, jobID)
	r.mu.Unlock()
	if cancel != nil {
		cancel()
		return true
	}
	return false
}
