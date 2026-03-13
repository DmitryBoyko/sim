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

// List returns detected trips in time range (with payload_ton).
func (r *TripsRepository) List(ctx context.Context, from, to *time.Time, limit int) ([]domain.DetectedTrip, error) {
	q := `
		SELECT dt.id, dt.started_at, dt.ended_at, dt.template_id,
		       COALESCE(NULLIF(TRIM(dt.template_name), ''), t.name, 'не найден'),
		       dt.match_threshold_percent, dt.match_percent, dt.payload_ton, dt.phases, dt.created_at,
		       tp.avg_weight_ton
		FROM detected_trips dt
		LEFT JOIN trip_templates t ON t.id = dt.template_id
		LEFT JOIN trip_phases tp ON tp.trip_id = dt.id AND tp.phase_type = 'transport'
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
		var payloadTonVal *float64
		var transportAvgWeightTon *float64
		if err := rows.Scan(&tr.ID, &tr.StartedAt, &tr.EndedAt, &tr.TemplateID, &templateNameVal, &matchThresholdVal, &tr.MatchPercent, &payloadTonVal, &phasesRaw, &tr.CreatedAt, &transportAvgWeightTon); err != nil {
			return nil, err
		}
		if templateNameVal != nil && *templateNameVal != "" {
			tr.TemplateName = *templateNameVal
		} else {
			tr.TemplateName = "не найден"
		}
		tr.MatchThresholdPercent = matchThresholdVal
		tr.PayloadTon = payloadTonVal
		tr.TransportAvgWeightTon = transportAvgWeightTon
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
// trip_phases удаляются каскадно (ON DELETE CASCADE).
func (r *TripsRepository) DeleteInRange(ctx context.Context, from, to time.Time) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM detected_trips WHERE started_at <= $1 AND ended_at >= $2`,
		to, from)
	return err
}

// UpdatePayloadAndPhases обновляет payload_ton рейса и записывает фазы (предварительно удаляя старые).
func (r *TripsRepository) UpdatePayloadAndPhases(ctx context.Context, tripID string, payloadTon float64, phases []domain.TripPhase) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE detected_trips SET payload_ton = $1 WHERE id = $2`, payloadTon, tripID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM trip_phases WHERE trip_id = $1`, tripID)
	if err != nil {
		return err
	}
	for _, ph := range phases {
		_, err = tx.Exec(ctx, `
			INSERT INTO trip_phases (trip_id, phase_type, started_at, ended_at, duration_sec, avg_speed_kmh, avg_weight_ton, point_count, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			tripID, ph.PhaseType, ph.StartedAt, ph.EndedAt, ph.DurationSec, ph.AvgSpeedKmh, ph.AvgWeightTon, ph.PointCount, ph.SortOrder)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GetPhasesByTripID возвращает фазы рейса по ID, отсортированные по sort_order.
func (r *TripsRepository) GetPhasesByTripID(ctx context.Context, tripID string) ([]domain.TripPhase, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT phase_type, started_at, ended_at, duration_sec, avg_speed_kmh, avg_weight_ton, point_count, sort_order
		FROM trip_phases WHERE trip_id = $1 ORDER BY sort_order`,
		tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TripPhase
	for rows.Next() {
		var ph domain.TripPhase
		if err := rows.Scan(&ph.PhaseType, &ph.StartedAt, &ph.EndedAt, &ph.DurationSec, &ph.AvgSpeedKmh, &ph.AvgWeightTon, &ph.PointCount, &ph.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, ph)
	}
	return out, rows.Err()
}

// GetByID возвращает рейс по ID (для проверки существования и payload_ton).
func (r *TripsRepository) GetByID(ctx context.Context, tripID string) (*domain.DetectedTrip, error) {
	var tr domain.DetectedTrip
	var templateNameVal *string
	var matchThresholdVal *float64
	var payloadTonVal *float64
	var phasesRaw []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, started_at, ended_at, template_id,
		       COALESCE(NULLIF(TRIM(template_name), ''), (SELECT name FROM trip_templates WHERE id = detected_trips.template_id), 'не найден'),
		       match_threshold_percent, match_percent, payload_ton, phases, created_at
		FROM detected_trips WHERE id = $1`, tripID).
		Scan(&tr.ID, &tr.StartedAt, &tr.EndedAt, &tr.TemplateID, &templateNameVal, &matchThresholdVal, &tr.MatchPercent, &payloadTonVal, &phasesRaw, &tr.CreatedAt)
	if err != nil {
		return nil, err
	}
	if templateNameVal != nil {
		tr.TemplateName = *templateNameVal
	} else {
		tr.TemplateName = "не найден"
	}
	tr.MatchThresholdPercent = matchThresholdVal
	tr.PayloadTon = payloadTonVal
	_ = json.Unmarshal(phasesRaw, &tr.Phases)
	return &tr, nil
}
