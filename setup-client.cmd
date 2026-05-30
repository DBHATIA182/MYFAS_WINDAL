@echo off
REM Client setup — bypasses PowerShell "running scripts is disabled".
REM Usage (CMD or PowerShell):
REM   .\setup-client.cmd
REM   .\setup-client.cmd dal-srfipulses
REM   .\setup-client.cmd dal-srfipulses XE
REM   .\setup-client.cmd dal-srfipulses XE skip-install
cd /d "%~dp0"

set "KEY=%~1"
set "TNS=%~2"
set "EXTRA="
if /i "%~3"=="skip-install" set "EXTRA=-SkipPrerequisiteInstall"
if "%TNS%"=="skip-install" (
  set "TNS=XE"
  set "EXTRA=-SkipPrerequisiteInstall"
)
if "%TNS%"=="" set "TNS=XE"

if "%KEY%"=="" (
  echo.
  echo Usage: setup-client.cmd ^<client-key^> [oracle-connect-string]
  echo Example: setup-client.cmd dal-srfipulses XE
  echo.
  set /p KEY="Client key (e.g. dal-srfipulses): "
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-client.ps1" ^
  -ClientKey "%KEY%" ^
  -OraclePrimaryUser "DAL" ^
  -OraclePrimaryPassword "DAL" ^
  -OracleSecondaryUser "DAL" ^
  -OracleSecondaryPassword "DAL" ^
  -OracleConnectString "%TNS%" %EXTRA%

if errorlevel 1 pause
