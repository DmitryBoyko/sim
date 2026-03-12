package queue

import (
	"context"
	"sim/internal/domain"
	"sync"
	"time"
)

// Queue is a thread-safe ring buffer of data points (last P minutes).
type Queue struct {
	mu       sync.RWMutex
	points   []domain.DataPoint
	maxDur   time.Duration
	subs     []chan<- domain.DataPoint
	onPoint  func(domain.DataPoint)
}

// New creates a queue that keeps points for maxDuration.
func New(maxDuration time.Duration) *Queue {
	return &Queue{
		points: make([]domain.DataPoint, 0, 2048),
		maxDur: maxDuration,
		subs:   make([]chan<- domain.DataPoint, 0),
	}
}

// SetOnPoint sets callback for each new point (e.g. recognition service).
func (q *Queue) SetOnPoint(f func(domain.DataPoint)) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.onPoint = f
}

// Push adds a point, trims old ones, notifies subscribers.
func (q *Queue) Push(p domain.DataPoint) {
	q.mu.Lock()
	cutoff := p.T.Add(-q.maxDur)
	newPoints := make([]domain.DataPoint, 0, len(q.points)+1)
	for _, x := range q.points {
		if x.T.After(cutoff) {
			newPoints = append(newPoints, x)
		}
	}
	newPoints = append(newPoints, p)
	q.points = newPoints
	onPoint := q.onPoint
	subs := make([]chan<- domain.DataPoint, len(q.subs))
	copy(subs, q.subs)
	q.mu.Unlock()

	if onPoint != nil {
		onPoint(p)
	}
	for _, ch := range subs {
		select {
		case ch <- p:
		default:
		}
	}
}

// Snapshot returns a copy of points in the window (last maxDuration).
func (q *Queue) Snapshot() []domain.DataPoint {
	q.mu.RLock()
	defer q.mu.RUnlock()
	out := make([]domain.DataPoint, len(q.points))
	copy(out, q.points)
	return out
}

// Clear removes all points.
func (q *Queue) Clear() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.points = q.points[:0]
}

// Subscribe adds a channel that receives every new point (non-blocking send).
func (q *Queue) Subscribe(ch chan<- domain.DataPoint) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.subs = append(q.subs, ch)
}

// Unsubscribe removes the channel (by closing and not sending anymore we don't track id; for now we keep simple).
func (q *Queue) Unsubscribe(ch chan<- domain.DataPoint) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, c := range q.subs {
		if c == ch {
			q.subs = append(q.subs[:i], q.subs[i+1:]...)
			break
		}
	}
}

// Run reads from in and pushes to queue until ctx is done.
func (q *Queue) Run(ctx context.Context, in <-chan domain.DataPoint) {
	for {
		select {
		case <-ctx.Done():
			return
		case p, ok := <-in:
			if !ok {
				return
			}
			q.Push(p)
		}
	}
}
