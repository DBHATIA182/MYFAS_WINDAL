@echo off
REM Windows Task Scheduler startup launcher (no windows). Frees 5001/5174 then starts stack.
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-WindalStack.ps1" -AppRoot "%~dp0"
exit /b %ERRORLEVEL%
