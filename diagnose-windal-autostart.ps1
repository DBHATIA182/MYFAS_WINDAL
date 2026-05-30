<#
.SYNOPSIS
  Check Windal scheduled autostart task and recent logs.
#>
param([string]$AppRoot = '')

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) { $AppRoot = $scriptDir }
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$configPath = Join-Path $AppRoot 'connection.config.json'
$taskName = 'FAS-Windal-AppStack'
if (Test-Path -LiteralPath $configPath) {
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $client = $cfg.clientName
    if ([string]::IsNullOrWhiteSpace($client)) { $client = $cfg.defaultClientKey }
    if (-not [string]::IsNullOrWhiteSpace($client)) { $taskName = "FAS-$client-AppStack" }
}

Write-Host "`n=== Windal autostart diagnose ===" -ForegroundColor Cyan
Write-Host "AppRoot: $AppRoot"
Write-Host "Expected task: $taskName`n"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task NOT FOUND. Run setup-windal-autostart.cmd as Administrator." -ForegroundColor Red
    Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like 'FAS-*' } | Format-Table TaskName, State
} else {
    Write-Host "Task state: $($task.State)" -ForegroundColor $(if ($task.State -eq 'Ready') { 'Green' } else { 'Yellow' })
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    if ($info) {
        Write-Host "Last run time : $($info.LastRunTime)"
        Write-Host "Last result   : $($info.LastTaskResult) $(if ($info.LastTaskResult -eq 0) { '(OK)' } elseif ($info.LastTaskResult -eq 267011) { '(task has not run yet)' } else { '(error)' })"
        Write-Host "Next run time : $($info.NextRunTime)"
    }
    $task.Actions | ForEach-Object { Write-Host "Action: $($_.Execute) $($_.Arguments)" }
    $task.Triggers | ForEach-Object { Write-Host "Trigger: $($_.CimClass.CimClassName) Delay=$($_.Delay)" }
}

$logs = @(
    (Join-Path $AppRoot 'logs\autostart-bootstrap.log'),
    (Join-Path $AppRoot 'logs\windal-stack.log'),
    (Join-Path $AppRoot 'logs\server.log')
)
foreach ($f in $logs) {
    Write-Host "`n--- $(Split-Path -Leaf $f) (last 15 lines) ---" -ForegroundColor DarkGray
    if (Test-Path -LiteralPath $f) {
        Get-Content -LiteralPath $f -Tail 15 -ErrorAction SilentlyContinue
    } else {
        Write-Host '(file missing - task may never have run)'
    }
}

Write-Host "`nPorts:" -ForegroundColor DarkGray
foreach ($port in 5001, 5174) {
    $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listen) { Write-Host "  $port LISTENING PID $($listen.OwningProcess)" -ForegroundColor Green }
    else { Write-Host "  $port not listening" -ForegroundColor Yellow }
}

Write-Host "`nTest run task now (Admin): schtasks /Run /TN `"$taskName`"" -ForegroundColor Cyan
