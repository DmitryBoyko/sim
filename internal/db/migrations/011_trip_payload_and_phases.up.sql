-- Вес перевезённого груза по рейсу (вычисляется после детекции).
ALTER TABLE detected_trips ADD COLUMN IF NOT EXISTS payload_ton DOUBLE PRECISION;

-- Фазы рейса (погрузка, транспортировка, разгрузка, возврат) по анализу плато веса.
CREATE TABLE IF NOT EXISTS trip_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES detected_trips(id) ON DELETE CASCADE,
  phase_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_sec INT NOT NULL,
  avg_speed_kmh DOUBLE PRECISION,
  avg_weight_ton DOUBLE PRECISION,
  point_count INT,
  sort_order INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_phases_trip_id ON trip_phases(trip_id);

-- Допустимые значения phase_type: loading, transport, unloading, return
-- (проверка на уровне приложения)

-- Настройки анализа по умолчанию (если ещё нет)
INSERT INTO app_params (key, value) VALUES
  ('analysis', '{"plateau_half_window":3,"plateau_noise_tolerance_ton":4,"payload_threshold_ton":20,"min_phase_points":2}'::jsonb)
ON CONFLICT (key) DO NOTHING;
