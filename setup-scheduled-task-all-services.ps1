<#
.SYNOPSIS
  Registers a Windows scheduled task that starts all three APPTEST processes at boot:
  API (npm run server), frontend dev (npm run dev), and Cloudflare tunnel (cloudflared).

.DESCRIPTION
  Uses the same pattern as setup-client.ps1 (ONSTART, SYSTEM, HIGHEST).
  Run from an elevated PowerShell. The task runs run-all-services.cmd in this folder.

  If you already have FAS-<client>-API from setup-client.ps1, disable or delete it to
  avoid running two API servers.

.PARAMETER AppRoot
  Folder containing run-all-services.cmd and connection.config.json. Default: this script's directory.

.PARAMETER TaskName
  Scheduled task name. Default: FAS-<clientName>-AllServices from connection.config.json.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-scheduled-task-all-services.ps1
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

$launcher = Join-Path $AppRoot "run-all-services.cmd"
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Missing launcher: $launcher"
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
    $TaskName = "FAS-$client-AllServices"
}

$taskRun = "cmd.exe /c `"$launcher`""
Write-Host "Creating scheduled task '$TaskName' -> $launcher" -ForegroundColor Cyan
& schtasks /Create /TN $TaskName /TR $taskRun /SC ONSTART /RL HIGHEST /RU SYSTEM /F | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "schtasks failed (exit $LASTEXITCODE). Run PowerShell as Administrator."
}

Write-Host "Done. Task: $TaskName (At system startup)" -ForegroundColor Green
Write-Host "Logs under: $(Join-Path $AppRoot 'logs')" -ForegroundColor Green
