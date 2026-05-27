@echo off
REM Starts API, Vite (5174), and Cloudflare tunnel in separate minimized windows.
cd /d "%~dp0"
set "PATH=%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\Cloudflared;%PATH%"

if not exist "%~dp0config.yml" (
  echo Run setup-windal-tunnel.cmd first.
  pause
  exit /b 1
)

taskkill /F /IM cloudflared.exe >nul 2>&1

start "WINDAL-API" /MIN cmd /c "cd /d "%~dp0" && npm.cmd run server"
timeout /t 2 /nobreak >nul
start "WINDAL-Web" /MIN cmd /c "cd /d "%~dp0" && set WINDAL_TUNNEL_DEV=1&& npm.cmd run dev -- --host 0.0.0.0 --port 5174"
timeout /t 2 /nobreak >nul
start "WINDAL-Tunnel" /MIN cmd /c "cd /d "%~dp0" && call start-windal-tunnel.cmd"

echo Started API, Web (5174), and Tunnel. Check Cloudflare dashboard for Healthy status.
pause
