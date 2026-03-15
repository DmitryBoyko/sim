@echo off
cd /d "%~dp0"
echo Stopping and removing containers...
docker compose down
if %ERRORLEVEL% equ 0 (
  echo Done. Data is kept in Docker volume.
) else (
  echo Failed.
  exit /b 1
)
