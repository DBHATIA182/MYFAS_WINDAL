@echo off
REM Called by Windows Task Scheduler at startup. Always logs success/failure.
setlocal
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"
if not exist logs mkdir logs

set "BOOTLOG=%APP%logs\autostart-bootstrap.log"
echo.>> "%BOOTLOG%"
echo ==================================================>> "%BOOTLOG%"
echo [%date% %time%] autostart wrapper begin>> "%BOOTLOG%"
echo APP=%APP%>> "%BOOTLOG%"
echo USER=%USERNAME% COMPUTER=%COMPUTERNAME%>> "%BOOTLOG%"

REM Give network / drive letters time to appear (especially E: or mapped paths).
timeout /t 45 /nobreak >> "%BOOTLOG%" 2>&1

set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%PATH%"

where node >> "%BOOTLOG%" 2>&1
where npm.cmd >> "%BOOTLOG%" 2>&1

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%" -ProductionWeb >> "%BOOTLOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo [%date% %time%] Start-WindalStack.ps1 exit code=%RC%>> "%BOOTLOG%"

endlocal
exit /b %RC%
