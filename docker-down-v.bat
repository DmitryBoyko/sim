@echo off
cd /d "%~dp0"
echo Stopping containers and removing volumes (DB data will be lost)...
docker compose down -v
if %ERRORLEVEL% equ 0 (
  echo Done.
) else (
  echo Failed.
  exit /b 1
)
