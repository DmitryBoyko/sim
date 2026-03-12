-- Add interval and timestamps storage for templates
ALTER TABLE trip_templates
    ADD COLUMN IF NOT EXISTS interval_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS interval_end   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS raw_ts         JSONB;

