@echo off
cd /d "%~dp0"
echo Stopping...
docker compose down
echo Building and starting in background...
docker compose up -d --build
if %ERRORLEVEL% equ 0 (
  echo Ready. http://localhost:8080
)
