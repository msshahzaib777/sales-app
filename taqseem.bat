@echo off
rem Taqseem: start, stop or update the website (it runs in the background).
rem Double-click for a menu, or run with one word: start, stop, update, status, autostart.
rem The first installation is done by setup-windows.bat.
title Taqseem
cd /d "%~dp0"

rem Updating may install Git, and the start-at-sign-in option needs administrator rights: ask once.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking for administrator rights...
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1' -Verb RunAs"
  )
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\deploy.ps1" %1
echo.
pause
