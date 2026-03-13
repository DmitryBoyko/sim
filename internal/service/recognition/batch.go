package recognition

import (
	"context"
	"log"
	"sim/internal/domain"
	"sim/internal/service/vector"
	"time"
)

// RunBatch runs trip detection over a slice of points (e.g. historical data) using the same
// sliding-window + template matching logic as OnPoint. Templates must be sorted by window size
// (use sortTemplatesBySize). speedBaselineKmh/weightBaselineTon: 0 = не проверять «у оси».
// useZNormalization: true = Z-нормализация (сравнение с template.ZVector), false = Min-Max (template.Vector).
// Calls saver for each detected trip and onProgress(processed, total) periodically for progress reporting.
func RunBatch(
	ctx context.Context,
	points []domain.DataPoint,
	templates []domain.TripTemplateWithVector,
	threshold float64,
	cooldownSec int,
	speedBaselineKmh, weightBaselineTon float64,
	useZNormalization bool,
	saver TripSaver,
	onProgress func(processed, total int),
) {
	if len(points) == 0 || len(templates) == 0 {
		if onProgress != nil {
			onProgress(len(points), len(points))
		}
		return
	}
	maxSpeed, maxWeight := 0, 0
	for _, t := range templates {
		if t.SpeedCount > maxSpeed {
			maxSpeed = t.SpeedCount
		}
		if t.WeightCount > maxWeight {
			maxWeight = t.WeightCount
		}
	}
	speedWindow := make([]float64, 0, maxSpeed+64)
	weightWindow := make([]float64, 0, maxWeight+64)
	timeWindow := make([]time.Time, 0, maxSpeed+64)
	var lastDetectedEndAt time.Time
	total := len(points)
	progressInterval := total / 100
	if progressInterval < 1 {
		progressInterval = 1
	}
	for i, p := range points {
		select {
		case <-ctx.Done():
			return
		default:
		}
		speedWindow = append(speedWindow, p.Speed)
		if len(speedWindow) > maxSpeed {
			speedWindow = speedWindow[1:]
		}
		weightWindow = append(weightWindow, p.Weight)
		if len(weightWindow) > maxWeight {
			weightWindow = weightWindow[1:]
		}
		timeWindow = append(timeWindow, p.T)
		if len(timeWindow) > maxSpeed {
			timeWindow = timeWindow[1:]
		}
		var bestPercent float64
		var bestT *domain.TripTemplateWithVector
		var bestStartedAt, bestEndedAt time.Time
		for _, t := range templates {
			needSpeed, needWeight := t.SpeedCount, t.WeightCount
			if len(speedWindow) < needSpeed || len(weightWindow) < needWeight {
				continue
			}
			useSpeed := make([]float64, needSpeed)
			copy(useSpeed, speedWindow[len(speedWindow)-needSpeed:])
			useWeight := make([]float64, needWeight)
			copy(useWeight, weightWindow[len(weightWindow)-needWeight:])
			startIdx := len(timeWindow) - needSpeed
			if startIdx < 0 {
				startIdx = 0
			}
			startedAt := timeWindow[startIdx]
			var operVector []float64
			var templateVec []float64
			if useZNormalization {
				operVector = vector.BuildVectorZ(useSpeed, useWeight)
				templateVec = t.ZVector
			} else {
				operVector = vector.BuildVectorFromSeries(useSpeed, useWeight)
				templateVec = t.Vector
			}
			if len(templateVec) == 0 || len(operVector) != len(templateVec) {
				continue
			}
			percent := vector.CosineSimilarityPercent(operVector, templateVec)
			if percent < threshold {
				continue
			}
			if !lastDetectedEndAt.IsZero() {
				cooldownEnd := lastDetectedEndAt.Add(time.Duration(cooldownSec) * time.Second)
				if startedAt.Before(cooldownEnd) {
					continue
				}
			}
			endSpeed, endWeight := useSpeed[len(useSpeed)-1], useWeight[len(useWeight)-1]
			if !atBaseline(endSpeed, endWeight, speedBaselineKmh, weightBaselineTon) {
				log.Printf("[recognition batch] рейс не сохранён (конец окна не у оси): шаблон %q", t.Name)
				continue
			}
			if !atBaseline(useSpeed[0], useWeight[0], speedBaselineKmh, weightBaselineTon) {
				log.Printf("[recognition batch] рейс не сохранён (начало окна не у оси): шаблон %q", t.Name)
				continue
			}
			if bestT == nil || percent > bestPercent {
				bestPercent = percent
				bestT = &t
				bestStartedAt = startedAt
				bestEndedAt = p.T
			}
		}
		if bestT != nil {
			t := *bestT
			lastDetectedEndAt = bestEndedAt
			if saver != nil {
				_, _ = saver.SaveDetectedTrip(ctx, bestStartedAt, bestEndedAt, &t.ID, t.Name, bestPercent, threshold, nil)
			}
			log.Printf("[recognition batch] рейс сохранён: шаблон %q, %.1f%%", t.Name, bestPercent)
		}
		if onProgress != nil && (i+1)%progressInterval == 0 {
			onProgress(i+1, total)
		}
	}
	if onProgress != nil {
		onProgress(total, total)
	}
}

// RunBatchWithTemplates loads templates from provider, sorts them, and runs RunBatch.
func RunBatchWithTemplates(
	ctx context.Context,
	points []domain.DataPoint,
	provider TemplateProvider,
	threshold float64,
	cooldownSec int,
	speedBaselineKmh, weightBaselineTon float64,
	useZNormalization bool,
	saver TripSaver,
	onProgress func(processed, total int),
) error {
	list, err := provider.GetTemplatesWithVectors(ctx)
	if err != nil {
		log.Printf("[recognition batch] GetTemplatesWithVectors: %v", err)
		return err
	}
	sortTemplatesBySize(list)
	RunBatch(ctx, points, list, threshold, cooldownSec, speedBaselineKmh, weightBaselineTon, useZNormalization, saver, onProgress)
	return nil
}
