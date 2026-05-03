@echo off
REM Launches API (node server), Vite dev server, and cloudflared tunnel as separate
REM minimized processes. Intended for Windows Task Scheduler (e.g. At startup).
REM Logs: logs\server.log, logs\frontend.log, logs\tunnel.log

cd /d "%~dp0"
if not exist logs mkdir logs

REM Prefer real installs first (avoids a wrong cloudflared earlier on system PATH).
set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo [%date% %time%] Launching API, frontend, tunnel...>> logs\all-services.log

start "FAS-API" /MIN /D "%~dp0" cmd /c "npm.cmd run server >> logs\server.log 2>&1"
timeout /t 2 /nobreak >nul
start "FAS-Frontend" /MIN /D "%~dp0" cmd /c "npm.cmd run dev -- --host 0.0.0.0 --port 5174 >> logs\frontend.log 2>&1"
timeout /t 2 /nobreak >nul
start "FAS-Tunnel" /MIN /D "%~dp0" cmd /c "cloudflared tunnel --config config.yml run >> logs\tunnel.log 2>&1"

echo [%date% %time%] Launcher finished (child processes keep running).>> logs\all-services.log
exit /b 0
