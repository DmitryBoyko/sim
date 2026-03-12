-- Сохраняем имя шаблона при фиксации рейса (для понимания, по какому шаблону найден).
ALTER TABLE detected_trips ADD COLUMN IF NOT EXISTS template_name TEXT;
