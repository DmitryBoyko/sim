-- Удалить добавленные ключи (PostgreSQL 9.5+)
UPDATE app_params SET value = value - 'delay_after_unload_sec' - 'delay_before_load_sec' WHERE key = 'phases';
UPDATE app_params SET value = value - 'weight_noise_load_ton' WHERE key = 'noise';
