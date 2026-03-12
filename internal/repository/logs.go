package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LogSource is app_logs.source.
const (
	LogSourceBackend  = "backend"
	LogSourceFrontend = "frontend"
)

// LogLevel is app_logs.level.
const (
	LogLevelInfo = "info"
	LogLevelWarn = "warn"
	LogLevelErr  = "error"
)

// AppLogEntry is a row in app_logs.
type AppLogEntry struct {
	ID        int64           `json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	Source    string          `json:"source"`
	Level     string          `json:"level"`
	Message   string          `json:"message"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// LogsRepository reads/writes app_logs.
type LogsRepository struct {
	pool *pgxpool.Pool
}

// NewLogsRepository creates LogsRepository.
func NewLogsRepository(pool *pgxpool.Pool) *LogsRepository {
	return &LogsRepository{pool: pool}
}

// Insert adds one log entry. Used by batch flusher and by POST /api/logs.
func (r *LogsRepository) Insert(ctx context.Context, source, level, message string, payload []byte) error {
	if len(message) > 65536 {
		message = message[:65536]
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO app_logs (source, level, message, payload) VALUES ($1, $2, $3, $4)`,
		source, level, message, payload)
	return err
}

// InsertBatch inserts multiple entries in one transaction. Fails all or none.
func (r *LogsRepository) InsertBatch(ctx context.Context, entries []AppLogEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, e := range entries {
		msg := e.Message
		if len(msg) > 65536 {
			msg = msg[:65536]
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO app_logs (source, level, message, payload) VALUES ($1, $2, $3, $4)`,
			e.Source, e.Level, msg, e.Payload)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ListParams for filtering and ordering.
type ListLogsParams struct {
	From   *time.Time
	To     *time.Time
	Source string // "", "backend", "frontend"
	Order  string // "desc" (newest first) or "asc"
	Limit  int
}

// List returns log entries for the given period and filters.
func (r *LogsRepository) List(ctx context.Context, p ListLogsParams) ([]AppLogEntry, error) {
	if p.Limit <= 0 {
		p.Limit = 500
	}
	if p.Limit > 2000 {
		p.Limit = 2000
	}
	order := "DESC"
	if p.Order == "asc" {
		order = "ASC"
	}
	var conditions []string
	var args []interface{}
	n := 1
	if p.From != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", n))
		args = append(args, *p.From)
		n++
	}
	if p.To != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", n))
		args = append(args, *p.To)
		n++
	}
	if p.Source == LogSourceBackend || p.Source == LogSourceFrontend {
		conditions = append(conditions, fmt.Sprintf("source = $%d", n))
		args = append(args, p.Source)
		n++
	}
	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}
	args = append(args, p.Limit)
	q := `SELECT id, created_at, source, level, message, payload FROM app_logs` + where +
		` ORDER BY created_at ` + order + fmt.Sprintf(` LIMIT $%d`, n)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AppLogEntry
	for rows.Next() {
		var e AppLogEntry
		var payload []byte
		if err := rows.Scan(&e.ID, &e.CreatedAt, &e.Source, &e.Level, &e.Message, &payload); err != nil {
			return nil, err
		}
		if len(payload) > 0 {
			e.Payload = payload
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// DeleteByDateRange deletes log entries with created_at between from and to (inclusive).
func (r *LogsRepository) DeleteByDateRange(ctx context.Context, from, to time.Time) (int64, error) {
	res, err := r.pool.Exec(ctx,
		`DELETE FROM app_logs WHERE created_at >= $1 AND created_at <= $2`,
		from, to)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}
