-- App parameters (key-value or JSON)
CREATE TABLE IF NOT EXISTS app_params (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operational data points (streaming)
CREATE TABLE IF NOT EXISTS operational_data (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    speed      DOUBLE PRECISION NOT NULL,
    weight     DOUBLE PRECISION NOT NULL,
    phase      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_data_ts ON operational_data(ts);

-- Trip templates (saved segments)
CREATE TABLE IF NOT EXISTS trip_templates (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    speed_count  INT NOT NULL,
    weight_count INT NOT NULL,
    raw_speed    JSONB NOT NULL,
    raw_weight   JSONB NOT NULL
);

-- Template vectors (for recognition)
CREATE TABLE IF NOT EXISTS trip_template_vectors (
    template_id UUID PRIMARY KEY REFERENCES trip_templates(id) ON DELETE CASCADE,
    vector      JSONB NOT NULL
);

-- Detected trips
CREATE TABLE IF NOT EXISTS detected_trips (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ NOT NULL,
    template_id  UUID REFERENCES trip_templates(id) ON DELETE SET NULL,
    match_percent DOUBLE PRECISION NOT NULL,
    phases       JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detected_trips_started ON detected_trips(started_at);

-- History snapshot (optional)
CREATE TABLE IF NOT EXISTS data_history (
    id     BIGSERIAL PRIMARY KEY,
    ts     TIMESTAMPTZ NOT NULL,
    speed  DOUBLE PRECISION NOT NULL,
    weight DOUBLE PRECISION NOT NULL,
    phase  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_history_ts ON data_history(ts);

-- Insert default app params
INSERT INTO app_params (key, value) VALUES
('phases', '{"load_duration_sec":120,"transport_duration_sec":300,"unload_duration_sec":60,"return_duration_sec":240,"delay_after_unload_sec":20,"delay_before_load_sec":20}'::jsonb),
('speed_weight', '{"v_min_kmh":0.5,"v_max_kmh":40,"m_max_ton":100,"m_min_ton":90,"m_empty_ton":1}'::jsonb),
('noise', '{"speed_noise_kmh":0.5,"weight_noise_ton":1,"weight_noise_load_ton":2}'::jsonb),
('intervals', '{"generation_interval_sec":10,"chart_minutes":30}'::jsonb),
('recognition', '{"window_speed_size":100,"window_weight_size":95,"match_threshold_percent":85,"enabled":false,"use_z_normalization":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
