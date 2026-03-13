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

// BroadcastTripFound sends detected trip event (with payload_ton and phases when available).
func (h *Hub) BroadcastTripFound(t domain.DetectedTrip) {
	payload := map[string]interface{}{
		"trip_id":       t.ID,
		"id":            t.ID,
		"started_at":    t.StartedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"ended_at":      t.EndedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"template_id":   t.TemplateID,
		"template_name": t.TemplateName,
		"match_percent": t.MatchPercent,
	}
	if t.MatchThresholdPercent != nil {
		payload["match_threshold_percent"] = *t.MatchThresholdPercent
	}
	if t.PayloadTon != nil {
		payload["payload_ton"] = *t.PayloadTon
	}
	// Фазы анализа (loading, transport, unloading, return)
	phases := make([]map[string]interface{}, 0, len(t.AnalysisPhases))
	for _, ph := range t.AnalysisPhases {
		phases = append(phases, map[string]interface{}{
			"phase_type":   ph.PhaseType,
			"started_at":   ph.StartedAt.Format("2006-01-02T15:04:05.000Z07:00"),
			"ended_at":     ph.EndedAt.Format("2006-01-02T15:04:05.000Z07:00"),
			"duration_sec": ph.DurationSec,
			"avg_speed_kmh": ph.AvgSpeedKmh,
			"avg_weight_ton": ph.AvgWeightTon,
			"point_count":   ph.PointCount,
			"sort_order":    ph.SortOrder,
		})
		if ph.PhaseType == "transport" {
			payload["transport_avg_weight_ton"] = ph.AvgWeightTon
		}
	}
	payload["phases"] = phases
	h.Broadcast(WSMessage{
		Type:    "trip_found",
		Payload: payload,
	})
}

// BroadcastGeneratorStatus sends generator running state.
func (h *Hub) BroadcastGeneratorStatus(running bool) {
	h.Broadcast(WSMessage{Type: "generator_status", Payload: map[string]bool{"running": running}})
}
