@echo off
setlocal EnableExtensions
title APPTEST One-Click Update

REM Keep this .cmd inside the app folder (e.g. D:\windal\apptest).
set "APP_ROOT=%~dp0"
set "APP_ROOT=%APP_ROOT:~0,-1%"
set "BRANCH=main"

if not exist "%APP_ROOT%" (
  echo [ERROR] APP_ROOT not found: "%APP_ROOT%"
  pause
  exit /b 1
)

cd /d "%APP_ROOT%"
if not exist logs mkdir logs

echo.
echo APPTEST update — %APP_ROOT%
echo Log: %APP_ROOT%\logs\desktop-update.log
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\run-desktop-update.ps1" -AppRoot "%APP_ROOT%" -Branch "%BRANCH%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [DONE] Update complete.
) else (
  echo [ERROR] Update failed. Open logs\desktop-update.log for details.
)
echo.
pause
exit /b %RC%
