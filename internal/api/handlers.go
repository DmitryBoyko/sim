package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sim/internal/domain"
	"sim/internal/repository"
	"sim/internal/service/analysis"
	"sim/internal/service/generator"
	"sim/internal/service/queue"
	"sim/internal/service/recognition"
	"sim/internal/service/vector"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// Server holds dependencies and exposes HTTP handlers.
type Server struct {
	ParamsRepo    *repository.ParamsRepository
	OperRepo      *repository.OperationalRepository
	TemplatesRepo *repository.TemplatesRepository
	TripsRepo     *repository.TripsRepository
	JobsRepo      *repository.JobsRepository
	LogsRepo      *repository.LogsRepository
	JobRegistry   *JobRegistry
	Generator     *generator.Service
	Queue         *queue.Queue
	Recognition   *recognition.Service
	Hub               *Hub
	genMu             sync.Mutex
	genCancelFn       context.CancelFunc
	genRunning        bool
	sessionMu         sync.RWMutex
	sessionStartedAt  *time.Time
}

// GetSettings returns current app settings from DB.
func (s *Server) GetSettings(c *gin.Context) {
	ctx := c.Request.Context()
	settings, err := s.ParamsRepo.GetSettings(ctx)
	if err != nil {
		log.Printf("[api] GetSettings: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

// PutSettings saves settings to DB and updates in-memory services.
func (s *Server) PutSettings(c *gin.Context) {
	ctx := c.Request.Context()
	var settings domain.AppSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.ParamsRepo.SaveSettings(ctx, &settings); err != nil {
		log.Printf("[api] PutSettings: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.Generator.UpdateConfig(&settings)
	s.Recognition.UpdateConfig(settings.Recognition.MatchThresholdPercent, settings.Recognition.Enabled, settings.Recognition.CooldownAfterTripSec, settings.Recognition.SpeedBaselineKmh, settings.Recognition.WeightBaselineTon, settings.Recognition.UseZNormalization)
	if settings.Recognition.UseZNormalization {
		if n, err := s.TemplatesRepo.EnsureZVectors(ctx, vector.BuildVectorZ); err != nil {
			log.Printf("[api] PutSettings EnsureZVectors: %v", err)
		} else if n > 0 {
			log.Printf("[api] PutSettings: заполнено zvector для %d шаблонов", n)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ControlStart starts the generator.
func (s *Server) ControlStart(c *gin.Context) {
	s.genMu.Lock()
	if s.genRunning {
		s.genMu.Unlock()
		c.JSON(http.StatusOK, gin.H{"ok": true, "message": "already running"})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.genCancelFn = cancel
	ch := make(chan domain.DataPoint, 64)
	go s.Generator.Run(ctx, ch)
	go s.Queue.Run(ctx, ch)
	s.genRunning = true
	now := time.Now()
	s.sessionMu.Lock()
	s.sessionStartedAt = &now
	s.sessionMu.Unlock()
	s.genMu.Unlock()
	log.Printf("[api] simulation started at %s", now.Format(time.RFC3339))
	s.Hub.BroadcastGeneratorStatus(true)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ControlStop stops the generator.
func (s *Server) ControlStop(c *gin.Context) {
	s.genMu.Lock()
	if !s.genRunning {
		s.genMu.Unlock()
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	s.genCancelFn()
	s.genRunning = false
	s.genMu.Unlock()
	s.Hub.BroadcastGeneratorStatus(false)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// IsGeneratorRunning returns whether the generator is currently running (for analysis broadcast).
func (s *Server) IsGeneratorRunning() bool {
	s.genMu.Lock()
	defer s.genMu.Unlock()
	return s.genRunning
}

// ControlClear clears queue, operational data, and recognition window.
func (s *Server) ControlClear(c *gin.Context) {
	ctx := c.Request.Context()
	s.Queue.Clear()
	s.Recognition.Clear()
	if err := s.OperRepo.Clear(ctx); err != nil {
		log.Printf("[api] ControlClear: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.Generator.ResetCycle(time.Now())
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DataOperationalStats returns session and operational statistics for the Simulation page.
func (s *Server) DataOperationalStats(c *gin.Context) {
	ctx := c.Request.Context()
	s.genMu.Lock()
	running := s.genRunning
	s.genMu.Unlock()
	s.sessionMu.RLock()
	sessionStartedAt := s.sessionStartedAt
	s.sessionMu.RUnlock()

	var lastStartedAt *time.Time
	if sessionStartedAt != nil {
		t := *sessionStartedAt
		lastStartedAt = &t
	}

	pointsSinceStart := int64(0)
	tripsSinceStart := int64(0)
	var lastTripAt *time.Time
	if sessionStartedAt != nil {
		var err error
		pointsSinceStart, err = s.OperRepo.CountSince(ctx, *sessionStartedAt)
		if err != nil {
			log.Printf("[api] DataOperationalStats CountSince points: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		tripsSinceStart, err = s.TripsRepo.CountSince(ctx, *sessionStartedAt)
		if err != nil {
			log.Printf("[api] DataOperationalStats CountSince trips: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		lastTripAt, err = s.TripsRepo.LastCreatedAt(ctx)
		if err != nil {
			log.Printf("[api] DataOperationalStats LastCreatedAt: %v", err)
		}
	}

	activeJobs, err := s.JobsRepo.CountActive(ctx)
	if err != nil {
		log.Printf("[api] DataOperationalStats CountActive: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	heapAllocMB := float64(memStats.HeapAlloc) / (1024 * 1024)
	sysMB := float64(memStats.Sys) / (1024 * 1024)
	numGoroutine := runtime.NumGoroutine()

	// Светофор по ресурсам: green — норма, yellow — насторожиться, red — на пределе.
	const heapGreenMB, heapYellowMB = 150, 400   // HeapAlloc
	const goroutineGreen, goroutineYellow = 100, 300
	memoryStatus := "green"
	if heapAllocMB > heapYellowMB {
		memoryStatus = "red"
	} else if heapAllocMB > heapGreenMB {
		memoryStatus = "yellow"
	}
	goroutinesStatus := "green"
	if numGoroutine > goroutineYellow {
		goroutinesStatus = "red"
	} else if numGoroutine > goroutineGreen {
		goroutinesStatus = "yellow"
	}
	resourceStatus := "green"
	if memoryStatus == "red" || goroutinesStatus == "red" {
		resourceStatus = "red"
	} else if memoryStatus == "yellow" || goroutinesStatus == "yellow" {
		resourceStatus = "yellow"
	}

	out := gin.H{
		"running":             running,
		"points_since_start":  pointsSinceStart,
		"trips_since_start":   tripsSinceStart,
		"active_jobs_count":   activeJobs,
		"memory_alloc_mb":     round2(heapAllocMB),
		"memory_sys_mb":      round2(sysMB),
		"num_goroutine":      numGoroutine,
		"memory_status":      memoryStatus,
		"goroutines_status":   goroutinesStatus,
		"resource_status":    resourceStatus,
	}
	if lastStartedAt != nil {
		out["last_started_at"] = lastStartedAt.Format(time.RFC3339)
	}
	if lastTripAt != nil {
		out["last_trip_at"] = lastTripAt.Format(time.RFC3339)
	}
	c.JSON(http.StatusOK, out)
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

// DataOperational returns last N minutes: from in-memory queue if available, else from DB.
func (s *Server) DataOperational(c *gin.Context) {
	ctx := c.Request.Context()
	minutes := 30
	if m := c.Query("minutes"); m != "" {
		if n, err := strconv.Atoi(m); err == nil && n > 0 {
			minutes = n
		}
	}
	points := s.Queue.Snapshot()
	if len(points) == 0 {
		var err error
		points, err = s.OperRepo.LastMinutes(ctx, minutes)
		if err != nil {
			log.Printf("[api] DataOperational: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"points": points})
}

// TemplatesList returns templates (with has_vector). Optional query: limit, offset for pagination; then total is returned.
func (s *Server) TemplatesList(c *gin.Context) {
	ctx := c.Request.Context()
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit < 0 {
		limit = 0
	}
	if offset < 0 {
		offset = 0
	}
	if limit > 0 {
		list, total, err := s.TemplatesRepo.ListWithPagination(ctx, limit, offset)
		if err != nil {
			log.Printf("[api] TemplatesList: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"templates": list, "total": total})
		return
	}
	list, err := s.TemplatesRepo.List(ctx)
	if err != nil {
		log.Printf("[api] TemplatesList: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"templates": list})
}

// TemplatesGet returns one template by ID (with raw_speed, raw_weight for view).
func (s *Server) TemplatesGet(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	t, hasVector, err := s.TemplatesRepo.GetByID(ctx, id)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[api] TemplatesGet: %v", err)
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"template": t, "has_vector": hasVector})
}

// TemplatesUpdate updates template name and/or narrows range (from_index, to_index).
func (s *Server) TemplatesUpdate(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	var body struct {
		Name      string `json:"name"`
		FromIndex *int   `json:"from_index"`
		ToIndex   *int   `json:"to_index"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	buildBoth := func(speed, weight []float64) ([]float64, []float64) {
		return vector.BuildVectorFromSeries(speed, weight), vector.BuildVectorZ(speed, weight)
	}
	if err := s.TemplatesRepo.Update(ctx, id, body.Name, body.FromIndex, body.ToIndex, buildBoth); err != nil {
		log.Printf("[api] TemplatesUpdate: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = s.Recognition.RefreshTemplates(ctx)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// TemplatesCreate saves a new template from selected points.
func (s *Server) TemplatesCreate(c *gin.Context) {
	ctx := c.Request.Context()
	var body struct {
		Name   string          `json:"name"`
		Points []domain.DataPoint `json:"points"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Name == "" || len(body.Points) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and points required"})
		return
	}
	speeds := make([]float64, len(body.Points))
	weights := make([]float64, len(body.Points))
	times := make([]time.Time, len(body.Points))
	for i, p := range body.Points {
		speeds[i] = p.Speed
		weights[i] = p.Weight
		times[i] = p.T
	}
	vec := vector.BuildVectorFromSeries(speeds, weights)
	zvec := vector.BuildVectorZ(speeds, weights)
	id, err := s.TemplatesRepo.Create(ctx, body.Name, speeds, weights, times, vec, zvec)
	if err != nil {
		log.Printf("[api] TemplatesCreate: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.Recognition.RefreshTemplates(ctx); err != nil {
		log.Printf("[api] TemplatesCreate RefreshTemplates: %v", err)
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

// TemplatesDelete deletes a template.
func (s *Server) TemplatesDelete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	if err := s.TemplatesRepo.Delete(ctx, id); err != nil {
		log.Printf("[api] TemplatesDelete: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = s.Recognition.RefreshTemplates(ctx)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// runAnalysisForTrip выполняет анализ фаз и веса по точкам рейса и обновляет БД. Синхронно.
func (s *Server) runAnalysisForTrip(ctx context.Context, tripID string, startedAt, endedAt time.Time, settings *domain.AppSettings) error {
	if settings == nil {
		var err error
		settings, err = s.ParamsRepo.GetSettings(ctx)
		if err != nil {
			return err
		}
	}
	points, err := s.OperRepo.History(ctx, startedAt, endedAt)
	if err != nil {
		return err
	}
	analysisPoints := analysis.DataPointsToAnalysisPoints(points)
	cfg := analysis.FromSettings(settings.Analysis,
		settings.Recognition.SpeedBaselineKmh,
		settings.Recognition.WeightBaselineTon,
		settings.SpeedWeight.MEmptyTon)
	result := analysis.AnalyzeTrip(analysisPoints, cfg)
	domainPhases := analysis.ToDomainPhases(result.Phases)
	return s.TripsRepo.UpdatePayloadAndPhases(ctx, tripID, result.PayloadTon, domainPhases)
}

// RunAnalysisAndBroadcast выполняет анализ фаз и веса рейса в горутине, обновляет БД и рассылает trip_found.
// Не блокирует основную логику; ошибки логируются.
func (s *Server) RunAnalysisAndBroadcast(ctx context.Context, t domain.DetectedTrip) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[api] RunAnalysisAndBroadcast panic: %v", r)
			}
		}()
		bg := context.Background()
		if err := s.runAnalysisForTrip(bg, t.ID, t.StartedAt, t.EndedAt, nil); err != nil {
			log.Printf("[api] RunAnalysisAndBroadcast: %v", err)
			s.Hub.BroadcastTripFound(t)
			return
		}
		payloadTon := 0.0
		phases, _ := s.TripsRepo.GetPhasesByTripID(bg, t.ID)
		if trip, _ := s.TripsRepo.GetByID(bg, t.ID); trip != nil && trip.PayloadTon != nil {
			payloadTon = *trip.PayloadTon
		}
		t.PayloadTon = &payloadTon
		t.AnalysisPhases = phases
		s.Hub.BroadcastTripFound(t)
	}()
}

// TripsList returns detected trips (with payload_ton).
func (s *Server) TripsList(c *gin.Context) {
	ctx := c.Request.Context()
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		if t, err := time.Parse(time.RFC3339, f); err == nil {
			from = &t
		}
	}
	if t := c.Query("to"); t != "" {
		if t2, err := time.Parse(time.RFC3339, t); err == nil {
			to = &t2
		}
	}
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	list, err := s.TripsRepo.List(ctx, from, to, limit)
	if err != nil {
		log.Printf("[api] TripsList: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": list})
}

// TripsPhases returns phases and payload for a trip. GET /api/trips/:id/phases
func (s *Server) TripsPhases(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	trip, err := s.TripsRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		log.Printf("[api] TripsPhases GetByID: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	phases, err := s.TripsRepo.GetPhasesByTripID(ctx, id)
	if err != nil {
		log.Printf("[api] TripsPhases GetPhasesByTripID: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	payloadTon := 0.0
	if trip.PayloadTon != nil {
		payloadTon = *trip.PayloadTon
	}
	c.JSON(http.StatusOK, gin.H{
		"trip_id":     id,
		"payload_ton": payloadTon,
		"phases":      phases,
	})
}

// TripsDeleteAll deletes all detected trips.
func (s *Server) TripsDeleteAll(c *gin.Context) {
	ctx := c.Request.Context()
	if err := s.TripsRepo.DeleteAll(ctx); err != nil {
		log.Printf("[api] TripsDeleteAll: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// History returns data and trips for a time range.
func (s *Server) History(c *gin.Context) {
	ctx := c.Request.Context()
	fromStr, toStr := c.Query("from"), c.Query("to")
	if fromStr == "" || toStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from and to (RFC3339) required"})
		return
	}
	from, err1 := time.Parse(time.RFC3339, fromStr)
	to, err2 := time.Parse(time.RFC3339, toStr)
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from/to"})
		return
	}
	points, err := s.OperRepo.History(ctx, from, to)
	if err != nil {
		log.Printf("[api] History: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	trFrom, trTo := &from, &to
	trips, err := s.TripsRepo.List(ctx, trFrom, trTo, 0)
	if err != nil {
		log.Printf("[api] History trips: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"points": points, "trips": trips})
}

// RecognitionAnalysis returns current analysis state (sliding window, loaded templates, comparisons).
func (s *Server) RecognitionAnalysis(c *gin.Context) {
	state := s.Recognition.GetAnalysisState()
	c.JSON(http.StatusOK, state)
}

// JobsRecalculateTrips starts a background job to recalculate trips for the given range.
// Body: { "from": "RFC3339", "to": "RFC3339" }. Returns job id; progress via GET /api/jobs/:id.
func (s *Server) JobsRecalculateTrips(c *gin.Context) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.From == "" || body.To == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from and to (RFC3339) required"})
		return
	}
	from, err1 := time.Parse(time.RFC3339, body.From)
	to, err2 := time.Parse(time.RFC3339, body.To)
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from/to"})
		return
	}
	if from.After(to) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from must be before to"})
		return
	}
	ctx := c.Request.Context()
	active, err := s.JobsRepo.GetActiveByKind(ctx, repository.JobKindRecalculateTrips)
	if err != nil {
		log.Printf("[api] JobsRecalculateTrips GetActiveByKind: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if active != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "recalculate job already running", "job_id": active.ID})
		return
	}
	payload := map[string]string{"from": body.From, "to": body.To}
	jobID, err := s.JobsRepo.Create(ctx, repository.JobKindRecalculateTrips, payload)
	if err != nil {
		log.Printf("[api] JobsRecalculateTrips Create: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	jobCtx, jobCancel := s.JobRegistry.Register(jobID)
	go func() {
		defer func() {
			jobCancel()
			s.JobRegistry.Remove(jobID)
		}()
		s.runRecalculateTripsJob(jobCtx, jobID, from, to)
	}()
	c.JSON(http.StatusAccepted, gin.H{"job_id": jobID})
}

func (s *Server) runRecalculateTripsJob(ctx context.Context, jobID string, from, to time.Time) {
	// Load settings and templates once at start
	settings, err := s.ParamsRepo.GetSettings(ctx)
	if err != nil {
		log.Printf("[api] runRecalculateTripsJob load settings: %v", err)
		_ = s.JobsRepo.Fail(ctx, jobID, "load settings: "+err.Error())
		return
	}
	threshold := settings.Recognition.MatchThresholdPercent
	cooldownSec := settings.Recognition.CooldownAfterTripSec
	if cooldownSec < 0 {
		cooldownSec = 0
	}
	points, err := s.OperRepo.History(ctx, from, to)
	if err != nil {
		log.Printf("[api] runRecalculateTripsJob load history: %v", err)
		_ = s.JobsRepo.Fail(ctx, jobID, "load history: "+err.Error())
		return
	}
	total := int64(len(points))
	if err := s.JobsRepo.Start(ctx, jobID, total); err != nil {
		log.Printf("[api] runRecalculateTripsJob Start: %v", err)
		return
	}
	if total == 0 {
		_ = s.JobsRepo.Complete(ctx, jobID)
		return
	}
	if err := s.TripsRepo.DeleteInRange(ctx, from, to); err != nil {
		log.Printf("[api] runRecalculateTripsJob DeleteInRange: %v", err)
		_ = s.JobsRepo.Fail(ctx, jobID, "delete trips in range: "+err.Error())
		return
	}
	provider := &TemplateProviderAdapter{Repo: s.TemplatesRepo}
	saver := &TripSaverAdapter{Repo: s.TripsRepo}
	lastReport := time.Now()
	reportInterval := 200 * time.Millisecond
	speedBaseline := settings.Recognition.SpeedBaselineKmh
	weightBaseline := settings.Recognition.WeightBaselineTon
	useZNorm := settings.Recognition.UseZNormalization
	if err := recognition.RunBatchWithTemplates(ctx, points, provider, threshold, cooldownSec, speedBaseline, weightBaseline, useZNorm, saver, func(processed, totalItems int) {
		if totalItems == 0 {
			return
		}
		pct := 100 * float64(processed) / float64(totalItems)
		if time.Since(lastReport) >= reportInterval || processed == totalItems {
			lastReport = time.Now()
			_ = s.JobsRepo.UpdateProgress(ctx, jobID, int64(processed), pct)
		}
	}); err != nil {
		log.Printf("[api] runRecalculateTripsJob RunBatchWithTemplates: %v", err)
		_ = s.JobsRepo.Fail(ctx, jobID, "run batch: "+err.Error())
		return
	}
	if ctx.Err() != nil {
		log.Printf("[api] runRecalculateTripsJob cancelled job_id=%s", jobID)
		_ = s.JobsRepo.Cancel(ctx, jobID, "Отменён пользователем")
		return
	}
	// Анализ фаз и веса для каждого найденного рейса в диапазоне
	tripsInRange, err := s.TripsRepo.List(ctx, &from, &to, 0)
	if err == nil {
		for _, tr := range tripsInRange {
			if ctx.Err() != nil {
				break
			}
			_ = s.runAnalysisForTrip(ctx, tr.ID, tr.StartedAt, tr.EndedAt, settings)
		}
	}
	_ = s.JobsRepo.Complete(ctx, jobID)
}

// JobByID returns a job by ID.
func (s *Server) JobByID(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	job, err := s.JobsRepo.GetByID(ctx, id)
	if err != nil {
		log.Printf("[api] JobByID: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, job)
}

// JobActive returns the active (pending/running) job for the given kind. Query: kind=recalculate_trips.
func (s *Server) JobActive(c *gin.Context) {
	ctx := c.Request.Context()
	kind := c.Query("kind")
	if kind == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind required"})
		return
	}
	job, err := s.JobsRepo.GetActiveByKind(ctx, kind)
	if err != nil {
		log.Printf("[api] JobActive: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if job == nil {
		c.JSON(http.StatusOK, gin.H{"job": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

// JobList returns jobs, optionally filtered by status. Query: status=running,pending (comma-sep), limit=50.
func (s *Server) JobList(c *gin.Context) {
	ctx := c.Request.Context()
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	var statuses []string
	if s := c.Query("status"); s != "" {
		for _, v := range strings.Split(s, ",") {
			v = strings.TrimSpace(v)
			if v != "" {
				statuses = append(statuses, v)
			}
		}
	}
	list, err := s.JobsRepo.List(ctx, statuses, limit)
	if err != nil {
		log.Printf("[api] JobList: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": list})
}

// JobCancel cancels a running or pending job by ID.
func (s *Server) JobCancel(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	job, err := s.JobsRepo.GetByID(ctx, id)
	if err != nil {
		log.Printf("[api] JobCancel GetByID: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if job.Status != repository.JobStatusRunning && job.Status != repository.JobStatusPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job is not running or pending"})
		return
	}
	if !s.JobRegistry.CancelAndRemove(id) {
		// Job might have just finished; still mark as cancelled in DB if still running
		_ = s.JobsRepo.Cancel(ctx, id, "Отменён пользователем")
	} else {
		_ = s.JobsRepo.Cancel(ctx, id, "Отменён пользователем")
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// JobDeleteCompleted permanently deletes all jobs with status completed.
func (s *Server) JobDeleteCompleted(c *gin.Context) {
	ctx := c.Request.Context()
	deleted, err := s.JobsRepo.DeleteByStatus(ctx, repository.JobStatusCompleted)
	if err != nil {
		log.Printf("[api] JobDeleteCompleted: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": deleted})
}

// JobDelete permanently deletes a job by ID. Only completed jobs can be deleted.
func (s *Server) JobDelete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id required"})
		return
	}
	err := s.JobsRepo.Delete(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found or not completed"})
			return
		}
		log.Printf("[api] JobDelete: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// LogsList returns log entries for the given period. Query: from, to (RFC3339), source (backend|frontend), order (asc|desc), limit.
func (s *Server) LogsList(c *gin.Context) {
	ctx := c.Request.Context()
	var from, to *time.Time
	if f := c.Query("from"); f != "" {
		if t, err := time.Parse(time.RFC3339, f); err == nil {
			from = &t
		}
	}
	if t := c.Query("to"); t != "" {
		if t2, err := time.Parse(time.RFC3339, t); err == nil {
			to = &t2
		}
	}
	source := c.Query("source")
	if source != "" && source != repository.LogSourceBackend && source != repository.LogSourceFrontend {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source must be backend or frontend"})
		return
	}
	order := c.DefaultQuery("order", "desc")
	if order != "asc" && order != "desc" {
		order = "desc"
	}
	limit := 500
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	list, err := s.LogsRepo.List(ctx, repository.ListLogsParams{
		From:   from,
		To:     to,
		Source: source,
		Order:  order,
		Limit:  limit,
	})
	if err != nil {
		log.Printf("[api] LogsList: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"logs": list})
}

// LogsCreate accepts a log entry from the frontend (source is forced to "frontend"). Body: { "level": "info"|"warn"|"error", "message": "...", "payload": {} }.
func (s *Server) LogsCreate(c *gin.Context) {
	ctx := c.Request.Context()
	var body struct {
		Level   string          `json:"level"`
		Message string          `json:"message"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(body.Message) > 65536 {
		body.Message = body.Message[:65536]
	}
	level := body.Level
	if level == "" {
		level = repository.LogLevelInfo
	}
	if level != repository.LogLevelInfo && level != repository.LogLevelWarn && level != repository.LogLevelErr {
		level = repository.LogLevelInfo
	}
	if err := s.LogsRepo.Insert(ctx, repository.LogSourceFrontend, level, body.Message, body.Payload); err != nil {
		log.Printf("[api] LogsCreate: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// LogsDelete deletes log entries in the given date range. Query: from, to (RFC3339), both required.
func (s *Server) LogsDelete(c *gin.Context) {
	ctx := c.Request.Context()
	f := c.Query("from")
	t := c.Query("to")
	if f == "" || t == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from and to (RFC3339) are required"})
		return
	}
	from, err := time.Parse(time.RFC3339, f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from: " + err.Error()})
		return
	}
	to, err := time.Parse(time.RFC3339, t)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to: " + err.Error()})
		return
	}
	if from.After(to) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from must be before or equal to to"})
		return
	}
	deleted, err := s.LogsRepo.DeleteByDateRange(ctx, from, to)
	if err != nil {
		log.Printf("[api] LogsDelete: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": deleted})
}

// Allowed doc paths (relative to working dir). No path traversal.
var allowedDocPaths = map[string]bool{
	"README.md":            true,
	"docs/API.md":          true,
	"docs/ARCHITECTURE.md": true,
	"docs/MATH.md":         true,
}

// DocsGet returns raw markdown for a whitelisted file. Query: file=README.md | docs/API.md | docs/ARCHITECTURE.md | docs/MATH.md.
func (s *Server) DocsGet(c *gin.Context) {
	file := c.Query("file")
	if file == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file query is required"})
		return
	}
	// Normalize: only allow exact keys (no path traversal)
	clean := filepath.Clean(file)
	if clean != file || filepath.IsAbs(clean) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}
	if !allowedDocPaths[clean] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file not allowed"})
		return
	}
	base, err := os.Getwd()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot get working directory"})
		return
	}
	fpath := filepath.Join(base, filepath.Clean(file))
	// Ensure path stays under base (no .. escape)
	abs, err := filepath.Abs(fpath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	baseAbs, _ := filepath.Abs(base)
	if baseAbs != "" && !strings.HasPrefix(abs, baseAbs+string(filepath.Separator)) && abs != baseAbs {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}
	content, err := os.ReadFile(fpath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		log.Printf("[api] DocsGet %q: %v", file, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"content": string(content)})
}
