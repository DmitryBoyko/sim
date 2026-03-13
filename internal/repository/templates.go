package repository

import (
	"context"
	"encoding/json"
	"sim/internal/domain"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TemplatesRepository handles trip_templates and trip_template_vectors.
type TemplatesRepository struct {
	pool *pgxpool.Pool
}

// NewTemplatesRepository creates TemplatesRepository.
func NewTemplatesRepository(pool *pgxpool.Pool) *TemplatesRepository {
	return &TemplatesRepository{pool: pool}
}

// Create saves a template with its vector and zvector.
func (r *TemplatesRepository) Create(ctx context.Context, name string, rawSpeed, rawWeight []float64, rawTS []time.Time, vector, zvector []float64) (string, error) {
	id := uuid.New().String()
	speedJSON, _ := json.Marshal(rawSpeed)
	weightJSON, _ := json.Marshal(rawWeight)
	tsJSON, _ := json.Marshal(rawTS)
	var intervalStart, intervalEnd *time.Time
	if len(rawTS) > 0 {
		start := rawTS[0]
		end := rawTS[len(rawTS)-1]
		intervalStart = &start
		intervalEnd = &end
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO trip_templates (id, name, speed_count, weight_count, raw_speed, raw_weight, raw_ts, interval_start, interval_end)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, name, len(rawSpeed), len(rawWeight), speedJSON, weightJSON, tsJSON, intervalStart, intervalEnd)
	if err != nil {
		return "", err
	}
	vecJSON, _ := json.Marshal(vector)
	var zvecJSON []byte
	if len(zvector) > 0 {
		zvecJSON, _ = json.Marshal(zvector)
	}
	_, err = r.pool.Exec(ctx, `INSERT INTO trip_template_vectors (template_id, vector, zvector) VALUES ($1, $2, $3)`, id, vecJSON, zvecJSON)
	if err != nil {
		return "", err
	}
	return id, nil
}

// ListWithVectors returns all templates with vector and zvector for recognition.
func (r *TemplatesRepository) ListWithVectors(ctx context.Context) ([]domain.TripTemplateWithVector, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id, t.name, t.created_at, t.speed_count, t.weight_count, t.raw_speed, t.raw_weight, v.vector, v.zvector
		FROM trip_templates t
		JOIN trip_template_vectors v ON v.template_id = t.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TripTemplateWithVector
	for rows.Next() {
		var t domain.TripTemplateWithVector
		var rawSpeed, rawWeight, rawVec []byte
		var rawZvec []byte
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.SpeedCount, &t.WeightCount, &rawSpeed, &rawWeight, &rawVec, &rawZvec); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(rawSpeed, &t.RawSpeed)
		_ = json.Unmarshal(rawWeight, &t.RawWeight)
		_ = json.Unmarshal(rawVec, &t.Vector)
		if len(rawZvec) > 0 {
			_ = json.Unmarshal(rawZvec, &t.ZVector)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TemplateListItem is template with has_vector for list API.
type TemplateListItem struct {
	domain.TripTemplate
	HasVector bool `json:"has_vector"`
}

// List returns all templates with has_vector flag (no raw arrays).
func (r *TemplatesRepository) List(ctx context.Context) ([]TemplateListItem, error) {
	list, _, err := r.ListWithPagination(ctx, 0, 0)
	return list, err
}

// ListWithPagination returns templates with has_vector, total count, and optional limit/offset.
// If limit is 0, returns all (offset ignored). Otherwise returns at most limit rows from offset.
func (r *TemplatesRepository) ListWithPagination(ctx context.Context, limit, offset int) ([]TemplateListItem, int, error) {
	var total int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM trip_templates`).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	query := `
		SELECT t.id, t.name, t.created_at, t.interval_start, t.interval_end, t.speed_count, t.weight_count,
		       COALESCE(t.raw_ts, '[]'::jsonb) AS raw_ts,
		       (v.template_id IS NOT NULL) AS has_vector
		FROM trip_templates t
		LEFT JOIN trip_template_vectors v ON v.template_id = t.id
		ORDER BY t.created_at DESC
	`
	args := []interface{}{}
	if limit > 0 {
		query += ` LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []TemplateListItem
	for rows.Next() {
		var t TemplateListItem
		var rawTS []byte
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.IntervalStart, &t.IntervalEnd, &t.SpeedCount, &t.WeightCount, &rawTS, &t.HasVector); err != nil {
			return nil, 0, err
		}
		// Если в БД нет границ — извлекаем из raw_ts (старые шаблоны или данные без interval_start/end)
		if t.IntervalStart == nil && len(rawTS) >= 2 {
			var ts []time.Time
			if err := json.Unmarshal(rawTS, &ts); err == nil && len(ts) > 0 {
				start := ts[0]
				end := ts[len(ts)-1]
				t.IntervalStart = &start
				t.IntervalEnd = &end
			}
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// GetByID returns one template with raw data and has_vector.
func (r *TemplatesRepository) GetByID(ctx context.Context, id string) (*domain.TripTemplate, bool, error) {
	var t domain.TripTemplate
	var rawSpeed, rawWeight []byte
	var rawTS []byte
	var hasVector bool
	err := r.pool.QueryRow(ctx, `
		SELECT t.id, t.name, t.created_at, t.interval_start, t.interval_end, t.speed_count, t.weight_count, t.raw_speed, t.raw_weight, COALESCE(t.raw_ts, '[]'::jsonb),
		       (v.template_id IS NOT NULL) AS has_vector
		FROM trip_templates t
		LEFT JOIN trip_template_vectors v ON v.template_id = t.id
		WHERE t.id = $1
	`, id).Scan(&t.ID, &t.Name, &t.CreatedAt, &t.IntervalStart, &t.IntervalEnd, &t.SpeedCount, &t.WeightCount, &rawSpeed, &rawWeight, &rawTS, &hasVector)
	if err != nil {
		return nil, false, err
	}
	_ = json.Unmarshal(rawSpeed, &t.RawSpeed)
	_ = json.Unmarshal(rawWeight, &t.RawWeight)
	_ = json.Unmarshal(rawTS, &t.RawTS)
	return &t, hasVector, nil
}

// BuildVectorsFunc returns both min-max vector and z-vector for a template slice.
type BuildVectorsFunc func(speed, weight []float64) (vector, zvector []float64)

// Update updates name and/or narrows range (from_index, to_index). Range can only be reduced.
func (r *TemplatesRepository) Update(ctx context.Context, id string, name string, fromIndex, toIndex *int, buildVectors BuildVectorsFunc) error {
	if name != "" {
		_, err := r.pool.Exec(ctx, `UPDATE trip_templates SET name = $1 WHERE id = $2`, name, id)
		if err != nil {
			return err
		}
	}
	if fromIndex == nil || toIndex == nil {
		return nil
	}
	from, to := *fromIndex, *toIndex
	if from < 0 || to < from {
		return nil
	}
	var rawSpeed, rawWeight []byte
	var rawTS []byte
	err := r.pool.QueryRow(ctx, `SELECT raw_speed, raw_weight, COALESCE(raw_ts, '[]'::jsonb) FROM trip_templates WHERE id = $1`, id).Scan(&rawSpeed, &rawWeight, &rawTS)
	if err != nil {
		return err
	}
	var speed, weight []float64
	_ = json.Unmarshal(rawSpeed, &speed)
	_ = json.Unmarshal(rawWeight, &weight)
	var ts []time.Time
	_ = json.Unmarshal(rawTS, &ts)
	if to >= len(speed) {
		to = len(speed) - 1
	}
	if to >= len(weight) {
		to = len(weight) - 1
	}
	speed = speed[from : to+1]
	weight = weight[from : to+1]
	if len(ts) > 0 {
		if to >= len(ts) {
			to = len(ts) - 1
		}
		if from >= len(ts) {
			from = 0
		}
		ts = ts[from : to+1]
	}
	vec, zvec := buildVectors(speed, weight)
	speedJSON, _ := json.Marshal(speed)
	weightJSON, _ := json.Marshal(weight)
	vecJSON, _ := json.Marshal(vec)
	var zvecJSON []byte
	if len(zvec) > 0 {
		zvecJSON, _ = json.Marshal(zvec)
	}
	tsJSON, _ := json.Marshal(ts)
	var intervalStart, intervalEnd *time.Time
	if len(ts) > 0 {
		start := ts[0]
		end := ts[len(ts)-1]
		intervalStart = &start
		intervalEnd = &end
	}
	_, err = r.pool.Exec(ctx, `UPDATE trip_templates
		SET speed_count = $1, weight_count = $2, raw_speed = $3, raw_weight = $4, raw_ts = $5, interval_start = $6, interval_end = $7
		WHERE id = $8`,
		len(speed), len(weight), speedJSON, weightJSON, tsJSON, intervalStart, intervalEnd, id)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `UPDATE trip_template_vectors SET vector = $1, zvector = $2 WHERE template_id = $3`, vecJSON, zvecJSON, id)
	return err
}

// Delete removes a template (cascade deletes vector).
func (r *TemplatesRepository) Delete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM trip_templates WHERE id = $1`, id)
	return err
}

// EnsureZVectors computes and saves zvector for all templates where zvector IS NULL (from raw_speed, raw_weight).
// buildZVector(speed, weight) should return the Z-normalized concatenated vector.
func (r *TemplatesRepository) EnsureZVectors(ctx context.Context, buildZVector func(speed, weight []float64) []float64) (int, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id, t.raw_speed, t.raw_weight
		FROM trip_templates t
		JOIN trip_template_vectors v ON v.template_id = t.id
		WHERE v.zvector IS NULL
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var updated int
	for rows.Next() {
		var id string
		var rawSpeed, rawWeight []byte
		if err := rows.Scan(&id, &rawSpeed, &rawWeight); err != nil {
			return updated, err
		}
		var speed, weight []float64
		_ = json.Unmarshal(rawSpeed, &speed)
		_ = json.Unmarshal(rawWeight, &weight)
		zvec := buildZVector(speed, weight)
		if len(zvec) == 0 {
			continue
		}
		zvecJSON, _ := json.Marshal(zvec)
		_, err := r.pool.Exec(ctx, `UPDATE trip_template_vectors SET zvector = $1 WHERE template_id = $2`, zvecJSON, id)
		if err != nil {
			return updated, err
		}
		updated++
	}
	return updated, rows.Err()
}
