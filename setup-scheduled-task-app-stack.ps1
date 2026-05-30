<#
.SYNOPSIS
  Registers Windal to start API + Vite + tunnel automatically.

.PARAMETER RunAtLogon
  Start when you sign in to Windows (DEFAULT - most reliable on dev PC and E: drive).

.PARAMETER AtStartup
  Start at boot as SYSTEM (+ delay). Use only on client servers that must run without login.

.PARAMETER StartupDelayMinutes
  Delay after trigger (default 1 for logon, 3 for startup).
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [string]$TaskName = '',
    [int]$StartupDelayMinutes = -1,
    [switch]$RunAtLogon,
    [switch]$AtStartup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw @'
Access denied. Scheduled tasks require Administrator.

Right-click setup-windal-autostart.cmd and choose "Run as administrator".
Or open CMD as Admin, then:
  cd /d E:\WINDAL\APPTEST
  setup-windal-autostart.cmd
'@
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$startPs1 = Join-Path $AppRoot 'Start-WindalStack.ps1'
if (-not (Test-Path -LiteralPath $startPs1)) {
    throw "Missing $startPs1"
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'server.cjs'))) {
    throw "Missing server.cjs at $AppRoot"
}

$configPath = Join-Path $AppRoot 'connection.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath"
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $client = $cfg.clientName
    if ([string]::IsNullOrWhiteSpace($client)) { $client = $cfg.defaultClientKey }
    if ([string]::IsNullOrWhiteSpace($client)) {
        throw 'Set clientName in connection.config.json or pass -TaskName'
    }
    $TaskName = "FAS-$client-AppStack"
}

# Default: logon (works on E: drive dev PCs). Use -AtStartup only for headless client servers.
$useLogon = $true
if ($AtStartup) { $useLogon = $false }
if ($RunAtLogon) { $useLogon = $true }

if ($StartupDelayMinutes -lt 0) {
    $StartupDelayMinutes = if ($useLogon) { 1 } else { 3 }
}

$logsDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}

# Best-effort: let SYSTEM write logs (ignore errors on locked log files)
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
if (Test-Path -LiteralPath $icacls) {
    try {
        & $icacls $logsDir /grant 'SYSTEM:(OI)(CI)M' 'Users:(OI)(CI)M' /T 2>$null | Out-Null
    } catch { }
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Note: could not update ACL on logs folder (continuing anyway).' -ForegroundColor DarkYellow
    }
}

Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue |
    Where-Object {
        $_.TaskName -ne $TaskName -and (
            $_.TaskName -like 'FAS-*-API' -or $_.TaskName -like 'FAS-*-AllServices'
        )
    } |
    ForEach-Object {
        Write-Host "Disabling old task: $($_.TaskName)" -ForegroundColor Yellow
        Disable-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue | Out-Null
    }

# Run PowerShell directly (more reliable than cmd wrapper under SYSTEM)
$psArgs = ('-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppRoot "{1}"' -f $startPs1, $AppRoot)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $AppRoot

if ($useLogon) {
    $user = $env:USERNAME
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    if ($StartupDelayMinutes -gt 0) {
        $trigger.Delay = ('PT{0}M' -f $StartupDelayMinutes)
    }
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $desc = "Windal stack at logon for $user"
    Write-Host "Mode: At logon for $user (delay $StartupDelayMinutes min) - RECOMMENDED" -ForegroundColor Green
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    if ($StartupDelayMinutes -gt 0) {
        $trigger.Delay = ('PT{0}M' -f $StartupDelayMinutes)
    }
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $desc = ('Windal stack at startup (+{0} min delay) as SYSTEM' -f $StartupDelayMinutes)
    Write-Host "Mode: At system startup as SYSTEM (delay $StartupDelayMinutes min)" -ForegroundColor Cyan
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $desc -Force | Out-Null

Write-Host ''
Write-Host "Task created: $TaskName" -ForegroundColor Green
Write-Host ('Log file: {0}' -f (Join-Path $logsDir 'autostart-bootstrap.log'))
Write-Host ''
Write-Host 'Test now (Admin):' -ForegroundColor Yellow
Write-Host ('  schtasks /Run /TN "{0}"' -f $TaskName)
Write-Host '  Wait 90 sec, then open logs\autostart-bootstrap.log'
Write-Host ''
Write-Host 'After reboot: sign in to Windows, wait 2 min, check http://localhost:5174'
