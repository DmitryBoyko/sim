-- Universal table for long-running background jobs (recalculate trips, future jobs).
-- Progress is stored so frontend can poll and show %; survives server restart.
CREATE TABLE IF NOT EXISTS background_jobs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    progress_pct    DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_items    BIGINT NOT NULL DEFAULT 0,
    processed_items BIGINT NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    error_message  TEXT,
    payload        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_kind_status ON background_jobs(kind, status);
