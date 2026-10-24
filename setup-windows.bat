@echo off
rem Sales App: double-click to install everything and start the website on Windows.
rem Safe to run again: it only does what is missing, then starts the website.
cd /d "%~dp0"

rem Installing Node.js and PostgreSQL needs administrator rights: ask once.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking for administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup.ps1"
echo.
pause
