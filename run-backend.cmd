@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
echo [%date% %time%] Starting API server...>> logs\server.log
npm.cmd run server >> logs\server.log 2>&1
