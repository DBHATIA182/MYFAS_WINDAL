@echo off
echo.
echo ======================================
echo   DISCONNECTING REMOTE SESSION...
echo   PROGRAMS WILL KEEP RUNNING
echo ======================================
echo.

timeout /t 3 /nobreak >nul

tsdiscon