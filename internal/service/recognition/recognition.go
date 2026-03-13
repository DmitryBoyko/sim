package recognition

import (
	"context"
	"log"
	"sim/internal/domain"
	"sim/internal/service/vector"
	"sort"
	"strconv"
	"sync"
	"time"
)

// TemplateProvider returns templates with vectors for matching.
type TemplateProvider interface {
	GetTemplatesWithVectors(ctx context.Context) ([]domain.TripTemplateWithVector, error)
}

// TripSaver saves a detected trip and returns its ID.
type TripSaver interface {
	SaveDetectedTrip(ctx context.Context, startedAt, endedAt time.Time, templateID *string, templateName string, matchPercent, matchThresholdPercent float64, phases []domain.PhaseSpan) (string, error)
}

// TemplateComparisonResult — результат сравнения оперативного вектора с одним шаблоном.
type TemplateComparisonResult struct {
	TemplateID   string  `json:"template_id"`
	TemplateName string  `json:"template_name"`
	SpeedCount   int     `json:"speed_count"`
	WeightCount  int     `json:"weight_count"`
	MatchPercent float64 `json:"match_percent"`
}

// AnalysisState — состояние анализа для UI (sliding window и сравнения).
type AnalysisState struct {
	TemplatesLoaded       int                       `json:"templates_loaded"`
	SpeedPoints           int                       `json:"speed_points"`
	WeightPoints          int                       `json:"weight_points"`
	VectorComputed        bool                      `json:"vector_computed"`
	VectorComputeTimeMs   float64                   `json:"vector_compute_time_ms"`   // время расчёта вектора(ов) для слайда, мс (дробное)
	TemplateCompareTimeMs float64                   `json:"template_compare_time_ms"` // время сравнения по всем шаблонам, мс (дробное)
	BestMatchWindow       string                    `json:"best_match_window,omitempty"`
	BestMatchName         string                    `json:"best_match_name,omitempty"`
	BestMatchPercent      float64                   `json:"best_match_percent"`
	Comparisons           []TemplateComparisonResult `json:"comparisons,omitempty"`
	WindowIntervalStart   string                    `json:"window_interval_start,omitempty"`
	WindowIntervalEnd     string                    `json:"window_interval_end,omitempty"`
	NormalizationMode     string                    `json:"normalization_mode"` // "min-max" или "z-norm"
}

// Service does sliding-window trip recognition. Window sizes are taken from templates (max over all).
// Templates are tried in order from smallest (speed_count, weight_count) to largest.
type Service struct {
	mu sync.RWMutex
	// Sliding window buffers (max size from templates)
	speedWindow  []float64
	weightWindow []float64
	timeWindow   []time.Time
	maxSpeed     int
	maxWeight    int
	threshold         float64
	enabled           bool
	cooldownSec       int
	speedBaselineKmh  float64 // 0 = не проверять конец/начало у оси
	weightBaselineTon float64
	useZNormalization bool
	templates         []domain.TripTemplateWithVector // sorted by (SpeedCount, WeightCount) ascending
	provider     TemplateProvider
	saver        TripSaver
	onDetected   func(domain.DetectedTrip)
	// last analysis state for UI (updated on each OnPoint when enabled)
	lastState AnalysisState
	// конец последнего зафиксированного рейса — чтобы не дублировать один и тот же рейс при сдвиге окна
	lastDetectedEndAt time.Time
}

// NewService creates recognition service. Window sizes are set from templates in RefreshTemplates.
func NewService(provider TemplateProvider, saver TripSaver, threshold float64) *Service {
	return &Service{
		speedWindow:        make([]float64, 0, 256),
		weightWindow:       make([]float64, 0, 256),
		timeWindow:         make([]time.Time, 0, 256),
		threshold:          threshold,
		provider:           provider,
		saver:              saver,
		lastState:          AnalysisState{NormalizationMode: "min-max"},
	}
}

// UpdateConfig updates threshold, enabled, cooldown, baseline limits and normalization mode. Window sizes are from templates.
func (s *Service) UpdateConfig(threshold float64, enabled bool, cooldownSec int, speedBaselineKmh, weightBaselineTon float64, useZNormalization bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.threshold = threshold
	s.enabled = enabled
	if cooldownSec < 0 {
		cooldownSec = 0
	}
	s.cooldownSec = cooldownSec
	s.speedBaselineKmh = speedBaselineKmh
	s.weightBaselineTon = weightBaselineTon
	s.useZNormalization = useZNormalization
	if s.useZNormalization {
		s.lastState.NormalizationMode = "z-norm"
	} else {
		s.lastState.NormalizationMode = "min-max"
	}
}

// atBaseline returns true if (speed, weight) считаются «у оси» по заданным порогам. Если оба порога 0 — проверка отключена (true).
func atBaseline(speed, weight, speedMaxKmh, weightMaxTon float64) bool {
	if speedMaxKmh <= 0 && weightMaxTon <= 0 {
		return true
	}
	if speedMaxKmh > 0 && speed > speedMaxKmh {
		return false
	}
	if weightMaxTon > 0 && weight > weightMaxTon {
		return false
	}
	return true
}

// SetOnDetected sets callback when a trip is detected (e.g. WebSocket broadcast).
func (s *Service) SetOnDetected(f func(domain.DetectedTrip)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onDetected = f
}

// sortTemplatesBySize sorts by (SpeedCount, WeightCount) ascending — от меньших к большим в паре.
func sortTemplatesBySize(list []domain.TripTemplateWithVector) {
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.SpeedCount != b.SpeedCount {
			return a.SpeedCount < b.SpeedCount
		}
		return a.WeightCount < b.WeightCount
	})
}

// RefreshTemplates loads templates from provider, sorts by window size, and sets max sliding window sizes.
func (s *Service) RefreshTemplates(ctx context.Context) error {
	list, err := s.provider.GetTemplatesWithVectors(ctx)
	if err != nil {
		return err
	}
	sortTemplatesBySize(list)
	maxSpeed, maxWeight := 0, 0
	for _, t := range list {
		if t.SpeedCount > maxSpeed {
			maxSpeed = t.SpeedCount
		}
		if t.WeightCount > maxWeight {
			maxWeight = t.WeightCount
		}
	}
	s.mu.Lock()
	s.templates = list
	s.maxSpeed = maxSpeed
	s.maxWeight = maxWeight
	// ensure capacity
	if cap(s.speedWindow) < maxSpeed+10 {
		newSpeed := make([]float64, len(s.speedWindow), maxSpeed+64)
		copy(newSpeed, s.speedWindow)
		s.speedWindow = newSpeed
	}
	if cap(s.weightWindow) < maxWeight+10 {
		newWeight := make([]float64, len(s.weightWindow), maxWeight+64)
		copy(newWeight, s.weightWindow)
		s.weightWindow = newWeight
	}
	if cap(s.timeWindow) < maxSpeed+10 {
		newTime := make([]time.Time, len(s.timeWindow), maxSpeed+64)
		copy(newTime, s.timeWindow)
		s.timeWindow = newTime
	}
	s.lastState.TemplatesLoaded = len(list)
	s.mu.Unlock()
	return nil
}

// GetAnalysisState returns current analysis state for UI (throttled updates on frontend).
func (s *Service) GetAnalysisState() AnalysisState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastState
}

// OnPoint is called for each new data point. Sliding window push, then try templates in order (smallest first).
func (s *Service) OnPoint(ctx context.Context, p domain.DataPoint) {
	s.mu.Lock()
	if !s.enabled {
		s.lastState.TemplatesLoaded = len(s.templates)
		s.lastState.SpeedPoints = len(s.speedWindow)
		s.lastState.WeightPoints = len(s.weightWindow)
		s.lastState.VectorComputed = false
		s.lastState.VectorComputeTimeMs = 0
		s.lastState.TemplateCompareTimeMs = 0
		s.mu.Unlock()
		return
	}
	s.speedWindow = append(s.speedWindow, p.Speed)
	if len(s.speedWindow) > s.maxSpeed {
		s.speedWindow = s.speedWindow[1:]
	}
	s.weightWindow = append(s.weightWindow, p.Weight)
	if len(s.weightWindow) > s.maxWeight {
		s.weightWindow = s.weightWindow[1:]
	}
	s.timeWindow = append(s.timeWindow, p.T)
	if len(s.timeWindow) > s.maxSpeed {
		s.timeWindow = s.timeWindow[1:]
	}
	templates := make([]domain.TripTemplateWithVector, len(s.templates))
	copy(templates, s.templates)
	threshold := s.threshold
	speedBaselineKmh := s.speedBaselineKmh
	weightBaselineTon := s.weightBaselineTon
	onDetected := s.onDetected
	s.lastState.TemplatesLoaded = len(templates)
		s.lastState.SpeedPoints = len(s.speedWindow)
		s.lastState.WeightPoints = len(s.weightWindow)
		s.lastState.VectorComputed = false
		s.lastState.VectorComputeTimeMs = 0
		s.lastState.TemplateCompareTimeMs = 0
		s.lastState.Comparisons = nil
		s.lastState.WindowIntervalStart = ""
		s.lastState.WindowIntervalEnd = ""
		s.mu.Unlock()

	if len(templates) == 0 {
		return
	}

	var vectorTotalMs, compareTotalMs float64
	var bestPercent float64
	var bestT *domain.TripTemplateWithVector
	var bestStartedAt, bestEndedAt time.Time

	// Пробуем шаблоны по порядку (от меньшего окна к большему), выбираем лучшее совпадение с проходом проверки «у оси»
	for _, t := range templates {
		needSpeed, needWeight := t.SpeedCount, t.WeightCount
		s.mu.Lock()
		hasEnough := len(s.speedWindow) >= needSpeed && len(s.weightWindow) >= needWeight
		if !hasEnough {
			s.mu.Unlock()
			continue
		}
		useSpeed := make([]float64, needSpeed)
		copy(useSpeed, s.speedWindow[len(s.speedWindow)-needSpeed:])
		useWeight := make([]float64, needWeight)
		copy(useWeight, s.weightWindow[len(s.weightWindow)-needWeight:])
		startIdx := len(s.timeWindow) - needSpeed
		if startIdx < 0 {
			startIdx = 0
		}
		startedAt := s.timeWindow[startIdx]
		s.mu.Unlock()

		t0 := time.Now()
		var operVector []float64
		var templateVec []float64
		if s.useZNormalization {
			operVector = vector.BuildVectorZ(useSpeed, useWeight)
			templateVec = t.ZVector
		} else {
			operVector = vector.BuildVectorFromSeries(useSpeed, useWeight)
			templateVec = t.Vector
		}
		vectorTotalMs += time.Since(t0).Seconds() * 1000
		if len(templateVec) == 0 || len(operVector) != len(templateVec) {
			continue
		}
		t1 := time.Now()
		percent := vector.CosineSimilarityPercent(operVector, templateVec)
		compareTotalMs += time.Since(t1).Seconds() * 1000

		s.mu.Lock()
		s.lastState.VectorComputed = true
		s.lastState.VectorComputeTimeMs = vectorTotalMs
		s.lastState.TemplateCompareTimeMs = compareTotalMs
		// Лучшее совпадение — шаблон с максимальным процентом среди сравнённых
		if percent > s.lastState.BestMatchPercent || s.lastState.Comparisons == nil {
			s.lastState.BestMatchWindow = ""
			if needSpeed > 0 || needWeight > 0 {
				s.lastState.BestMatchWindow = "скорость " + strconv.Itoa(needSpeed) + ", вес " + strconv.Itoa(needWeight)
			}
			s.lastState.BestMatchName = t.Name
			s.lastState.BestMatchPercent = percent
			if len(s.timeWindow) > 0 {
				s.lastState.WindowIntervalStart = startedAt.Format(time.RFC3339Nano)
				s.lastState.WindowIntervalEnd = s.timeWindow[len(s.timeWindow)-1].Format(time.RFC3339Nano)
			}
		}
		if s.lastState.Comparisons == nil {
			s.lastState.Comparisons = make([]TemplateComparisonResult, 0, len(templates))
		}
		s.lastState.Comparisons = append(s.lastState.Comparisons, TemplateComparisonResult{
			TemplateID:   t.ID,
			TemplateName: t.Name,
			SpeedCount:   needSpeed,
			WeightCount:  needWeight,
			MatchPercent: percent,
		})
		s.mu.Unlock()

		if percent < threshold {
			continue
		}
		// Не дублируем один и тот же рейс и соблюдаем период охлаждения
		s.mu.Lock()
		lastEnd := s.lastDetectedEndAt
		cooldownSec := s.cooldownSec
		s.mu.Unlock()
		if !lastEnd.IsZero() {
			cooldownEnd := lastEnd.Add(time.Duration(cooldownSec) * time.Second)
			if startedAt.Before(cooldownEnd) {
				continue
			}
		}
		// Проверка «конец рейса» у оси: последняя точка окна — низкие скорость и вес
		endSpeed, endWeight := useSpeed[len(useSpeed)-1], useWeight[len(useWeight)-1]
		if !atBaseline(endSpeed, endWeight, speedBaselineKmh, weightBaselineTon) {
			log.Printf("[recognition] рейс не сохранён (конец окна не у оси): шаблон %q, скорость=%.1f, вес=%.1f", t.Name, endSpeed, endWeight)
			continue
		}
		// Проверка «начало рейса» у оси: первая точка окна — низкие скорость и вес
		if !atBaseline(useSpeed[0], useWeight[0], speedBaselineKmh, weightBaselineTon) {
			log.Printf("[recognition] рейс не сохранён (начало окна не у оси): шаблон %q, скорость=%.1f, вес=%.1f", t.Name, useSpeed[0], useWeight[0])
			continue
		}
		// Лучшее совпадение среди прошедших проверку
		if bestT == nil || percent > bestPercent {
			bestPercent = percent
			bestT = &t
			bestStartedAt = startedAt
			bestEndedAt = p.T
		}
	}

	if bestT != nil {
		t := *bestT
		s.mu.Lock()
		s.lastDetectedEndAt = bestEndedAt
		onDetected = s.onDetected
		s.mu.Unlock()
		templateID := t.ID
		templateName := t.Name
		thr := threshold
		log.Printf("[recognition] рейс обнаружен: шаблон %q, %.1f%%, интервал %s — %s", templateName, bestPercent, bestStartedAt.Format(time.RFC3339), bestEndedAt.Format(time.RFC3339))
		detected := domain.DetectedTrip{
			StartedAt:             bestStartedAt,
			EndedAt:               bestEndedAt,
			TemplateID:            &templateID,
			TemplateName:          templateName,
			MatchThresholdPercent: &thr,
			MatchPercent:          bestPercent,
		}
		// Сохранение в БД и анализ фаз выполняются асинхронно (воркер в main), не блокируем поток точек.
		if onDetected != nil {
			onDetected(detected)
		}
	}
}

// Clear clears the sliding windows and сбрасывает конец последнего рейса (для нового потока данных).
func (s *Service) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.speedWindow = s.speedWindow[:0]
	s.weightWindow = s.weightWindow[:0]
	s.timeWindow = s.timeWindow[:0]
	s.lastState.SpeedPoints = 0
	s.lastState.WeightPoints = 0
	s.lastState.VectorComputed = false
	s.lastState.VectorComputeTimeMs = 0
	s.lastState.TemplateCompareTimeMs = 0
	s.lastState.Comparisons = nil
	var zero time.Time
	s.lastDetectedEndAt = zero
}
