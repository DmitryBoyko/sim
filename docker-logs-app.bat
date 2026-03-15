@echo off
cd /d "%~dp0"
echo App logs (Ctrl+C to exit)...
docker compose logs -f app
