package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sim/internal/domain"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func fmtPlaceholder(n int) string { return fmt.Sprint(n) }

// TripsRepository handles detected_trips.
type TripsRepository struct {
	pool *pgxpool.Pool
}

// NewTripsRepository creates TripsRepository.
func NewTripsRepository(pool *pgxpool.Pool) *TripsRepository {
	return &TripsRepository{pool: pool}
}

// Create saves a detected trip (с именем шаблона и порогом для понимания, по какому шаблону и с каким порогом найден).
func (r *TripsRepository) Create(ctx context.Context, startedAt, endedAt time.Time, templateID *string, templateName string, matchPercent, matchThresholdPercent float64, phases []domain.PhaseSpan) (string, error) {
	phasesJSON, _ := json.Marshal(phases)
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO detected_trips (started_at, ended_at, template_id, template_name, match_percent, match_threshold_percent, phases)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, startedAt, endedAt, templateID, templateName, matchPercent, matchThresholdPercent, phasesJSON).Scan(&id)
	return id, err
}

// List returns detected trips in time range.
func (r *TripsRepository) List(ctx context.Context, from, to *time.Time, limit int) ([]domain.DetectedTrip, error) {
	q := `
		SELECT dt.id, dt.started_at, dt.ended_at, dt.template_id,
		       COALESCE(NULLIF(TRIM(dt.template_name), ''), t.name, 'не найден'),
		       dt.match_threshold_percent, dt.match_percent, dt.phases, dt.created_at
		FROM detected_trips dt
		LEFT JOIN trip_templates t ON t.id = dt.template_id
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1
	if from != nil {
		q += ` AND dt.started_at >= $` + fmtPlaceholder(argNum)
		args = append(args, *from)
		argNum++
	}
	if to != nil {
		q += ` AND dt.ended_at <= $` + fmtPlaceholder(argNum)
		args = append(args, *to)
		argNum++
	}
	q += ` ORDER BY dt.started_at DESC`
	if limit > 0 {
		q += ` LIMIT $` + fmtPlaceholder(argNum)
		args = append(args, limit)
	}
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DetectedTrip
	for rows.Next() {
		var tr domain.DetectedTrip
		var phasesRaw []byte
		var templateNameVal *string
		var matchThresholdVal *float64
		if err := rows.Scan(&tr.ID, &tr.StartedAt, &tr.EndedAt, &tr.TemplateID, &templateNameVal, &matchThresholdVal, &tr.MatchPercent, &phasesRaw, &tr.CreatedAt); err != nil {
			return nil, err
		}
		if templateNameVal != nil && *templateNameVal != "" {
			tr.TemplateName = *templateNameVal
		} else {
			tr.TemplateName = "не найден"
		}
		tr.MatchThresholdPercent = matchThresholdVal
		_ = json.Unmarshal(phasesRaw, &tr.Phases)
		out = append(out, tr)
	}
	return out, rows.Err()
}

// DeleteAll removes all detected trips.
func (r *TripsRepository) DeleteAll(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM detected_trips`)
	return err
}

// CountSince returns the number of detected_trips with created_at >= since.
func (r *TripsRepository) CountSince(ctx context.Context, since time.Time) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM detected_trips WHERE created_at >= $1`, since).Scan(&n)
	return n, err
}

// LastCreatedAt returns the most recent created_at from detected_trips, or nil if none.
func (r *TripsRepository) LastCreatedAt(ctx context.Context) (*time.Time, error) {
	var t time.Time
	err := r.pool.QueryRow(ctx, `SELECT created_at FROM detected_trips ORDER BY created_at DESC LIMIT 1`).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// DeleteInRange removes trips that overlap [from, to] (started_at <= to AND ended_at >= from).
func (r *TripsRepository) DeleteInRange(ctx context.Context, from, to time.Time) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM detected_trips WHERE started_at <= $1 AND ended_at >= $2`,
		to, from)
	return err
}
