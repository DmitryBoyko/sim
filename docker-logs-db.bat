@echo off
cd /d "%~dp0"
echo PostgreSQL logs (Ctrl+C to exit)...
docker compose logs -f db
