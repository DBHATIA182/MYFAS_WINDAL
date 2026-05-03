@echo off
setlocal
REM All services start in this script's folder (credentials ./…json + config.yml resolve correctly).
set "APP=%~dp0"
echo.
echo === Windal APPTEST (run only from E:\WINDAL\APPTEST or your clone of this repo) ===
echo Folder: %APP%
echo Web UI: http://localhost:5174  (5173 is often a different project, e.g. GRAINFAS)
findstr /i "clientName" "%APP%connection.config.json" 2>nul
echo.
set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"

REM Terminal 1 - API
start "Server" /min /D "%APP%" cmd /k "node server.cjs"

REM Terminal 2 - Vite (args after -- go to Vite)
start "Dev" /min /D "%APP%" cmd /k "npm run dev -- --host 0.0.0.0 --port 5174"

REM Terminal 3 - Cloudflare tunnel (START /D sets cwd; quoted exe avoids nested cmd /k quoting bugs)
start "Tunnel" /min /D "%APP%" "%CF%" tunnel --config .\config.yml run

endlocal
