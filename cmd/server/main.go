package main

import (
	"context"
	"io"
	"log"
	"os"
	"sim/internal/api"
	"sim/internal/config"
	"sim/internal/db"
	"sim/internal/domain"
	"sim/internal/logger"
	"sim/internal/repository"
	"sim/internal/service/generator"
	"sim/internal/service/queue"
	"sim/internal/service/recognition"
	"time"
)

func main() {
	settings, dsn, err := config.Load()
	if err != nil {
		log.Fatal("config:", err)
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		log.Fatal("db:", err)
	}
	defer pool.Close()

	if err := db.MigrateUp(ctx, pool); err != nil {
		log.Fatal("migrate:", err)
	}

	paramsRepo := repository.NewParamsRepository(pool)
	operRepo := repository.NewOperationalRepository(pool)
	templatesRepo := repository.NewTemplatesRepository(pool)
	tripsRepo := repository.NewTripsRepository(pool)
	jobsRepo := repository.NewJobsRepository(pool)
	logsRepo := repository.NewLogsRepository(pool)
	jobRegistry := api.NewJobRegistry()

	asyncLog := logger.NewAsyncLogWriter(logsRepo)
	asyncLog.Start(ctx)
	log.SetOutput(io.MultiWriter(os.Stderr, asyncLog))

	// Load settings from DB so they override defaults
	dbSettings, err := paramsRepo.GetSettings(ctx)
	if err == nil {
		settings = dbSettings
	}

	hub := api.NewHub()
	gen := generator.NewService(settings)
	chartMinutes := settings.Intervals.ChartMinutes
	if chartMinutes <= 0 {
		chartMinutes = 30
	}
	q := queue.New(time.Duration(chartMinutes) * time.Minute)

	templateProvider := &api.TemplateProviderAdapter{Repo: templatesRepo}
	tripSaver := &api.TripSaverAdapter{Repo: tripsRepo}
	rec := recognition.NewService(templateProvider, tripSaver, settings.Recognition.MatchThresholdPercent)
	_ = rec.RefreshTemplates(ctx)
	rec.UpdateConfig(settings.Recognition.MatchThresholdPercent, settings.Recognition.Enabled, settings.Recognition.CooldownAfterTripSec, settings.Recognition.SpeedBaselineKmh, settings.Recognition.WeightBaselineTon)
	rec.SetOnDetected(func(t domain.DetectedTrip) {
		hub.BroadcastTripFound(t)
	})

	q.SetOnPoint(func(p domain.DataPoint) {
		ctx := context.Background()
		_ = operRepo.Insert(ctx, &p)
		hub.BroadcastPoint(p)
		rec.OnPoint(ctx, p)
	})

	server := &api.Server{
		ParamsRepo:    paramsRepo,
		OperRepo:      operRepo,
		TemplatesRepo: templatesRepo,
		TripsRepo:     tripsRepo,
		JobsRepo:      jobsRepo,
		LogsRepo:      logsRepo,
		JobRegistry:   jobRegistry,
		Generator:     gen,
		Queue:         q,
		Recognition:   rec,
		Hub:           hub,
	}
	// Рассылка состояния анализа только пока генератор запущен (после Стоп блок «Анализ» перестаёт обновляться).
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			if server.IsGeneratorRunning() {
				hub.Broadcast(api.WSMessage{Type: "analysis_state", Payload: rec.GetAnalysisState()})
			}
		}
	}()

	r := api.Router(server)
	addr := ":" + config.HTTPPort()
	log.Println("listening on", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}
