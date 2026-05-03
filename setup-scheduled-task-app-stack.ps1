<#
.SYNOPSIS
  Registers one Windows scheduled task at startup: API (node server.cjs), Vite dev, Cloudflare tunnel.

.DESCRIPTION
  Uses run-autostart-stack.cmd (PATH includes Node + cloudflared; npm.cmd avoids PowerShell execution policy).
  Run PowerShell as Administrator. Default task name: FAS-<clientName>-AppStack from connection.config.json.

  If you already use FAS-<client>-API from setup-client.ps1 or FAS-<client>-AllServices, disable those
  tasks to avoid two processes binding to port 5001 / 5174 (Windal UI; 5173 may be another app).

.PARAMETER AppRoot
  Folder containing run-autostart-stack.cmd, server.cjs, config.yml. Default: this script's directory.

.PARAMETER TaskName
  Override scheduled task name.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-scheduled-task-app-stack.ps1
#>
[CmdletBinding()]
param(
    [string]$AppRoot = "",
    [string]$TaskName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$launcher = Join-Path $AppRoot "run-autostart-stack.cmd"
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Missing launcher: $launcher"
}

$serverJs = Join-Path $AppRoot "server.cjs"
if (-not (Test-Path -LiteralPath $serverJs)) {
    throw "Missing server.cjs at $serverJs"
}

$configYml = Join-Path $AppRoot "config.yml"
if (-not (Test-Path -LiteralPath $configYml)) {
    Write-Warning "config.yml not found at $configYml - tunnel start will fail until you add it."
}

$configPath = Join-Path $AppRoot "connection.config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath (needed for default task name)."
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $client = $cfg.clientName
    if ([string]::IsNullOrWhiteSpace($client)) {
        $client = $cfg.defaultClientKey
    }
    if ([string]::IsNullOrWhiteSpace($client)) {
        throw "connection.config.json has no clientName or defaultClientKey; pass -TaskName explicitly."
    }
    $TaskName = "FAS-$client-AppStack"
}

$taskRun = "cmd.exe /c `"$launcher`""
Write-Host "Creating scheduled task '$TaskName'" -ForegroundColor Cyan
Write-Host "  Action: $taskRun" -ForegroundColor Gray
Write-Host "  Trigger: At system startup (ONSTART), SYSTEM, highest privileges" -ForegroundColor Gray

& schtasks /Create /TN $TaskName /TR $taskRun /SC ONSTART /RL HIGHEST /RU SYSTEM /F | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "schtasks failed (exit $LASTEXITCODE). Run PowerShell as Administrator."
}

Write-Host ""
Write-Host "Done. Task name: $TaskName" -ForegroundColor Green
Write-Host "Launcher: $launcher" -ForegroundColor Green
Write-Host "Logs: $(Join-Path $AppRoot 'logs')" -ForegroundColor Green
Write-Host ""
Write-Host 'Disable conflicting tasks if any (Task Scheduler Library):' -ForegroundColor Yellow
Write-Host '  FAS-*-API  (API-only from setup-client.ps1)' -ForegroundColor DarkYellow
Write-Host '  FAS-*-AllServices  (uses run-all-services.cmd)' -ForegroundColor DarkYellow
