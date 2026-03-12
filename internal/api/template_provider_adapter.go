package api

import (
	"context"
	"sim/internal/domain"
	"sim/internal/repository"
)

// TemplateProviderAdapter adapts TemplatesRepository to recognition.TemplateProvider.
type TemplateProviderAdapter struct {
	Repo *repository.TemplatesRepository
}

// GetTemplatesWithVectors returns all templates with vectors.
func (a *TemplateProviderAdapter) GetTemplatesWithVectors(ctx context.Context) ([]domain.TripTemplateWithVector, error) {
	return a.Repo.ListWithVectors(ctx)
}
