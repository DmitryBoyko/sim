-- Оптимизация: индексы по запросам из репозиториев.
-- detected_trips: CountSince(created_at >= ?), LastCreatedAt(ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_detected_trips_created_at ON detected_trips(created_at DESC);

-- background_jobs: List() без фильтра по status — ORDER BY created_at DESC LIMIT
CREATE INDEX IF NOT EXISTS idx_background_jobs_created_at ON background_jobs(created_at DESC);

-- trip_templates: List ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_trip_templates_created_at ON trip_templates(created_at DESC);
