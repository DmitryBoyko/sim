-- Добавить параметры морфологического замыкания плато в настройки анализа.
-- COALESCE сохраняет уже сохранённые пользователем значения при повторном запуске миграций.
UPDATE app_params
SET value = value || jsonb_build_object(
  'plateau_gap_closing_enabled',
  COALESCE((value->>'plateau_gap_closing_enabled')::boolean, true),
  'plateau_max_gap_points',
  COALESCE((value->>'plateau_max_gap_points')::int, 5)
)
WHERE key = 'analysis';

