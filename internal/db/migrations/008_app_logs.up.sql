-- Application logs (backend stdout + frontend) for viewing in UI.
-- Message length limited in app; payload for optional structured data.
CREATE TABLE IF NOT EXISTS app_logs (
    id         BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source     TEXT NOT NULL CHECK (source IN ('backend', 'frontend')),
    level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    message    TEXT NOT NULL,
    payload    JSONB
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_source_created_at ON app_logs(source, created_at);
