@echo off
REM Usage: setup-windal-tunnel.cmd dal-srfipulses
REM        setup-windal-tunnel.cmd dal-srfipulses routes   (DNS + config only)
REM        setup-windal-tunnel.cmd login
cd /d "%~dp0"
set "KEY=%~1"
if /i "%KEY%"=="login" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windal-tunnel.ps1" -Login
  goto :done
)
if "%KEY%"=="" (
  echo.
  echo Usage: setup-windal-tunnel.cmd ^<client-key^>
  echo Example: setup-windal-tunnel.cmd dal-srfipulses
  echo.
  set /p KEY="Client key (e.g. dal-srfipulses): "
)
if /i "%~2"=="routes" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windal-tunnel.ps1" -ClientKey "%KEY%" -RoutesOnly
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windal-tunnel.ps1" -ClientKey "%KEY%"
)
:done
if errorlevel 1 pause
