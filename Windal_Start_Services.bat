@echo off
setlocal
REM Windal — restart API (5001), Vite (5174), tunnel. Frees ports first if already in use.
REM Runs in background (no cmd /k windows on taskbar). Logs: logs\windal-stack.log, logs\server.log
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"

echo.
echo === Windal - restart services (background) ===
echo Folder: %APP%
echo Frees ports 5001 and 5174 if busy, then starts API + Web + Tunnel.
echo Web uses PRODUCTION build (required for phone on dal-demo — not Vite dev).
echo Logs: logs\windal-stack.log  logs\server.log  logs\frontend-build.log  logs\frontend.log
echo.
echo Auto-start at Windows boot: run setup-windal-autostart.cmd as Administrator (once).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%" -ProductionWeb
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo.
  echo Stack start failed. See logs\windal-stack.log
  pause
  exit /b %RC%
)

echo.
echo Started in background. Wait ~30s for build, then verify on PC:
echo   curl.exe -s http://127.0.0.1:5174/ ^| findstr assets/index
echo Must show assets/index — NOT SRC/main.jsx. If wrong: close npm run dev windows, run Windal_Fix_Tunnel_Now.cmd
echo Phone: clear site data, then https://dal-demo.fasaccountingsoftware.in/
echo To stop: stop-windal-stack.cmd
echo.
timeout /t 8 /nobreak >nul
endlocal
exit /b 0
