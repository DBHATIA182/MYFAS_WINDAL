<#
.SYNOPSIS
  Automatic client update: stop all services, git pull + build, restart stack.

.DESCRIPTION
  Logs to logs\git-auto-update.log
  Order is always: (1) stop node/cloudflared + scheduled autostart tasks,
  (2) git pull / npm ci / build, (3) restart via Start-WindalStack.ps1.
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$logDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -Path $logDir -ItemType Directory -Force | Out-Null
}
$logFile = Join-Path $logDir 'git-auto-update.log'

function Write-Log([string]$msg, [string]$level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $msg
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

Write-Log '============================================================'
Write-Log "Scheduled git update started (task: git_dal_update). AppRoot=$AppRoot Branch=$Branch USER=$env:USERNAME"
Write-Log 'Flow: STOP all services -> git pull + build -> RESTART services'

try {
    Set-Location -LiteralPath $AppRoot

    Write-Log 'Step 1/3: Stopping all APPTEST services (node, cloudflared, ports 5001/5174, autostart tasks)...'
    $stopScript = Join-Path $AppRoot 'stop-apptest-services.ps1'
    if (-not (Test-Path -LiteralPath $stopScript)) {
        throw "Missing $stopScript"
    }
    & $stopScript -AppRoot $AppRoot -StopScheduledTasks -ReleaseApiPort5001 -ReleasePorts5174 -WaitSeconds 5
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw "stop-apptest-services.ps1 failed with exit code $LASTEXITCODE"
    }
    Write-Log 'All services stopped.' 'OK'

    Write-Log 'Step 2/3: Git pull and rebuild (services remain stopped)...'
    $updateScript = Join-Path $AppRoot 'update-from-git.ps1'
    if (-not (Test-Path -LiteralPath $updateScript)) {
        throw "Missing $updateScript"
    }
    & $updateScript -Branch $Branch -AppRoot $AppRoot -SkipProcessStop
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw "update-from-git.ps1 failed with exit code $LASTEXITCODE"
    }
    Write-Log 'Git pull and build finished.' 'OK'

    Write-Log 'Step 3/3: Restarting APPTEST services...'
    $stackStart = Join-Path $AppRoot 'Start-WindalStack.ps1'
    $legacyStart = Join-Path $AppRoot 'start-apptest-services.ps1'
    if (Test-Path -LiteralPath $stackStart) {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $stackStart -AppRoot $AppRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Start-WindalStack.ps1 failed with exit code $LASTEXITCODE"
        }
    } elseif (Test-Path -LiteralPath $legacyStart) {
        & $legacyStart -AppRoot $AppRoot
        if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
            throw "start-apptest-services.ps1 failed with exit code $LASTEXITCODE"
        }
    } else {
        throw 'Missing Start-WindalStack.ps1 or start-apptest-services.ps1'
    }
    Write-Log 'Services restarted.' 'OK'

    Write-Log 'Scheduled git update completed successfully.' 'OK'
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    if ($_.ScriptStackTrace) {
        Write-Log $_.ScriptStackTrace 'ERROR'
    }
    Write-Log 'Scheduled git update FAILED. Services may still be stopped; run Start-WindalStack.ps1 or setup-windal-autostart task manually.' 'ERROR'
    exit 1
}
