@echo off
REM Legacy name — same as run-autostart-stack.cmd (frees 5001/5174, background start).
cd /d "%~dp0"
call "%~dp0run-autostart-stack.cmd"
exit /b %ERRORLEVEL%
