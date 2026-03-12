-- Добавить процент отклонения длительности фаз (одно значение на все фазы: погрузка, перевозка, разгрузка, возврат).
-- COALESCE сохраняет уже сохранённое пользователем значение при повторном запуске миграций.
UPDATE app_params SET value = value || jsonb_build_object(
  'phase_duration_deviation_percent', COALESCE((value->>'phase_duration_deviation_percent')::float, 0)
) WHERE key = 'phases';
