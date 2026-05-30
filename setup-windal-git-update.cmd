@echo off
REM Schedule automatic git pull + build on this client PC. Run as Administrator.
REM Each scheduled run: STOP all services -> git pull + build -> RESTART services.
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Run as Administrator.
  echo Right-click setup-windal-git-update.cmd -^> Run as administrator
  echo.
  pause
  exit /b 1
)

echo.
echo Registers automatic Git update on this PC.
echo.
echo Scheduled task name (every client): git_dal_update
echo   Test run: schtasks /Run /TN "git_dal_update"
echo.
echo Each run will:
echo   1. STOP all Windal services (API, Vite, tunnel, autostart tasks, ports 5001/5174)
echo   2. git pull + npm ci + build
echo   3. RESTART services (Start-WindalStack.ps1)
echo.
echo Schedule defaults:
echo   - Daily at 02:00 (change with -DailyTime "03:30")
echo   - Also 5 min after you sign in (pass -NoAtLogon to disable)
echo.
echo Optional: run one update immediately after setup:
echo   setup-windal-git-update.cmd -RunNow
echo.
echo Other examples:
echo   setup-windal-git-update.cmd -NoAtLogon -DailyTime "02:00"
echo.

set "RUN_NOW="
set "PS_ARGS=-AtLogon"
:parse_args
if "%~1"=="" goto done_args
if /i "%~1"=="-RunNow" (
  set "RUN_NOW=1"
  shift
  goto parse_args
)
if /i "%~1"=="-NoAtLogon" (
  set "PS_ARGS="
  shift
  goto parse_args
)
set "PS_ARGS=%PS_ARGS% %1"
shift
goto parse_args
:done_args

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-scheduled-task-git-update.ps1" %PS_ARGS%
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo.
  echo Setup FAILED.
  pause
  exit /b %RC%
)

if defined RUN_NOW (
  echo.
  echo Running one update now (stop -^> pull -^> restart)...
  echo Log: logs\git-auto-update.log
  echo.
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-scheduled-git-update.ps1"
  set "RC=%ERRORLEVEL%"
  if %RC% NEQ 0 (
    echo.
    echo Update run FAILED. See logs\git-auto-update.log
    pause
    exit /b %RC%
  )
)

echo.
echo SUCCESS. Task name: git_dal_update
echo   schtasks /Query /TN "git_dal_update"
if defined RUN_NOW (
  echo Update finished. See logs\git-auto-update.log
)
pause
exit /b 0
