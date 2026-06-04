@echo off
setlocal
REM Windal stack for phone / dal-demo — production build + preview (not Vite dev).
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"
echo.
echo === Windal MOBILE / tunnel mode (build + preview on 5174) ===
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%" -ProductionWeb
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo Failed. See logs\windal-stack.log and logs\frontend-build.log
  pause
  exit /b %RC%
)
echo.
echo Wait ~30s after first build, then on phone open:
echo   https://dal-demo.fasaccountingsoftware.in/
echo Clear site data on the phone if you still see a blank screen.
echo.
timeout /t 8 /nobreak >nul
endlocal
exit /b 0
