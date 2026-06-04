@echo off
REM Stop Windal API (5001), Vite (5174), and optionally tunnel. Does not stop other apps on 5173.
set "APP=%~dp0"
cd /d "%APP%"
echo Stopping listeners on ports 5001 and 5174...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\free-windal-stack-ports.ps1" -Ports 5001,5174,5175
echo.
echo To stop Cloudflare tunnel for this client only, close Windal-Tunnel or:
echo   taskkill /F /IM cloudflared.exe
echo   (only if no other client tunnel runs on this PC)
echo.
pause
