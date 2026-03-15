@echo off
cd /d "%~dp0"
echo Stopping...
docker compose down
echo Starting (build + foreground). Press Ctrl+C to stop.
docker compose up --build
