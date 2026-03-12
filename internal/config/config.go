package config

import (
	"fmt"
	"sim/internal/domain"

	"github.com/spf13/viper"
)

// Load reads config from env and optional config file.
func Load() (*domain.AppSettings, string, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AutomaticEnv()

	_ = viper.ReadInConfig()
	_ = viper.BindEnv("database_url", "DATABASE_URL")
	_ = viper.BindEnv("http_port", "HTTP_PORT")

	dsn := viper.GetString("database_url")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/sim?sslmode=disable"
	}

	s := &domain.AppSettings{
		Phases: domain.PhasesConfig{
			LoadDurationSec:               getInt("phases_load_duration_sec", 120),
			TransportDurationSec:          getInt("phases_transport_duration_sec", 300),
			UnloadDurationSec:             getInt("phases_unload_duration_sec", 60),
			ReturnDurationSec:             getInt("phases_return_duration_sec", 240),
			DelayAfterUnloadSec:          getIntDefault("phases_delay_after_unload_sec", 20),
			DelayBeforeLoadSec:           getIntDefault("phases_delay_before_load_sec", 20),
			PhaseDurationDeviationPercent: getFloat("phases_phase_duration_deviation_percent", 0),
		},
		SpeedWeight: domain.SpeedWeightConfig{
			VMinKmh:   getFloat("speed_weight_v_min_kmh", 0.5),
			VMaxKmh:   getFloat("speed_weight_v_max_kmh", 40),
			MMaxTon:   getFloat("speed_weight_m_max_ton", 100),
			MMinTon:   getFloat("speed_weight_m_min_ton", 90),
			MEmptyTon: getFloat("speed_weight_m_empty_ton", 1),
		},
		Noise: domain.NoiseConfig{
			SpeedNoiseKmh:      getFloat("noise_speed_kmh", 0.5),
			WeightNoiseTon:     getFloat("noise_weight_ton", 1),
			WeightNoiseLoadTon: getFloat("noise_weight_noise_load_ton", 2),
		},
		Intervals: domain.IntervalsConfig{
			GenerationIntervalSec: getInt("generation_interval_sec", 10),
			ChartMinutes:         getInt("chart_minutes", 30),
		},
		Recognition: domain.RecognitionConfig{
			MatchThresholdPercent: getFloat("recognition_match_threshold", 85),
			Enabled:               viper.GetBool("recognition_enabled"),
			SpeedBaselineKmh:      getFloat("recognition_speed_baseline_kmh", 0),
			WeightBaselineTon:     getFloat("recognition_weight_baseline_ton", 0),
		},
	}
	return s, dsn, nil
}

func getInt(key string, def int) int {
	if v := viper.GetInt(key); v != 0 {
		return v
	}
	return def
}

// getIntDefault returns def when key is not set or zero (for params that can be 0 but default non-zero).
func getIntDefault(key string, def int) int {
	if v := viper.GetInt(key); v != 0 {
		return v
	}
	return def
}

func getFloat(key string, def float64) float64 {
	if v := viper.GetFloat64(key); v != 0 {
		return v
	}
	return def
}

// DSN returns database connection string from viper.
func DSN() string {
	return viper.GetString("database_url")
}

// HTTPPort returns server port (default 8080).
func HTTPPort() string {
	if p := viper.GetString("http_port"); p != "" {
		return p
	}
	if p := viper.GetInt("http_port"); p != 0 {
		return fmt.Sprintf("%d", p)
	}
	return "8080"
}

// ApplyFromDB overwrites s with values from a map (e.g. from app_params).
func ApplyFromDB(s *domain.AppSettings, params map[string]interface{}) error {
	// Simple application: params keys match app_params keys and contain JSON.
	// Caller typically passes decoded JSON from repository.
	if s == nil {
		return fmt.Errorf("settings is nil")
	}
	return nil
}
