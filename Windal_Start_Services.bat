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
echo Logs: logs\windal-stack.log  logs\server.log  logs\frontend.log  logs\tunnel.log
echo.
echo Auto-start at Windows boot: run setup-windal-autostart.cmd as Administrator (once).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%"
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo.
  echo Stack start failed. See logs\windal-stack.log
  pause
  exit /b %RC%
)

echo.
echo Started in background. Wait ~10 seconds, then open your company URL in the browser.
echo To stop: run stop-windal-stack.cmd or Task Manager - end node.exe / cloudflared.exe
echo.
timeout /t 5 /nobreak >nul
endlocal
exit /b 0
