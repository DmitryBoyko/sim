package repository

import (
	"context"
	"sim/internal/domain"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OperationalRepository handles operational_data and data_history.
type OperationalRepository struct {
	pool *pgxpool.Pool
}

// NewOperationalRepository creates OperationalRepository.
func NewOperationalRepository(pool *pgxpool.Pool) *OperationalRepository {
	return &OperationalRepository{pool: pool}
}

// Insert appends one data point.
func (r *OperationalRepository) Insert(ctx context.Context, p *domain.DataPoint) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO operational_data (ts, speed, weight, phase) VALUES ($1, $2, $3, $4)`,
		p.T, p.Speed, p.Weight, p.Phase)
	return err
}

// LastMinutes returns points for the last N minutes.
func (r *OperationalRepository) LastMinutes(ctx context.Context, minutes int) ([]domain.DataPoint, error) {
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)
	rows, err := r.pool.Query(ctx,
		`SELECT ts, speed, weight, phase FROM operational_data WHERE ts >= $1 ORDER BY ts`,
		since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DataPoint
	for rows.Next() {
		var p domain.DataPoint
		if err := rows.Scan(&p.T, &p.Speed, &p.Weight, &p.Phase); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Clear removes all operational data.
func (r *OperationalRepository) Clear(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM operational_data`)
	return err
}

// CountSince returns the number of points in operational_data with ts >= since.
func (r *OperationalRepository) CountSince(ctx context.Context, since time.Time) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM operational_data WHERE ts >= $1`, since).Scan(&n)
	return n, err
}

// History returns data for time range (for history tab).
func (r *OperationalRepository) History(ctx context.Context, from, to time.Time) ([]domain.DataPoint, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT ts, speed, weight, phase FROM operational_data WHERE ts >= $1 AND ts <= $2 ORDER BY ts`,
		from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DataPoint
	for rows.Next() {
		var p domain.DataPoint
		if err := rows.Scan(&p.T, &p.Speed, &p.Weight, &p.Phase); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
