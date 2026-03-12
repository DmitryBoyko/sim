-- Добавить задержки и шум погрузки в существующие настройки (если ключей ещё нет).
-- Используем COALESCE, чтобы не перезаписывать уже сохранённые пользователем значения при повторном запуске миграций.
UPDATE app_params SET value = value || jsonb_build_object(
  'delay_after_unload_sec', COALESCE((value->>'delay_after_unload_sec')::int, 20),
  'delay_before_load_sec', COALESCE((value->>'delay_before_load_sec')::int, 20)
) WHERE key = 'phases';
UPDATE app_params SET value = value || jsonb_build_object(
  'weight_noise_load_ton', COALESCE((value->>'weight_noise_load_ton')::float, 2)
) WHERE key = 'noise';
