package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// webDistDir returns absolute path to web/dist: relative to executable (Docker) or CWD (local).
func webDistDir() (string, bool) {
	const relDir = "web/dist"
	// In Docker: binary is /app/server, so dir is /app → /app/web/dist
	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		abs := filepath.Join(base, relDir)
		if _, err := os.Stat(abs); err == nil {
			return abs, true
		}
	}
	// Fallback: relative to current working directory (local dev)
	if abs, err := filepath.Abs(relDir); err == nil {
		if _, err := os.Stat(abs); err == nil {
			return abs, true
		}
	}
	return "", false
}

// Router sets up routes and WebSocket.
func Router(s *Server) *gin.Engine {
	r := gin.Default()
	r.Use(corsMiddleware())

	// Serve built frontend from web/dist (SPA: assets + fallback to index.html)
	if abs, ok := webDistDir(); ok {
		assetsPath := filepath.Join(abs, "assets")
		indexPath := filepath.Join(abs, "index.html")
		r.Static("/assets", assetsPath)
		if fi, err := os.Stat(filepath.Join(abs, "favicon.png")); err == nil && !fi.IsDir() {
			r.StaticFile("/favicon.png", filepath.Join(abs, "favicon.png"))
		}
		// Explicit root and index.html so SPA always loads
		r.GET("/", func(c *gin.Context) {
			println("HANDLER / HIT", c.ClientIP(), c.Request.URL.String())
			c.File(indexPath)
		})
		r.GET("/index.html", func(c *gin.Context) { c.File(indexPath) })
		// SPA fallback: any other GET (e.g. /some/route) → index.html
		r.NoRoute(func(c *gin.Context) {
			println("HANDLER NoRoute HIT", c.ClientIP(), c.Request.Method, c.Request.URL.String())
			if c.Request.Method != http.MethodGet {
				c.Status(http.StatusNotFound)
				return
			}
			c.File(indexPath)
		})
	}

	api := r.Group("/api")
	{
		api.GET("/settings", s.GetSettings)
		api.PUT("/settings", s.PutSettings)
		api.POST("/control/start", s.ControlStart)
		api.POST("/control/stop", s.ControlStop)
		api.POST("/control/clear", s.ControlClear)
		api.GET("/data/operational", s.DataOperational)
		api.GET("/data/operational/stats", s.DataOperationalStats)
		api.GET("/templates", s.TemplatesList)
		api.GET("/templates/:id", s.TemplatesGet)
		api.POST("/templates", s.TemplatesCreate)
		api.PUT("/templates/:id", s.TemplatesUpdate)
		api.DELETE("/templates/:id", s.TemplatesDelete)
		api.GET("/trips", s.TripsList)
		api.DELETE("/trips", s.TripsDeleteAll)
		api.GET("/history", s.History)
		api.GET("/recognition/analysis", s.RecognitionAnalysis)
		api.POST("/jobs/recalculate-trips", s.JobsRecalculateTrips)
		api.GET("/jobs", s.JobList)
		api.GET("/jobs/active", s.JobActive)
		api.GET("/jobs/:id", s.JobByID)
		api.POST("/jobs/:id/cancel", s.JobCancel)
		api.DELETE("/jobs/completed", s.JobDeleteCompleted)
		api.DELETE("/jobs/:id", s.JobDelete)
		api.GET("/logs", s.LogsList)
		api.POST("/logs", s.LogsCreate)
		api.DELETE("/logs", s.LogsDelete)
		api.GET("/docs", s.DocsGet)
	}
	r.GET("/ws", s.HandleWebSocket)
	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
