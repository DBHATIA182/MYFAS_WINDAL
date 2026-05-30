<#
.SYNOPSIS
  Schedule automatic git pull + build on the client PC (daily and/or at logon).

.PARAMETER DailyTime
  Time of day for daily update, 24h format HH:mm (default 02:00).

.PARAMETER AtLogon
  Also run update a few minutes after user signs in (good after reboot).

.PARAMETER LogonDelayMinutes
  Minutes after logon before update runs (default 5).

.PARAMETER Branch
  Git branch to pull (default main).

.PARAMETER TaskName
  Windows scheduled task name (default git_dal_update — same on every client PC).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-scheduled-task-git-update.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-scheduled-task-git-update.ps1 -DailyTime "03:30" -AtLogon
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [string]$TaskName = '',
    [string]$DailyTime = '02:00',
    [string]$Branch = 'main',
    [switch]$AtLogon,
    [int]$LogonDelayMinutes = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same task name on every client PC (Task Scheduler -> git_dal_update).
$DefaultGitUpdateTaskName = 'git_dal_update'

function Test-IsAdministrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw @'
Run as Administrator.

Right-click setup-windal-git-update.cmd -> Run as administrator
'@
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$updatePs1 = Join-Path $AppRoot 'run-scheduled-git-update.ps1'
if (-not (Test-Path -LiteralPath $updatePs1)) {
    throw "Missing $updatePs1"
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot '.git'))) {
    throw "This folder is not a git clone (.git missing). Clone apptest from GitHub first."
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $TaskName = $DefaultGitUpdateTaskName
}

# Older setups used FAS-<client>-GitUpdate; disable those so only git_dal_update runs.
$legacyTasks = @(Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -like 'FAS-*-GitUpdate' })
foreach ($legacy in $legacyTasks) {
    Write-Host ('Disabling legacy git update task: {0}' -f $legacy.TaskName) -ForegroundColor Yellow
    Disable-ScheduledTask -TaskName $legacy.TaskName -ErrorAction SilentlyContinue | Out-Null
}

if ($DailyTime -notmatch '^(\d{1,2}):(\d{2})$') {
    throw "DailyTime must be HH:mm (example: 02:00 or 14:30)"
}
$hour = [int]$Matches[1]
$minute = [int]$Matches[2]
if ($hour -lt 0 -or $hour -gt 23 -or $minute -lt 0 -or $minute -gt 59) {
    throw 'Invalid DailyTime'
}

$user = $env:USERNAME
$psArgs = ('-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppRoot "{1}" -Branch {2}' -f $updatePs1, $AppRoot, $Branch)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $AppRoot

$triggers = @()
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour $hour -Minute $minute -Second 0)
$triggers += $dailyTrigger

if ($AtLogon) {
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    if ($LogonDelayMinutes -gt 0) {
        $logonTrigger.Delay = ('PT{0}M' -f $LogonDelayMinutes)
    }
    $triggers += $logonTrigger
}

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$desc = ('Windal: stop services, git pull + npm build, restart. Daily at {0}' -f $DailyTime)
if ($AtLogon) {
    $desc += ('; also {0} min after logon' -f $LogonDelayMinutes)
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description $desc -Force | Out-Null

Write-Host ''
Write-Host "Created task: $TaskName (same name on every client PC)" -ForegroundColor Green
Write-Host ('  Daily at {0}' -f $DailyTime)
if ($AtLogon) {
    Write-Host ('  Also at logon (+{0} min delay)' -f $LogonDelayMinutes)
}
Write-Host ('  Branch: {0}' -f $Branch)
Write-Host ('  Log: {0}' -f (Join-Path $AppRoot 'logs\git-auto-update.log'))
Write-Host ''
Write-Host 'Each run:' -ForegroundColor Cyan
Write-Host '  1. Stop node, cloudflared, ports 5001/5174, autostart scheduled tasks'
Write-Host '  2. git pull + npm ci + build'
Write-Host '  3. Restart via Start-WindalStack.ps1'
Write-Host ''
Write-Host 'Dev PC workflow:' -ForegroundColor Cyan
Write-Host '  1. push-all-to-git.ps1 on dev machine'
Write-Host '  2. Client pulls automatically (this task) or run Update-APPTEST-From-Desktop.cmd'
Write-Host ''
Write-Host 'Test now:' -ForegroundColor Yellow
Write-Host ('  schtasks /Run /TN "{0}"' -f $TaskName)
Write-Host '  Then read logs\git-auto-update.log'
