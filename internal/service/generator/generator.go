package generator

import (
	"context"
	"math/rand"
	"sim/internal/domain"
	"sync"
	"time"
)

// cycleDurations — длительности фаз текущего цикла (сек); при смене цикла пересчитываются с учётом % отклонения.
type cycleDurations struct {
	loadSec      int
	transportSec int
	unloadSec    int
	returnSec    int
	totalSec     int
}

// Service generates data points following trip phases with configurable noise.
type Service struct {
	mu     sync.RWMutex
	config *domain.AppSettings
	// cycleStart — начало текущего цикла фаз.
	cycleStart time.Time
	// currentCycle — длительности фаз текущего цикла (рандомизированы при входе в цикл).
	currentCycle cycleDurations
}

// NewService creates a generator service.
func NewService(config *domain.AppSettings) *Service {
	return &Service{config: config, cycleStart: time.Now()}
}

// UpdateConfig updates the config (call when settings change).
func (s *Service) UpdateConfig(cfg *domain.AppSettings) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = cfg
	s.currentCycle = cycleDurations{} // следующий Generate пересчитает длительности
}

// applyPhaseDeviation возвращает baseSec ± (baseSec * percent/100); знак ± случайный. Минимум 1 при baseSec > 0.
func applyPhaseDeviation(baseSec int, percent float64) int {
	if baseSec <= 0 {
		return baseSec
	}
	if percent <= 0 {
		return baseSec
	}
	delta := int(float64(baseSec) * percent / 100)
	if delta < 0 {
		delta = 0
	}
	sign := 1
	if rand.Intn(2) == 0 {
		sign = -1
	}
	out := baseSec + sign*delta
	if out < 1 {
		out = 1
	}
	return out
}

// computeCycleDurations заполняет длительности фаз текущего цикла с учётом отклонения (для Погрузка, Перевозка, Разгрузка, Возврат).
func computeCycleDurations(p domain.PhasesConfig) cycleDurations {
	delayAfter := p.DelayAfterUnloadSec
	if delayAfter < 0 {
		delayAfter = 0
	}
	delayBefore := p.DelayBeforeLoadSec
	if delayBefore < 0 {
		delayBefore = 0
	}
	percent := p.PhaseDurationDeviationPercent
	if percent < 0 {
		percent = 0
	}
	loadSec := applyPhaseDeviation(p.LoadDurationSec, percent)
	transportSec := applyPhaseDeviation(p.TransportDurationSec, percent)
	unloadSec := applyPhaseDeviation(p.UnloadDurationSec, percent)
	returnSec := applyPhaseDeviation(p.ReturnDurationSec, percent)
	totalSec := loadSec + transportSec + unloadSec + delayAfter + returnSec + delayBefore
	return cycleDurations{
		loadSec:      loadSec,
		transportSec: transportSec,
		unloadSec:    unloadSec,
		returnSec:    returnSec,
		totalSec:     totalSec,
	}
}

// Generate produces one data point at current moment based on phase and config.
func (s *Service) Generate(now time.Time) domain.DataPoint {
	s.mu.Lock()
	cfg := s.config
	cycleStart := s.cycleStart
	cur := s.currentCycle
	s.mu.Unlock()

	if cfg == nil {
		return domain.DataPoint{T: now, Speed: 0, Weight: 0, Phase: domain.PhaseLoad}
	}

	p := cfg.Phases
	sw := cfg.SpeedWeight
	noise := cfg.Noise

	delayAfterUnload := p.DelayAfterUnloadSec
	if delayAfterUnload < 0 {
		delayAfterUnload = 0
	}
	delayBeforeLoad := p.DelayBeforeLoadSec
	if delayBeforeLoad < 0 {
		delayBeforeLoad = 0
	}

	// Инициализация или переход на новый цикл: нужны актуальные длительности.
	s.mu.Lock()
	if cur.totalSec == 0 {
		cur = computeCycleDurations(p)
		s.currentCycle = cur
	}
	elapsed := now.Sub(cycleStart)
	if elapsed < 0 {
		elapsed = 0
	}
	sec := int(elapsed.Seconds())
	for sec >= cur.totalSec {
		s.cycleStart = s.cycleStart.Add(time.Duration(cur.totalSec) * time.Second)
		cur = computeCycleDurations(p)
		s.currentCycle = cur
		elapsed = now.Sub(s.cycleStart)
		if elapsed < 0 {
			elapsed = 0
		}
		sec = int(elapsed.Seconds())
	}
	s.mu.Unlock()

	loadEnd := cur.loadSec
	transportEnd := loadEnd + cur.transportSec
	unloadEnd := transportEnd + cur.unloadSec
	delayAfterEnd := unloadEnd + delayAfterUnload
	returnEnd := delayAfterEnd + cur.returnSec

	var phase string
	var speed, weight float64

	if sec < loadEnd {
		phase = domain.PhaseLoad
		speed = sw.VMinKmh
		progress := float64(sec) / float64(cur.loadSec)
		weight = progress * sw.MMaxTon
	} else if sec < transportEnd {
		phase = domain.PhaseTransport
		localSec := sec - loadEnd
		const rampUpSec = 60
		const rampDownSec = 40
		total := cur.transportSec
		if localSec < rampUpSec {
			progress := float64(localSec) / float64(rampUpSec)
			speed = sw.VMinKmh + progress*(sw.VMaxKmh-sw.VMinKmh)
		} else if total > rampDownSec && localSec < total-rampDownSec {
			speed = sw.VMaxKmh
		} else {
			elapsedDown := localSec - (total - rampDownSec)
			if rampDownSec > 0 {
				progress := float64(elapsedDown) / float64(rampDownSec)
				if progress > 1 {
					progress = 1
				}
				speed = sw.VMaxKmh - progress*(sw.VMaxKmh-sw.VMinKmh)
			} else {
				speed = sw.VMaxKmh
			}
		}
		weight = sw.MMinTon + (sw.MMaxTon-sw.MMinTon)*0.5
	} else if sec < unloadEnd {
		phase = domain.PhaseUnload
		speed = sw.VMinKmh
		localSec := sec - transportEnd
		progress := float64(localSec) / float64(cur.unloadSec)
		weight = sw.MMaxTon * (1 - progress)
	} else if sec < delayAfterEnd {
		phase = domain.PhaseUnload
		speed = sw.VMinKmh
		weight = 0
	} else if sec < returnEnd {
		phase = domain.PhaseReturn
		localSec := sec - delayAfterEnd
		const rampUpSec = 60
		const rampDownSec = 40
		total := cur.returnSec
		if localSec < rampUpSec {
			progress := float64(localSec) / float64(rampUpSec)
			speed = sw.VMinKmh + progress*(sw.VMaxKmh-sw.VMinKmh)
		} else if total > rampDownSec && localSec < total-rampDownSec {
			speed = sw.VMaxKmh
		} else {
			elapsedDown := localSec - (total - rampDownSec)
			if rampDownSec > 0 {
				progress := float64(elapsedDown) / float64(rampDownSec)
				if progress > 1 {
					progress = 1
				}
				speed = sw.VMaxKmh - progress*(sw.VMaxKmh-sw.VMinKmh)
			} else {
				speed = sw.VMaxKmh
			}
		}
		weight = sw.MEmptyTon
	} else {
		phase = domain.PhaseReturn
		speed = sw.VMinKmh
		weight = sw.MEmptyTon
	}

	speed += addNoise(noise.SpeedNoiseKmh)
	weight += addNoise(noise.WeightNoiseTon)
	// Дополнительный шум веса при погрузке (амортизаторы)
	if phase == domain.PhaseLoad {
		weight += addNoise(noise.WeightNoiseLoadTon)
	}
	if speed < 0 {
		speed = 0
	}
	if speed > sw.VMaxKmh {
		speed = sw.VMaxKmh
	}
	if weight < 0 {
		weight = 0
	}
	if weight > sw.MMaxTon {
		weight = sw.MMaxTon
	}

	return domain.DataPoint{T: now, Speed: speed, Weight: weight, Phase: phase}
}

// addNoise returns a value in [-max, +max] (uniform for simplicity).
func addNoise(max float64) float64 {
	if max <= 0 {
		return 0
	}
	// simple pseudo-uniform: use time nano mod
	x := float64(time.Now().UnixNano()%10001) / 10000
	return (x*2 - 1) * max
}

// ResetCycle resets the phase cycle start to now (e.g. after clear); следующий цикл получит новые рандомные длительности.
func (s *Service) ResetCycle(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cycleStart = now
	s.currentCycle = cycleDurations{}
}

// Run starts the generator loop and sends points to out channel until ctx is done.
func (s *Service) Run(ctx context.Context, out chan<- domain.DataPoint) {
	interval := time.Duration(s.config.Intervals.GenerationIntervalSec) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case t := <-ticker.C:
			p := s.Generate(t)
			select {
			case out <- p:
			case <-ctx.Done():
				return
			}
		}
	}
}

