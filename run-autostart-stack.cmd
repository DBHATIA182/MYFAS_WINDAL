@echo off
REM Started by Windows Task Scheduler (FAS-*-AppStack). Starts API, Vite dev, Cloudflare tunnel.
REM Logs: logs\server.log, logs\frontend.log, logs\tunnel.log, logs\autostart-stack.log

cd /d "%~dp0"
if not exist logs mkdir logs

REM Prefer real installs first (avoids a wrong cloudflared earlier on system PATH).
set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo [%date% %time%] Starting API ^+ Vite ^+ tunnel...>> logs\autostart-stack.log

REM Must match manual "start services batch file.bat": free listeners or 2nd node hits EADDRINUSE on 5001/5174.
taskkill /F /IM cloudflared.exe >> logs\autostart-stack.log 2>&1
echo [%date% %time%] Freeing ports 5001 ^& 5174...>> logs\autostart-stack.log
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-windal-stack-ports.ps1" -Ports 5001,5174 >> logs\autostart-stack.log 2>&1
timeout /t 3 /nobreak >nul

start "FAS-API" /MIN cmd /c "node server.cjs >> logs\server.log 2>&1"
timeout /t 2 /nobreak >nul
start "FAS-Web" /MIN cmd /c "set WINDAL_TUNNEL_DEV=1&& npm.cmd run dev -- --host 0.0.0.0 --port 5174 >> logs\frontend.log 2>&1"
timeout /t 2 /nobreak >nul
start "FAS-Tunnel" /MIN cmd /c "cloudflared tunnel --config config.yml run >> logs\tunnel.log 2>&1"

echo [%date% %time%] Launched child windows.>> logs\autostart-stack.log
exit /b 0
