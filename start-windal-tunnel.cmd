@echo off
cd /d "%~dp0"
set "CF=%ProgramFiles(x86)%\Cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=%ProgramFiles%\Cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not exist "%CF%" (
  echo cloudflared not found. Run: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)
if not exist "%~dp0config.yml" (
  echo config.yml missing. Run: setup-windal-tunnel.cmd ^<client-key^>
  pause
  exit /b 1
)
echo Tunnel config: %~dp0config.yml
echo Using: %CF%
"%CF%" tunnel --config "%~dp0config.yml" run
