@echo off
setlocal
REM Run this ONLY from your Windal APPTEST clone (this folder holds connection.config.json + config.yml).
REM Remote-managed Cloudflare may push localhost:5173 for your hostname (see tunnel window logs). Local config.yml is IGNORED.
REM If public URL stays GRAINFAS: run instead  start-services-for-cloudflare-5173-route.bat  (Windal Vite listens 5173 to match).
set "APP=%~dp0"
cd /d "%APP%"

echo.
echo === Windal APPTEST — clean restart ===
echo Folder: %APP%
echo Web UI: http://localhost:5174    (5173 is often GRAINFAS / another repo — wrong app)
echo Public: https://dal-rgind.fasaccountingsoftware.in
findstr /i "clientName" "%APP%connection.config.json" 2>nul
echo.

set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

REM Two cloudflared processes = traffic can hop between connectors — kill all, start one below.
echo [1/4] Stopping ALL cloudflared on this PC (tunnel reconnects cleanly)...
taskkill /F /IM cloudflared.exe >nul 2>&1

REM Duplicate node on 5174 (you had two LISTENING PIDs) sends the tunnel at the wrong UI (GRAINFAS).
echo [2/4] Stopping anything listening on 5174 (Vite) and 5001 (API^)...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%free-windal-stack-ports.ps1" -Ports 5174,5001

echo [3/4] Waiting 3 seconds (lets sockets release^)...
timeout /t 3 /nobreak >nul

echo [4/4] Starting API, Vite (host 0.0.0.0:5174), tunnel (.\config.yml)...
start "Windal-API" /min /D "%APP%" cmd /k "node server.cjs"
timeout /t 2 /nobreak >nul
start "Windal-Vite" /min /D "%APP%" cmd /k "set WINDAL_TUNNEL_DEV=1&& npm run dev -- --host 0.0.0.0 --port 5174"
timeout /t 2 /nobreak >nul
start "Windal-Tunnel" /min /D "%APP%" cmd /k "cloudflared tunnel --config .\config.yml run"

echo.
echo After ~5s open: https://dal-rgind.fasaccountingsoftware.in/windal-appmarker.txt
echo Expected: plain text WINDAL_APPTEST   (not GRAINFAS sign-in page)
echo If sign-in still appears: stop any other Cursor/terminal "npm run dev" from another folder, re-run this bat.
echo.
endlocal
