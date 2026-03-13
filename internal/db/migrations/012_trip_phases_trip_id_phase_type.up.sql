-- Индекс для выборки одной фазы по рейсу (например transport) одним запросом списка рейсов.
CREATE INDEX IF NOT EXISTS idx_trip_phases_trip_id_phase_type ON trip_phases(trip_id, phase_type);
