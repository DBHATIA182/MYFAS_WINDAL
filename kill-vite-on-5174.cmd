@echo off
setlocal
echo Stopping ONLY whatever listens on port 5174 (Vite dev)...
echo API on 5001 is left running.
echo.
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":5174 " ^| findstr LISTENING') do (
  echo Ending PID %%A ...
  taskkill /F /PID %%A
)
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":5174 " | findstr LISTENING >nul
if not errorlevel 1 (
  echo.
  echo Port 5174 still in use. Close the CMD window that ran npm run dev, or use Task Manager.
  pause
  exit /b 1
)
echo Port 5174 is free. Now run:  Windal_Fix_Tunnel_Now.cmd
endlocal
