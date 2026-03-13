package db

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// NewPool creates a pgx connection pool.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("new pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

// MigrateUp runs embedded up migrations in order (001, 002, ...).
func MigrateUp(ctx context.Context, pool *pgxpool.Pool) error {
	for _, name := range []string{
		"migrations/001_init_schema.up.sql",
		"migrations/002_phase_delays_and_load_noise.up.sql",
		"migrations/003_templates_interval.up.sql",
		"migrations/004_detected_trips_template_name.up.sql",
		"migrations/005_detected_trips_match_threshold.up.sql",
		"migrations/006_phase_duration_deviation.up.sql",
		"migrations/007_background_jobs.up.sql",
		"migrations/008_app_logs.up.sql",
		"migrations/009_indexes_optimization.up.sql",
		"migrations/010_trip_template_vectors_zvector.up.sql",
		"migrations/011_trip_payload_and_phases.up.sql",
		"migrations/012_trip_phases_trip_id_phase_type.up.sql",
	} {
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		if _, err = pool.Exec(ctx, string(body)); err != nil {
			return err
		}
	}
	return nil
}
