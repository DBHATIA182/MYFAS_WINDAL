@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
set "CHILD_LOG=logs\deploy-update-child.log"
echo [%date% %time%] wrapper start>> "%CHILD_LOG%"
echo [%date% %time%] running as %USERNAME% on %COMPUTERNAME%>> "%CHILD_LOG%"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run-deploy-update.ps1" >> "%CHILD_LOG%" 2>&1
set "EC=%ERRORLEVEL%"
if "%EC%"=="" set "EC=unknown"
echo [%date% %time%] wrapper end exit_code=%EC%>> "%CHILD_LOG%"
exit /b %EC%
