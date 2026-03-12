package api

import (
	"encoding/json"
	"log"
	"sim/internal/domain"
	"sync"
)

// WSMessage is sent to clients.
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Hub broadcasts messages to WebSocket clients.
type Hub struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

// NewHub creates a new hub.
func NewHub() *Hub {
	return &Hub{clients: make(map[chan []byte]struct{})}
}

// Subscribe adds a client channel and returns unsubscribe func.
func (h *Hub) Subscribe(ch chan []byte) (unsubscribe func()) {
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return func() {
		h.mu.Lock()
		delete(h.clients, ch)
		h.mu.Unlock()
	}
}

// Broadcast sends message to all clients (non-blocking).
func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[api] Hub Broadcast marshal: %v", err)
		return
	}
	h.mu.RLock()
	for ch := range h.clients {
		select {
		case ch <- data:
		default:
		}
	}
	h.mu.RUnlock()
}

// BroadcastPoint sends a data point to all clients.
func (h *Hub) BroadcastPoint(p domain.DataPoint) {
	h.Broadcast(WSMessage{
		Type: "point",
		Payload: map[string]interface{}{
			"t":      p.T.Format("2006-01-02T15:04:05.000Z07:00"),
			"speed":  p.Speed,
			"weight": p.Weight,
			"phase":  p.Phase,
		},
	})
}

// BroadcastTripFound sends detected trip event.
func (h *Hub) BroadcastTripFound(t domain.DetectedTrip) {
	phases := make([]map[string]string, 0, len(t.Phases))
	for _, ph := range t.Phases {
		phases = append(phases, map[string]string{
			"phase": ph.Phase,
			"from":  ph.From.Format("2006-01-02T15:04:05.000Z07:00"),
			"to":    ph.To.Format("2006-01-02T15:04:05.000Z07:00"),
		})
	}
	payload := map[string]interface{}{
		"id":            t.ID,
		"started_at":    t.StartedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"ended_at":      t.EndedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"template_id":   t.TemplateID,
		"template_name": t.TemplateName,
		"match_percent": t.MatchPercent,
		"phases":        phases,
	}
	if t.MatchThresholdPercent != nil {
		payload["match_threshold_percent"] = *t.MatchThresholdPercent
	}
	h.Broadcast(WSMessage{
		Type:    "trip_found",
		Payload: payload,
	})
}

// BroadcastGeneratorStatus sends generator running state.
func (h *Hub) BroadcastGeneratorStatus(running bool) {
	h.Broadcast(WSMessage{Type: "generator_status", Payload: map[string]bool{"running": running}})
}
