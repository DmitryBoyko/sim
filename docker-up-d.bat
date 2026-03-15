@echo off
cd /d "%~dp0"
echo Building and starting containers in background...
docker compose up -d --build
if %ERRORLEVEL% equ 0 (
  echo.
  echo Ready. Open http://localhost:8080 (login: admin / admin)
  echo To view logs: docker-logs-app.bat
  echo To stop: docker-down.bat
) else (
  echo Failed. Check Docker is running.
  exit /b 1
)
