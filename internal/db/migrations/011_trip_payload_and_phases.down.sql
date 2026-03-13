DROP INDEX IF EXISTS idx_trip_phases_trip_id;
DROP TABLE IF EXISTS trip_phases;
ALTER TABLE detected_trips DROP COLUMN IF EXISTS payload_ton;
