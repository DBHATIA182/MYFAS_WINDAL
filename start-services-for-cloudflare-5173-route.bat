@echo off
setlocal
REM Use this when Cloudflare's REMOTE tunnel config sends your site to http://localhost:5173
REM (cloudflared logs: "Updated to new configuration" showing :5173 — local config.yml is ignored).
REM You cannot fix that from CMD without Cloudflare dashboard OR an API token — so we run Windal Vite on 5173 to match.
REM After this, close any other "npm run dev" and do NOT start GRAINFAS on 5173.

set "APP=%~dp0"
cd /d "%APP%"

echo.
echo === Windal on port 5173 (matches typical remote Cloudflare ingress) ===
echo Folder: %APP%
findstr /i "clientName" "%APP%connection.config.json" 2>nul
echo Local:  http://localhost:5173/
echo Public: https://dal-rgind.fasaccountingsoftware.in/windal-appmarker.txt  should return WINDAL_APPTEST
echo.

set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo [1/4] Stopping cloudflared...
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [2/4] Stopping listeners on 5173, 5174, 5001 (frees web + API)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(5173, 5174, 5001); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('  PID ' + $_ + ' on port ' + $port); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

echo [3/4] Waiting 2 seconds...
timeout /t 2 /nobreak >nul

echo [4/4] Starting API (5001^), Vite (0.0.0.0:5173^), tunnel...
start "Windal-API" /min /D "%APP%" cmd /k "node server.cjs"
timeout /t 2 /nobreak >nul
start "Windal-Vite-5173" /min /D "%APP%" cmd /k "set WINDAL_TUNNEL_DEV=1&& npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"
timeout /t 2 /nobreak >nul
start "Windal-Tunnel" /min /D "%APP%" cmd /k "cloudflared tunnel --config .\config.yml run"

echo.
echo If Vite exits with "Port 5173 is in use", something else grabbed 5173 — run netstat -ano ^| findstr :5173
echo.
endlocal
