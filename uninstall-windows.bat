@echo off
rem Taqseem: remove the database, the running website and the setup's files from this laptop.
rem Asks you to type DELETE first. The code folder stays.
title Taqseem - remove
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking for administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall.ps1"
echo.
pause