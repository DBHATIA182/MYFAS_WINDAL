@echo off
REM Windows Task Scheduler startup launcher (no windows). Frees 5001/5174 then starts stack.
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP%\Start-WindalStack.ps1" -AppRoot "%APP%"
exit /b %ERRORLEVEL%
