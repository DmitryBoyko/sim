package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JobStatus values for background_jobs.status.
const (
	JobStatusPending   = "pending"
	JobStatusRunning   = "running"
	JobStatusCompleted = "completed"
	JobStatusFailed    = "failed"
	JobStatusCancelled = "cancelled"
)

// JobKind identifies the type of background job.
const (
	JobKindRecalculateTrips = "recalculate_trips"
)

// BackgroundJob represents a row in background_jobs.
type BackgroundJob struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Status         string          `json:"status"`
	ProgressPct    float64         `json:"progress_pct"`
	TotalItems     int64           `json:"total_items"`
	ProcessedItems int64           `json:"processed_items"`
	StartedAt      *time.Time      `json:"started_at,omitempty"`
	FinishedAt     *time.Time      `json:"finished_at,omitempty"`
	ErrorMessage   *string         `json:"error_message,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
}

// JobsRepository handles background_jobs.
type JobsRepository struct {
	pool *pgxpool.Pool
}

// NewJobsRepository creates JobsRepository.
func NewJobsRepository(pool *pgxpool.Pool) *JobsRepository {
	return &JobsRepository{pool: pool}
}

// Create inserts a new job with status pending and returns its ID.
func (r *JobsRepository) Create(ctx context.Context, kind string, payload interface{}) (string, error) {
	payloadJSON, _ := json.Marshal(payload)
	id := uuid.New().String()
	_, err := r.pool.Exec(ctx,
		`INSERT INTO background_jobs (id, kind, status, payload) VALUES ($1, $2, $3, $4)`,
		id, kind, JobStatusPending, payloadJSON)
	return id, err
}

// GetByID returns a job by ID, or nil if not found.
func (r *JobsRepository) GetByID(ctx context.Context, id string) (*BackgroundJob, error) {
	var j BackgroundJob
	var startedAt, finishedAt *time.Time
	var errMsg *string
	var payload []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, kind, status, progress_pct, total_items, processed_items,
		       started_at, finished_at, error_message, payload, created_at
		FROM background_jobs WHERE id = $1
	`, id).Scan(&j.ID, &j.Kind, &j.Status, &j.ProgressPct, &j.TotalItems, &j.ProcessedItems,
		&startedAt, &finishedAt, &errMsg, &payload, &j.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	j.StartedAt = startedAt
	j.FinishedAt = finishedAt
	j.ErrorMessage = errMsg
	if len(payload) > 0 {
		j.Payload = payload
	}
	return &j, nil
}

// GetActiveByKind returns the single running or pending job of the given kind, if any.
func (r *JobsRepository) GetActiveByKind(ctx context.Context, kind string) (*BackgroundJob, error) {
	var j BackgroundJob
	var startedAt, finishedAt *time.Time
	var errMsg *string
	var payload []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, kind, status, progress_pct, total_items, processed_items,
		       started_at, finished_at, error_message, payload, created_at
		FROM background_jobs
		WHERE kind = $1 AND status IN ('pending', 'running')
		ORDER BY created_at DESC
		LIMIT 1
	`, kind).Scan(&j.ID, &j.Kind, &j.Status, &j.ProgressPct, &j.TotalItems, &j.ProcessedItems,
		&startedAt, &finishedAt, &errMsg, &payload, &j.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	j.StartedAt = startedAt
	j.FinishedAt = finishedAt
	j.ErrorMessage = errMsg
	if len(payload) > 0 {
		j.Payload = payload
	}
	return &j, nil
}

// Start sets status to running and started_at to now.
func (r *JobsRepository) Start(ctx context.Context, id string, totalItems int64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE background_jobs SET status = $1, started_at = NOW(), total_items = $2
		WHERE id = $3
	`, JobStatusRunning, totalItems, id)
	return err
}

// UpdateProgress sets processed_items and progress_pct.
func (r *JobsRepository) UpdateProgress(ctx context.Context, id string, processed int64, progressPct float64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE background_jobs SET processed_items = $1, progress_pct = $2 WHERE id = $3
	`, processed, progressPct, id)
	return err
}

// Complete sets status to completed and finished_at to now.
func (r *JobsRepository) Complete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE background_jobs SET status = $1, finished_at = NOW(), progress_pct = 100
		WHERE id = $2
	`, JobStatusCompleted, id)
	return err
}

// Fail sets status to failed, finished_at and error_message.
func (r *JobsRepository) Fail(ctx context.Context, id string, errMsg string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE background_jobs SET status = $1, finished_at = NOW(), error_message = $2
		WHERE id = $3
	`, JobStatusFailed, errMsg, id)
	return err
}

// Cancel sets status to cancelled and finished_at (only if still pending or running).
func (r *JobsRepository) Cancel(ctx context.Context, id string, errMsg string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE background_jobs SET status = $1, finished_at = NOW(), error_message = $2
		WHERE id = $3 AND status IN ('pending', 'running')
	`, JobStatusCancelled, errMsg, id)
	return err
}

// Delete removes a job by ID. Only jobs with status completed are allowed to be deleted (optional: extend to failed/cancelled).
func (r *JobsRepository) Delete(ctx context.Context, id string) error {
	result, err := r.pool.Exec(ctx, `DELETE FROM background_jobs WHERE id = $1 AND status = $2`, id, JobStatusCompleted)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// DeleteByStatus removes all jobs with the given status. Returns the number of deleted rows.
func (r *JobsRepository) DeleteByStatus(ctx context.Context, status string) (int64, error) {
	result, err := r.pool.Exec(ctx, `DELETE FROM background_jobs WHERE status = $1`, status)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// CountActive returns the number of jobs with status pending or running.
func (r *JobsRepository) CountActive(ctx context.Context) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM background_jobs WHERE status IN ($1, $2)`,
		JobStatusPending, JobStatusRunning).Scan(&n)
	return n, err
}

// List returns jobs, optionally filtered by statuses. Order: created_at DESC. Limit applied.
func (r *JobsRepository) List(ctx context.Context, statuses []string, limit int) ([]BackgroundJob, error) {
	if limit <= 0 {
		limit = 50
	}
	var q string
	var args []interface{}
	if len(statuses) > 0 {
		placeholders := make([]string, len(statuses))
		for i := range statuses {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
		}
		args = make([]interface{}, 0, len(statuses)+1)
		for _, s := range statuses {
			args = append(args, s)
		}
		args = append(args, limit)
		q = `SELECT id, kind, status, progress_pct, total_items, processed_items,
		     started_at, finished_at, error_message, payload, created_at
		     FROM background_jobs WHERE status IN (` + strings.Join(placeholders, ",") + `)
		     ORDER BY created_at DESC LIMIT $` + fmt.Sprint(len(args))
	} else {
		args = []interface{}{limit}
		q = `SELECT id, kind, status, progress_pct, total_items, processed_items,
		     started_at, finished_at, error_message, payload, created_at
		     FROM background_jobs ORDER BY created_at DESC LIMIT $1`
	}
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BackgroundJob
	for rows.Next() {
		var j BackgroundJob
		var startedAt, finishedAt *time.Time
		var errMsg *string
		var payload []byte
		if err := rows.Scan(&j.ID, &j.Kind, &j.Status, &j.ProgressPct, &j.TotalItems, &j.ProcessedItems,
			&startedAt, &finishedAt, &errMsg, &payload, &j.CreatedAt); err != nil {
			return nil, err
		}
		j.StartedAt = startedAt
		j.FinishedAt = finishedAt
		j.ErrorMessage = errMsg
		if len(payload) > 0 {
			j.Payload = payload
		}
		out = append(out, j)
	}
	if out == nil {
		out = []BackgroundJob{}
	}
	return out, rows.Err()
}
