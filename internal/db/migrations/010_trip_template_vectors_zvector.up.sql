-- Z-нормализованный вектор для альтернативного режима распознавания.
ALTER TABLE trip_template_vectors ADD COLUMN IF NOT EXISTS zvector JSONB;
