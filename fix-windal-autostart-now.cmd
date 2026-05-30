@echo off
REM Fix autostart + test immediately. Run as Administrator.
cd /d "%~dp0"
echo Step 1: Re-register task (logon mode)...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-scheduled-task-app-stack.ps1" -RunAtLogon
if errorlevel 1 goto :fail

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content -LiteralPath 'connection.config.json' -Raw | ConvertFrom-Json).clientName"') do set "CK=%%i"
if "%CK%"=="" set "CK=Windal"
set "TN=FAS-%CK%-AppStack"

echo.
echo Step 2: Run task now...
schtasks /Run /TN "%TN%"
echo Waiting 90 seconds...
timeout /t 90 /nobreak

echo.
echo Step 3: Diagnose...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-windal-autostart.ps1"
echo.
echo Open http://localhost:5174 in browser.
pause
exit /b 0

:fail
echo Setup failed.
pause
exit /b 1
