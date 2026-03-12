package api

import (
	"context"
	"sim/internal/domain"
	"sim/internal/repository"
	"time"
)

// TripSaverAdapter adapts TripsRepository to recognition.TripSaver.
type TripSaverAdapter struct {
	Repo *repository.TripsRepository
}

// SaveDetectedTrip saves the trip and returns ID (сохраняет имя шаблона и порог для понимания, по какому шаблону и с каким порогом найден рейс).
func (a *TripSaverAdapter) SaveDetectedTrip(ctx context.Context, startedAt, endedAt time.Time, templateID *string, templateName string, matchPercent, matchThresholdPercent float64, phases []domain.PhaseSpan) (string, error) {
	return a.Repo.Create(ctx, startedAt, endedAt, templateID, templateName, matchPercent, matchThresholdPercent, phases)
}
