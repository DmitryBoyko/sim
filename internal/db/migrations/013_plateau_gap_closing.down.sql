UPDATE app_params
SET value = value - 'plateau_gap_closing_enabled' - 'plateau_max_gap_points'
WHERE key = 'analysis';

