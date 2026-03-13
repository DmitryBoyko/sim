package analysis

import (
	"math"
	"sim/internal/domain"
	"sort"
	"time"
)

// Point — точка рейса для анализа (время, скорость, вес).
type Point struct {
	T      time.Time
	Speed  float64
	Weight float64
}

// TripPhase — результат фазы рейса.
type TripPhase struct {
	PhaseType   string
	StartedAt   time.Time
	EndedAt     time.Time
	DurationSec int
	AvgSpeedKmh  float64
	AvgWeightTon float64
	PointCount  int
	SortOrder   int
}

// AnalysisResult — результат анализа рейса.
type AnalysisResult struct {
	PayloadTon float64
	Phases     []TripPhase
}

// Phase type constants (DB/API).
const (
	PhaseLoading   = "loading"
	PhaseTransport = "transport"
	PhaseUnloading = "unloading"
	PhaseReturn    = "return"
)

// Config — параметры анализа.
type Config struct {
	PlateauHalfWindow        int
	PlateauNoiseToleranceTon float64
	PayloadThresholdTon     float64
	MinPhasePoints          int
	SpeedBaselineKmh        float64
	WeightBaselineTon       float64
	MEmptyTon               float64
	PlateauEdgeDilationEnabled bool
	PlateauGapClosingEnabled   bool
	PlateauMaxGapPoints        int
}

// DefaultConfig возвращает конфиг по умолчанию.
func DefaultConfig() Config {
	return Config{
		PlateauHalfWindow:        3,
		PlateauNoiseToleranceTon: 4,
		PayloadThresholdTon:      20,
		MinPhasePoints:           2,
		PlateauEdgeDilationEnabled: true,
		PlateauGapClosingEnabled:   true,
		PlateauMaxGapPoints:        5,
	}
}

// FromSettings строит Config из настроек приложения.
func FromSettings(analysis domain.AnalysisConfig, speedBaseline, weightBaseline, mEmptyTon float64) Config {
	c := DefaultConfig()
	if analysis.PlateauHalfWindow > 0 {
		c.PlateauHalfWindow = analysis.PlateauHalfWindow
	}
	if analysis.PlateauNoiseToleranceTon > 0 {
		c.PlateauNoiseToleranceTon = analysis.PlateauNoiseToleranceTon
	}
	if analysis.PayloadThresholdTon > 0 {
		c.PayloadThresholdTon = analysis.PayloadThresholdTon
	}
	if analysis.MinPhasePoints > 0 {
		c.MinPhasePoints = analysis.MinPhasePoints
	}
	c.SpeedBaselineKmh = speedBaseline
	c.WeightBaselineTon = weightBaseline
	c.MEmptyTon = mEmptyTon
	// plateau_edge_dilation_enabled управляется флагом в настройках; по умолчанию включён.
	c.PlateauEdgeDilationEnabled = analysis.PlateauEdgeDilationEnabled
	// closing разрывов плато и максимальная длина разрыва
	if analysis.PlateauGapClosingEnabled {
		c.PlateauGapClosingEnabled = true
	}
	if analysis.PlateauMaxGapPoints > 0 {
		c.PlateauMaxGapPoints = analysis.PlateauMaxGapPoints
	}
	return c
}

// AnalyzeTrip анализирует точки рейса: определяет фазы (plateau detection или пороговый метод) и считает вес груза.
func AnalyzeTrip(points []Point, cfg Config) AnalysisResult {
	if len(points) == 0 {
		return AnalysisResult{}
	}
	startedAt := points[0].T
	endedAt := points[len(points)-1].T

	// Слишком мало точек — один блок "transport", payload по медиане веса минус порожний.
	if len(points) < 3 {
		w := medianWeights(points)
		payload := w - cfg.MEmptyTon
		if payload < 0 {
			payload = 0
		}
		ph := buildPhaseFromPoints(PhaseTransport, points, 1)
		if ph != nil {
			ph.StartedAt = startedAt
			ph.EndedAt = endedAt
			ph.DurationSec = int(endedAt.Sub(startedAt).Seconds())
			return AnalysisResult{PayloadTon: payload, Phases: []TripPhase{*ph}}
		}
		return AnalysisResult{PayloadTon: payload}
	}

	phases, payload, ok := tryPlateauDetection(points, cfg)
	if ok {
		return AnalysisResult{PayloadTon: payload, Phases: phases}
	}
	phases, payload = fallbackThresholdMethod(points, cfg)
	return AnalysisResult{PayloadTon: payload, Phases: phases}
}

func tryPlateauDetection(points []Point, cfg Config) ([]TripPhase, float64, bool) {
	w := cfg.PlateauHalfWindow
	eps := cfg.PlateauNoiseToleranceTon
	if eps <= 0 {
		eps = 4
	}
	mThreshold := cfg.PayloadThresholdTon
	if mThreshold <= 0 {
		mThreshold = cfg.MEmptyTon + 20
	}

	// Шаг 1: для каждой точки — скользящее std веса
	isOnPlateau := make([]bool, len(points))
	for i := range points {
		lo := max(0, i-w)
		hi := min(len(points)-1, i+w)
		sigma := stdWeight(points[lo : hi+1])
		isOnPlateau[i] = sigma < eps
	}

	// Шаг 1.1: морфологическое замыкание (closing) — заполняем короткие разрывы внутри плато.
	if cfg.PlateauGapClosingEnabled && len(isOnPlateau) > 0 {
		maxGap := cfg.PlateauMaxGapPoints
		if maxGap <= 0 {
			maxGap = 5
		}
		// Находим опорный вес плато по стабильным точкам на краях плато.
		var plateauWeights []float64
		const edgeK = 3
		// левый край
		left := -1
		for i, on := range isOnPlateau {
			if on {
				left = i
				break
			}
		}
		// правый край
		right := -1
		for i := len(isOnPlateau) - 1; i >= 0; i-- {
			if isOnPlateau[i] {
				right = i
				break
			}
		}
		if left >= 0 && right >= 0 && left < right {
			for k := 0; k < edgeK; k++ {
				idxL := left + k
				if idxL >= 0 && idxL < len(points) {
					plateauWeights = append(plateauWeights, points[idxL].Weight)
				}
				idxR := right - k
				if idxR >= 0 && idxR < len(points) {
					plateauWeights = append(plateauWeights, points[idxR].Weight)
				}
			}
		}
		if len(plateauWeights) > 0 {
			ref := median(plateauWeights)
			tol := cfg.PlateauNoiseToleranceTon * 2
			if tol <= 0 {
				tol = 8 // консервативный допуск по умолчанию
			}
			isOnPlateau = closePlateauGaps(points, isOnPlateau, maxGap, ref, tol)
		}
	}

	// Шаг 1.5: опциональная коррекция краёв плато (дилатация) по уровню веса и "стоячей" скорости.
	if cfg.PlateauEdgeDilationEnabled && cfg.SpeedBaselineKmh > 0 {
		// Оценка среднего веса высокого плато по текущей маске.
		var sum float64
		var count int
		for i, on := range isOnPlateau {
			if !on {
				continue
			}
			if points[i].Weight <= mThreshold {
				continue
			}
			sum += points[i].Weight
			count++
		}
		if count > 0 {
			plateauAvgWeight := sum / float64(count)
			isOnPlateau = dilatePlateauEdges(points, isOnPlateau, plateauAvgWeight, cfg.PlateauNoiseToleranceTon, cfg.SpeedBaselineKmh)
		}
	}

	// Шаг 2: непрерывные участки плато и их средний вес
	plateaus := extractPlateaus(points, isOnPlateau)
	if len(plateaus) == 0 {
		return nil, 0, false
	}

	// Классификация: высокое плато (transport) vs низкое (return).
	// Собираем ВСЕ высокие сегменты, а не только первый, чтобы
	// фрагментированное плато (с короткими провалами) учитывалось целиком.
	var highPlateaus []plateauSegment
	for i := range plateaus {
		seg := &plateaus[i]
		seg.avgWeight = avgWeight(seg.points)
		if seg.avgWeight > mThreshold {
			highPlateaus = append(highPlateaus, *seg)
		}
	}
	if len(highPlateaus) == 0 {
		return nil, 0, false
	}

	// Объединённое "высокое плато": от начала первого до конца последнего сегмента.
	firstHigh := highPlateaus[0]
	lastHigh := highPlateaus[len(highPlateaus)-1]
	var transportPoints []Point
	for _, seg := range highPlateaus {
		transportPoints = append(transportPoints, seg.points...)
	}

	// Шаг 3: фазы по расположению высокого плато
	startedAt := points[0].T
	endedAt := points[len(points)-1].T
	tStart := firstHigh.points[0].T
	tEnd := lastHigh.points[len(lastHigh.points)-1].T

	var phases []TripPhase
	sortOrder := 1

	// loading: [startedAt .. tStart]
	if tStart.After(startedAt) {
		loadingPoints := pointsInRange(points, startedAt, tStart)
		if len(loadingPoints) >= cfg.MinPhasePoints {
			ph := buildPhaseFromPoints(PhaseLoading, loadingPoints, sortOrder)
			if ph != nil {
				ph.StartedAt = startedAt
				ph.EndedAt = tStart
				ph.DurationSec = int(tStart.Sub(startedAt).Seconds())
				phases = append(phases, *ph)
				sortOrder++
			}
		}
	}

	// transport: [tStart .. tEnd]
	ph := buildPhaseFromPoints(PhaseTransport, transportPoints, sortOrder)
	if ph != nil {
		ph.StartedAt = tStart
		ph.EndedAt = tEnd
		ph.DurationSec = int(tEnd.Sub(tStart).Seconds())
		phases = append(phases, *ph)
		sortOrder++
	}

	// unloading: от tEnd до начала следующего низкого плато или до конца
	afterTransport := pointsAfter(points, tEnd)
	var unloadingEnd time.Time
	var returnPoints []Point
	if len(afterTransport) == 0 {
		unloadingEnd = endedAt
	} else {
		// Ищем конец падения веса (низкое плато)
		for _, seg := range plateaus {
			if seg.avgWeight <= mThreshold && seg.points[0].T.After(tEnd) {
				unloadingEnd = seg.points[0].T
				returnPoints = seg.points
				break
			}
		}
		if unloadingEnd.IsZero() {
			unloadingEnd = endedAt
			returnPoints = afterTransport
		}
	}
	unloadingPoints := pointsInRange(points, tEnd, unloadingEnd)
	if len(unloadingPoints) >= cfg.MinPhasePoints {
		ph := buildPhaseFromPoints(PhaseUnloading, unloadingPoints, sortOrder)
		if ph != nil {
			ph.StartedAt = tEnd
			ph.EndedAt = unloadingEnd
			ph.DurationSec = int(unloadingEnd.Sub(tEnd).Seconds())
			phases = append(phases, *ph)
			sortOrder++
		}
	}

	// return: [unloadingEnd .. endedAt]
	if unloadingEnd.Before(endedAt) {
		retPoints := pointsInRange(points, unloadingEnd, endedAt)
		if len(retPoints) < cfg.MinPhasePoints && len(returnPoints) > 0 {
			retPoints = returnPoints
		}
		if len(retPoints) >= cfg.MinPhasePoints {
			ph := buildPhaseFromPoints(PhaseReturn, retPoints, sortOrder)
			if ph != nil {
				ph.StartedAt = unloadingEnd
				ph.EndedAt = endedAt
				ph.DurationSec = int(endedAt.Sub(unloadingEnd).Seconds())
				phases = append(phases, *ph)
			}
		}
	}

	// Payload: медиана(transport) − медиана(return)
	transportWeights := make([]float64, len(transportPoints))
	for i, p := range transportPoints {
		transportWeights[i] = p.Weight
	}
	medianTransport := median(transportWeights)
	medianReturn := cfg.MEmptyTon
	for _, ph := range phases {
		if ph.PhaseType == PhaseReturn {
			// пересчитать medianReturn по точкам return-фазы
			var ws []float64
			for _, p := range points {
				if !p.T.Before(ph.StartedAt) && !p.T.After(ph.EndedAt) {
					ws = append(ws, p.Weight)
				}
			}
			if len(ws) > 0 {
				medianReturn = median(ws)
			}
			break
		}
	}
	payload := medianTransport - medianReturn
	if payload < 0 {
		payload = 0
	}
	return phases, payload, true
}

// closePlateauGaps выполняет условное морфологическое замыкание (closing) бинарной маски плато:
// заполняет разрывы (gaps) шириной ≤ maxGap точек между двумя участками плато,
// если все точки внутри разрыва по весу близки к опорному уровню plateauRef (|w - plateauRef| ≤ tol).
func closePlateauGaps(points []Point, isOnPlateau []bool, maxGap int, plateauRef, tol float64) []bool {
	if maxGap <= 0 || len(isOnPlateau) == 0 || len(points) != len(isOnPlateau) {
		return isOnPlateau
	}
	n := len(isOnPlateau)
	i := 0
	for i < n {
		if isOnPlateau[i] {
			i++
			continue
		}
		// false на краю или после другого false — не разрыв внутри плато
		if i == 0 || !isOnPlateau[i-1] {
			i++
			continue
		}
		// считаем длину разрыва
		gapStart := i
		for i < n && !isOnPlateau[i] {
			i++
		}
		gapEnd := i // первый true после разрыва или конец массива
		gapLen := gapEnd - gapStart
		// внутренний разрыв: справа есть true; и длина в пределах maxGap
		if gapEnd < n && gapLen <= maxGap {
			ok := true
			for j := gapStart; j < gapEnd; j++ {
				if math.Abs(points[j].Weight-plateauRef) > tol {
					ok = false
					break
				}
			}
			if ok {
				for j := gapStart; j < gapEnd; j++ {
					isOnPlateau[j] = true
				}
			}
		}
	}
	return isOnPlateau
}

// dilatePlateauEdges выполняет условную дилатацию границ плато:
// расширяет маску isOnPlateau на несколько точек влево и вправо,
// если точка по уровню веса и скорости "похожа" на плато.
func dilatePlateauEdges(
	points []Point,
	isOnPlateau []bool,
	plateauAvgWeight float64,
	noiseTolerance float64,
	speedBaseline float64,
) []bool {
	if len(points) == 0 || len(points) != len(isOnPlateau) {
		return isOnPlateau
	}
	weightTol := noiseTolerance * 2
	if weightTol <= 0 {
		weightTol = 2 * 4 // fallback к базовому допуску, если что-то пошло не так
	}
	maxExpand := 5

	// Левый край плато.
	leftEdge := -1
	for i, on := range isOnPlateau {
		if on {
			leftEdge = i
			break
		}
	}
	if leftEdge < 0 {
		return isOnPlateau
	}

	// Правый край плато.
	rightEdge := -1
	for i := len(isOnPlateau) - 1; i >= 0; i-- {
		if isOnPlateau[i] {
			rightEdge = i
			break
		}
	}
	if rightEdge < 0 {
		return isOnPlateau
	}

	// Расширение влево.
	expanded := 0
	for i := leftEdge - 1; i >= 0 && expanded < maxExpand; i-- {
		wOk := math.Abs(points[i].Weight-plateauAvgWeight) <= weightTol
		sOk := points[i].Speed <= speedBaseline
		if wOk && sOk {
			isOnPlateau[i] = true
			expanded++
		} else {
			break
		}
	}

	// Расширение вправо.
	expanded = 0
	for i := rightEdge + 1; i < len(points) && expanded < maxExpand; i++ {
		wOk := math.Abs(points[i].Weight-plateauAvgWeight) <= weightTol
		sOk := points[i].Speed <= speedBaseline
		if wOk && sOk {
			isOnPlateau[i] = true
			expanded++
		} else {
			break
		}
	}

	return isOnPlateau
}

type plateauSegment struct {
	points    []Point
	avgWeight float64
}

func extractPlateaus(points []Point, isOnPlateau []bool) []plateauSegment {
	var segs []plateauSegment
	i := 0
	for i < len(points) {
		if !isOnPlateau[i] {
			i++
			continue
		}
		start := i
		for i < len(points) && isOnPlateau[i] {
			i++
		}
		segs = append(segs, plateauSegment{points: points[start:i]})
	}
	return segs
}

func pointsInRange(points []Point, from, to time.Time) []Point {
	var out []Point
	for _, p := range points {
		if !p.T.Before(from) && !p.T.After(to) {
			out = append(out, p)
		}
	}
	return out
}

func pointsAfter(points []Point, after time.Time) []Point {
	var out []Point
	for _, p := range points {
		if p.T.After(after) {
			out = append(out, p)
		}
	}
	return out
}

func buildPhaseFromPoints(phaseType string, points []Point, sortOrder int) *TripPhase {
	if len(points) == 0 {
		return nil
	}
	var sumSpeed, sumWeight float64
	for _, p := range points {
		sumSpeed += p.Speed
		sumWeight += p.Weight
	}
	n := float64(len(points))
	return &TripPhase{
		PhaseType:    phaseType,
		AvgSpeedKmh:  sumSpeed / n,
		AvgWeightTon: sumWeight / n,
		PointCount:   len(points),
		SortOrder:    sortOrder,
	}
}

// fallbackThresholdMethod — пороговый метод с гистерезисом.
func fallbackThresholdMethod(points []Point, cfg Config) ([]TripPhase, float64) {
	const hysteresisCount = 3
	const deltaTon = 2

	mThreshold := cfg.PayloadThresholdTon
	if mThreshold <= 0 {
		mThreshold = cfg.MEmptyTon + 20
	}
	speedBaseline := cfg.SpeedBaselineKmh
	if speedBaseline <= 0 {
		speedBaseline = 5
	}

	currentPhase := PhaseLoading
	confirmCount := 0
	type phaseStart struct {
		phase string
		idx   int
	}
	var phaseStarts []phaseStart
	phaseStarts = append(phaseStarts, phaseStart{PhaseLoading, 0})

	for i := 1; i < len(points); i++ {
		v, m := points[i].Speed, points[i].Weight
		prevM := points[i-1].Weight
		candidate := ""
		if v <= speedBaseline && m > prevM+deltaTon {
			candidate = PhaseLoading
		} else if v > speedBaseline && m > mThreshold {
			candidate = PhaseTransport
		} else if v <= speedBaseline && m < prevM-deltaTon {
			candidate = PhaseUnloading
		} else if v > speedBaseline && m <= mThreshold {
			candidate = PhaseReturn
		}
		if candidate != "" && candidate != currentPhase {
			confirmCount++
			if confirmCount >= hysteresisCount {
				currentPhase = candidate
				phaseStarts = append(phaseStarts, phaseStart{currentPhase, i})
				confirmCount = 0
			}
		} else {
			confirmCount = 0
		}
	}

	// Собрать фазы по сменам: segment k = [phaseStarts[k].idx, phaseStarts[k+1].idx)
	var phases []TripPhase
	for k := 0; k < len(phaseStarts); k++ {
		startIdx := phaseStarts[k].idx
		endIdx := len(points)
		if k+1 < len(phaseStarts) {
			endIdx = phaseStarts[k+1].idx
		}
		seg := points[startIdx:endIdx]
		if len(seg) < cfg.MinPhasePoints {
			continue
		}
		ph := buildPhaseFromPoints(phaseStarts[k].phase, seg, k+1)
		if ph != nil {
			ph.StartedAt = seg[0].T
			ph.EndedAt = seg[len(seg)-1].T
			ph.DurationSec = int(ph.EndedAt.Sub(ph.StartedAt).Seconds())
			phases = append(phases, *ph)
		}
	}

	// Payload: медиана transport − медиана return или mEmpty
	var transportWeights, returnWeights []float64
	for _, ph := range phases {
		for _, p := range points {
			if !p.T.Before(ph.StartedAt) && !p.T.After(ph.EndedAt) {
				switch ph.PhaseType {
				case PhaseTransport:
					transportWeights = append(transportWeights, p.Weight)
				case PhaseReturn:
					returnWeights = append(returnWeights, p.Weight)
				}
			}
		}
	}
	medianTransport := cfg.MEmptyTon
	if len(transportWeights) > 0 {
		medianTransport = median(transportWeights)
	}
	medianReturn := cfg.MEmptyTon
	if len(returnWeights) > 0 {
		medianReturn = median(returnWeights)
	}
	payload := medianTransport - medianReturn
	if payload < 0 {
		payload = 0
	}
	return phases, payload
}

func stdWeight(points []Point) float64 {
	n := float64(len(points))
	if n == 0 {
		return 0
	}
	var sum, sumSq float64
	for _, p := range points {
		sum += p.Weight
		sumSq += p.Weight * p.Weight
	}
	mean := sum / n
	variance := sumSq/n - mean*mean
	if variance < 0 {
		variance = 0
	}
	return math.Sqrt(variance)
}

func avgWeight(points []Point) float64 {
	if len(points) == 0 {
		return 0
	}
	var s float64
	for _, p := range points {
		s += p.Weight
	}
	return s / float64(len(points))
}

func medianWeights(points []Point) float64 {
	ws := make([]float64, len(points))
	for i, p := range points {
		ws[i] = p.Weight
	}
	return median(ws)
}

func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	n := len(sorted)
	if n%2 == 0 {
		return (sorted[n/2-1] + sorted[n/2]) / 2
	}
	return sorted[n/2]
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// DataPointsToAnalysisPoints конвертирует domain.DataPoint в analysis.Point.
func DataPointsToAnalysisPoints(in []domain.DataPoint) []Point {
	out := make([]Point, len(in))
	for i, p := range in {
		out[i] = Point{T: p.T, Speed: p.Speed, Weight: p.Weight}
	}
	return out
}

// ToDomainPhases конвертирует []TripPhase в []domain.TripPhase.
func ToDomainPhases(in []TripPhase) []domain.TripPhase {
	out := make([]domain.TripPhase, len(in))
	for i, p := range in {
		out[i] = domain.TripPhase{
			PhaseType:    p.PhaseType,
			StartedAt:   p.StartedAt,
			EndedAt:     p.EndedAt,
			DurationSec: p.DurationSec,
			AvgSpeedKmh:  p.AvgSpeedKmh,
			AvgWeightTon: p.AvgWeightTon,
			PointCount:   p.PointCount,
			SortOrder:    p.SortOrder,
		}
	}
	return out
}
