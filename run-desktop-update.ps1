<#
.SYNOPSIS
  One-click client update: stop services, git pull + npm ci + build, restart.

.DESCRIPTION
  Used by Update-APPTEST-From-Desktop.cmd. Writes one log file (avoids CMD + PS fighting for the same handle).
#>
[CmdletBinding()]
param(
    [string]$AppRoot = "",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$AppRoot = if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $AppRoot
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$logDir = Join-Path $AppRoot "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -Path $logDir -ItemType Directory | Out-Null
}
$logFile = Join-Path $logDir "desktop-update.log"

function Write-Log([string]$Message, [string]$Level = "INFO") {
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

Set-Location -LiteralPath $AppRoot
Write-Log "Desktop update started. AppRoot=$AppRoot Branch=$Branch"
Write-Log "============================================================"

try {
    Write-Log "Step 1/3: Stopping APPTEST services..."
    $stopScript = Join-Path $AppRoot "stop-apptest-services.ps1"
    if (-not (Test-Path -LiteralPath $stopScript)) {
        throw "Missing: $stopScript"
    }
    & $stopScript -AppRoot $AppRoot -StopScheduledTasks -ReleaseApiPort5001 -ReleasePorts5174 -WaitSeconds 3
    if (-not $? -or ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE)) {
        throw "stop-apptest-services.ps1 failed (exit $LASTEXITCODE)"
    }
    Write-Log "Stop step finished." "OK"

    Write-Log "Step 2/3: Git pull and rebuild..."
    $updateScript = Join-Path $AppRoot "update-from-git.ps1"
    if (-not (Test-Path -LiteralPath $updateScript)) {
        throw "Missing: $updateScript"
    }
    & $updateScript -Branch $Branch -AppRoot $AppRoot -SkipProcessStop
    if (-not $? -or ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE)) {
        throw "update-from-git.ps1 failed (exit $LASTEXITCODE)"
    }
    Write-Log "Git/build step finished." "OK"

    Write-Log "Step 3/3: Starting APPTEST services..."
    $startScript = Join-Path $AppRoot "start-apptest-services.ps1"
    if (-not (Test-Path -LiteralPath $startScript)) {
        throw "Missing: $startScript"
    }
    & $startScript -AppRoot $AppRoot
    if (-not $? -or ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE)) {
        throw "start-apptest-services.ps1 failed (exit $LASTEXITCODE)"
    }
    Write-Log "Start step finished." "OK"

    Write-Log "Desktop update completed successfully." "OK"
    exit 0
} catch {
    Write-Log $_.Exception.Message "ERROR"
    if ($_.ScriptStackTrace) {
        Write-Log $_.ScriptStackTrace "ERROR"
    }
    Write-Log "Desktop update FAILED. Fix the error above, then run again." "ERROR"
    exit 1
}
