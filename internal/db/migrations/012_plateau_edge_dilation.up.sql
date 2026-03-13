-- Добавить флаг коррекции краёв плато в настройки анализа.
-- COALESCE сохраняет уже сохранённое пользователем значение при повторном запуске миграций.
UPDATE app_params SET value = value || jsonb_build_object(
  'plateau_edge_dilation_enabled',
  COALESCE((value->>'plateau_edge_dilation_enabled')::boolean, true)
) WHERE key = 'analysis';

