@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-windows.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please check the message above.
  pause
)
