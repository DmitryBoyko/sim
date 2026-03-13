package repository

import (
	"context"
	"encoding/json"
	"sim/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ParamsRepository reads/writes app_params.
type ParamsRepository struct {
	pool *pgxpool.Pool
}

// NewParamsRepository creates ParamsRepository.
func NewParamsRepository(pool *pgxpool.Pool) *ParamsRepository {
	return &ParamsRepository{pool: pool}
}

// GetSettings loads all app params and builds AppSettings.
func (r *ParamsRepository) GetSettings(ctx context.Context) (*domain.AppSettings, error) {
	rows, err := r.pool.Query(ctx, `SELECT key, value FROM app_params`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	s := &domain.AppSettings{}
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		switch key {
		case "phases":
			_ = json.Unmarshal(raw, &s.Phases)
		case "speed_weight":
			_ = json.Unmarshal(raw, &s.SpeedWeight)
		case "noise":
			_ = json.Unmarshal(raw, &s.Noise)
		case "intervals":
			_ = json.Unmarshal(raw, &s.Intervals)
		case "recognition":
			_ = json.Unmarshal(raw, &s.Recognition)
		case "analysis":
			_ = json.Unmarshal(raw, &s.Analysis)
		}
	}
	// Defaults for analysis if missing
	if s.Analysis.PlateauHalfWindow == 0 {
		s.Analysis.PlateauHalfWindow = 3
	}
	if s.Analysis.PlateauNoiseToleranceTon == 0 {
		s.Analysis.PlateauNoiseToleranceTon = 4
	}
	if s.Analysis.PayloadThresholdTon == 0 {
		s.Analysis.PayloadThresholdTon = 20
	}
	if s.Analysis.MinPhasePoints == 0 {
		s.Analysis.MinPhasePoints = 2
	}
	// Defaults for new analysis options
	if !s.Analysis.PlateauGapClosingEnabled {
		s.Analysis.PlateauGapClosingEnabled = true
	}
	if s.Analysis.PlateauMaxGapPoints == 0 {
		s.Analysis.PlateauMaxGapPoints = 5
	}
	return s, rows.Err()
}

// SaveSettings persists all app params. phases сохраняется целиком (включая delay_after_unload_sec, delay_before_load_sec и phase_duration_deviation_percent).
func (r *ParamsRepository) SaveSettings(ctx context.Context, s *domain.AppSettings) error {
	keys := []string{"phases", "speed_weight", "noise", "intervals", "recognition", "analysis"}
	values := []interface{}{
		mustJSON(s.Phases),
		mustJSON(s.SpeedWeight),
		mustJSON(s.Noise),
		mustJSON(s.Intervals),
		mustJSON(s.Recognition),
		mustJSON(s.Analysis),
	}
	for i, key := range keys {
		_, err := r.pool.Exec(ctx, `INSERT INTO app_params (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, key, values[i])
		if err != nil {
			return err
		}
	}
	return nil
}

func mustJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}
