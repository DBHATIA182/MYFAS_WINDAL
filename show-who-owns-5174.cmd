@echo off
echo Processes listening on Windal ports:
echo.
for %%P in (5001 5174 5175) do (
  echo --- Port %%P ---
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo   PID %%A
    tasklist /FI "PID eq %%A" /FO LIST 2>nul | findstr /i "Image Name Session"
    wmic process where "ProcessId=%%A" get CommandLine 2>nul
  )
  echo.
)
echo If taskkill fails with Access denied, close the CMD window running npm run dev,
echo or end that node.exe in Task Manager, or run Windal_Fix_Tunnel_Now.cmd as Administrator.
pause
