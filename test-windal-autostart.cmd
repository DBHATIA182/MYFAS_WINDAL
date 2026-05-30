@echo off
REM Test scheduled task without rebooting. Run as Administrator.
cd /d "%~dp0"
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content connection.config.json -Raw | ConvertFrom-Json).clientName"') do set "CK=%%i"
if "%CK%"=="" set "CK=Windal"
set "TN=FAS-%CK%-AppStack"
echo Running scheduled task: %TN%
schtasks /Run /TN "%TN%"
echo Wait 90 seconds for wrapper delay + stack start...
timeout /t 90 /nobreak
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-windal-autostart.ps1"
pause
