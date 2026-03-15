@echo off
cd /d "%~dp0"
echo Starting containers (build + foreground). Press Ctrl+C to stop.
docker compose up --build
