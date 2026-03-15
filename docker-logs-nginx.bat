@echo off
cd /d "%~dp0"
echo Nginx logs (Ctrl+C to exit)...
docker compose logs -f nginx
