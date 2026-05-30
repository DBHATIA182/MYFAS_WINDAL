@echo off
REM Open client user guide in browser — use Ctrl+P / Print → Save as PDF
cd /d "%~dp0"
if exist "docs\WINDAL_Client_User_Guide.html" (
  start "" "docs\WINDAL_Client_User_Guide.html"
  echo.
  echo Opened docs\WINDAL_Client_User_Guide.html
  echo In Chrome/Edge: Ctrl+P -^> Save as PDF
  echo.
  echo Or from the app menu: Help ? -^> Download full user guide PDF
) else (
  echo File not found: docs\WINDAL_Client_User_Guide.html
)
pause
