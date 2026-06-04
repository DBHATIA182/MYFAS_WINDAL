@echo off
setlocal
REM One-shot: stop dev on 5174, build, start API + production preview + tunnel.
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"

echo.
echo === Windal: fix dal-demo for phone (production on 5174) ===
echo.
echo IMPORTANT: Close any terminal running "npm run dev" for WINDAL (Ctrl+C).
echo If port 5174 stays on Vite DEV, phone will stay blank.
echo Run show-who-owns-5174.cmd if you need to find the blocking node.exe.
echo.
echo Step 1: Stop anything on ports 5001, 5174, 5175...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\free-windal-stack-ports.ps1" -Ports 5001,5174,5175
timeout /t 3 /nobreak >nul
netstat -ano | findstr ":5174 " | findstr LISTENING >nul
if not errorlevel 1 (
  echo.
  echo ERROR: Port 5174 is STILL in use. End the node.exe shown above, then run this file again.
  echo Or right-click this file - Run as administrator.
  pause
  exit /b 1
)

echo.
echo Step 2: Build + start stack (preview on 5174)...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%" -ProductionWeb
if errorlevel 1 (
  echo FAILED. See logs\windal-stack.log and logs\frontend-build.log
  pause
  exit /b 1
)

echo.
echo Step 3: Check what tunnel will serve...
timeout /t 5 /nobreak >nul
curl.exe -s http://127.0.0.1:5174/ | findstr /i "assets/index SRC/main vite/client"
if errorlevel 1 (
  echo Could not detect bundle in HTML - open logs\frontend.log
) else (
  echo.
  echo If you see "assets/index" above, production is OK.
  echo If you see "SRC/main" or "vite/client", something is still wrong.
)

echo.
echo On phone: clear site data, then open https://dal-demo.fasaccountingsoftware.in/
echo.
pause
endlocal
