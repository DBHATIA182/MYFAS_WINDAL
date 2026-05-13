@echo off
setlocal EnableExtensions EnableDelayedExpansion
title APPTEST One-Click Update (rgdal)

REM ------------------------------------------------------------
REM APP_ROOT = this file's folder (keep Update-APPTEST-From-Desktop-rgdal.cmd inside APPTEST).
REM Override only if you moved this .cmd outside the app folder:
REM   set "APP_ROOT=F:\WINDAL\APPTEST"
REM ------------------------------------------------------------
set "APP_ROOT=%~dp0"
set "APP_ROOT=%APP_ROOT:~0,-1%"
set "BRANCH=main"

if not exist "%APP_ROOT%" (
  echo [ERROR] APP_ROOT not found: "%APP_ROOT%"
  echo Edit APP_ROOT in this file and try again.
  pause
  exit /b 1
)

cd /d "%APP_ROOT%"
if not exist logs mkdir logs

set "STAMP=%DATE% %TIME%"
set "LOG_FILE=%APP_ROOT%\logs\desktop-update-rgdal.log"
echo.>> "%LOG_FILE%"
echo ============================================================>> "%LOG_FILE%"
echo [%STAMP%] Desktop updater started (rgdal).>> "%LOG_FILE%"
echo APP_ROOT=%APP_ROOT% BRANCH=%BRANCH%>> "%LOG_FILE%"

echo.
echo [1/4] Git reset and pull (clears stuck merge index, then fast-forward)...
echo [1/4] Git reset and pull...>> "%LOG_FILE%"
git reset --hard HEAD >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] git reset --hard HEAD failed. Check "%LOG_FILE%"
  echo [ERROR] git reset --hard HEAD failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)
git pull >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] git pull failed. Check "%LOG_FILE%"
  echo [ERROR] git pull failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [2/4] Stopping APPTEST services...
echo [2/4] Stopping APPTEST services...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\stop-apptest-services.ps1" -AppRoot "%APP_ROOT%" -ReleaseApiPort5001 >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] stop-apptest-services failed. Check "%LOG_FILE%"
  echo [ERROR] stop-apptest-services failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [3/4] Updating from Git and rebuilding...
echo [3/4] Updating from Git and rebuilding...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\update-from-git.ps1" -Branch "%BRANCH%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] update-from-git failed. Check "%LOG_FILE%"
  echo [ERROR] update-from-git failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [4/4] Starting APPTEST services...
echo [4/4] Starting APPTEST services...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\start-apptest-services.ps1" -AppRoot "%APP_ROOT%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] start-apptest-services failed. Check "%LOG_FILE%"
  echo [ERROR] start-apptest-services failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [DONE] Update complete.
echo [DONE] Update complete.>> "%LOG_FILE%"
echo Log file: "%LOG_FILE%"
echo [%DATE% %TIME%] Desktop updater finished OK.>> "%LOG_FILE%"
pause
exit /b 0
