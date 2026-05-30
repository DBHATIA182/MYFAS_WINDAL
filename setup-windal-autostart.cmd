@echo off
REM Registers Windal to start when YOU log in. MUST run as Administrator.
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Run as Administrator.
  echo Right-click setup-windal-autostart.cmd -^> Run as administrator
  echo.
  pause
  exit /b 1
)

echo.
echo This registers autostart at LOGON when you sign in to Windows.
echo Best for dev PC on E: drive. For boot-without-login use -AtStartup instead.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-scheduled-task-app-stack.ps1" -RunAtLogon %*
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo.
  echo Setup FAILED. See message above.
  pause
  exit /b %RC%
)

echo.
echo SUCCESS. Test now:
echo   schtasks /Run /TN "FAS-...-AppStack"
echo   or sign out and sign in again.
echo.
pause
exit /b 0
