package logger

import (
	"bufio"
	"bytes"
	"context"
	"log"
	"sim/internal/repository"
	"strings"
	"sync"
	"time"
)

const (
	bufferSize   = 8192
	flushInterval = 500 * time.Millisecond
	batchSize    = 50
	chanCapacity = 10000
	maxMsgLen    = 65536
)

// AsyncLogWriter implements io.Writer. Each Write() line is enqueued and later
// inserted into app_logs in batches. Non-blocking: if the channel is full, the
// line is dropped so the app never blocks on DB. Safe for concurrent use.
type AsyncLogWriter struct {
	repo *repository.LogsRepository
	ch   chan repository.AppLogEntry
	done chan struct{}
	once sync.Once
}

// NewAsyncLogWriter creates a writer that sends entries to repo in the background.
func NewAsyncLogWriter(repo *repository.LogsRepository) *AsyncLogWriter {
	return &AsyncLogWriter{
		repo: repo,
		ch:   make(chan repository.AppLogEntry, chanCapacity),
		done: make(chan struct{}),
	}
}

// Write implements io.Writer. Each line (after splitting by newline) is enqueued
// as one log entry. Level is inferred from prefix "[ERROR]", "[WARN]" or default "info".
func (w *AsyncLogWriter) Write(p []byte) (n int, err error) {
	n = len(p)
	scanner := bufio.NewScanner(bytes.NewReader(p))
	scanner.Buffer(make([]byte, 0, maxMsgLen), maxMsgLen)
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\n")
		if line == "" {
			continue
		}
		level := repository.LogLevelInfo
		if strings.HasPrefix(line, "[ERROR]") || strings.HasPrefix(line, "ERROR") {
			level = repository.LogLevelErr
		} else if strings.HasPrefix(line, "[WARN]") || strings.HasPrefix(line, "WARN") {
			level = repository.LogLevelWarn
		}
		if len(line) > maxMsgLen {
			line = line[:maxMsgLen]
		}
		entry := repository.AppLogEntry{
			Source:  repository.LogSourceBackend,
			Level:   level,
			Message: line,
		}
		select {
		case w.ch <- entry:
		default:
			// Channel full: drop to avoid blocking (e.g. if DB is slow)
			log.Printf("[logger] drop log line (buffer full)")
		}
	}
	return n, nil
}

// Start runs the flush goroutine. Call once after creating; pass a context that
// is cancelled on shutdown so the goroutine can exit.
func (w *AsyncLogWriter) Start(ctx context.Context) {
	w.once.Do(func() {
		go w.run(ctx)
	})
}

func (w *AsyncLogWriter) run(ctx context.Context) {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	batch := make([]repository.AppLogEntry, 0, batchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		// Use background context with timeout so we don't block shutdown forever
		insertCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := w.repo.InsertBatch(insertCtx, batch)
		cancel()
		if err != nil {
			log.Printf("[logger] insert batch failed: %v", err)
			// Don't retry forever; drop this batch to avoid backlog
		}
		batch = batch[:0]
	}
	for {
		select {
		case <-ctx.Done():
			flush()
			close(w.done)
			return
		case e := <-w.ch:
			batch = append(batch, e)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// Close stops the flush goroutine and waits for it. Call before process exit.
func (w *AsyncLogWriter) Close() {
	// Closing the channel would require another way to signal run() to exit.
	// We rely on context cancellation from main. So we don't close ch here.
	<-w.done
}

