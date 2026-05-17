<#
.SYNOPSIS
  Stops APPTEST runtime processes (API, frontend, tunnel) for this app folder.

.PARAMETER StopScheduledTasks
  Stop FAS-<client>-* scheduled tasks (recommended before git update on client PC).

.PARAMETER ReleaseApiPort5001
  Kill node.exe listening on TCP 5001.

.PARAMETER ReleasePorts5174
  Free TCP 5174 (Vite) via free-windal-stack-ports.ps1.

.PARAMETER WaitSeconds
  Pause after stop so file handles are released before npm ci / git pull.
#>
[CmdletBinding()]
param(
    [string]$AppRoot = "",
    [switch]$StopScheduledTasks,
    [switch]$StopWindowsServices,
    [switch]$ReleaseApiPort5001,
    [switch]$ReleasePorts5174,
    [int]$WaitSeconds = 2
)

$ErrorActionPreference = "Continue"

function Log([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
    Write-Host $Message -ForegroundColor $Color
}

function Normalize-PathForMatch([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return "" }
    try {
        return [System.IO.Path]::GetFullPath($path).TrimEnd('\', '/')
    } catch {
        return $path.Trim().TrimEnd('\', '/')
    }
}

function Test-CommandLineInAppRoot([string]$commandLine, [string]$rootNorm) {
    if ([string]::IsNullOrWhiteSpace($commandLine) -or [string]::IsNullOrWhiteSpace($rootNorm)) {
        return $false
    }
    $cmd = $commandLine -replace '/', '\'
    return $cmd.IndexOf($rootNorm, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Safe-StopProcessById([int]$ProcessId, [string]$Label) {
    if ($ProcessId -le 4) { return }
    try {
        $alive = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if (-not $alive) { return }
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Log ("Stopped {0} (PID {1})" -f $Label, $ProcessId) Green
    } catch {
        Log ("Could not stop {0} (PID {1}): {2}" -f $Label, $ProcessId, $_.Exception.Message) Yellow
        try {
            & $env:SystemRoot\System32\taskkill.exe /F /PID $ProcessId 2>&1 | Out-Null
            Log ("taskkill /F /PID {0}" -f $ProcessId) Yellow
        } catch {
            # ignore
        }
    }
}

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$rootNorm = Normalize-PathForMatch $AppRoot

Log ""
Log ("==> Stopping APPTEST processes for: {0}" -f $AppRoot) Cyan

# 1) Any node.exe started from this app folder (API, Vite, npm, etc.).
$nodeCandidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "node.exe" -and (Test-CommandLineInAppRoot $_.CommandLine $rootNorm)
    })

foreach ($p in $nodeCandidates) {
    Safe-StopProcessById -ProcessId $p.ProcessId -Label "node.exe"
}
if ($nodeCandidates.Count -eq 0) {
    Log "No node.exe process found for this app folder." DarkYellow
}

# 1b) esbuild (Vite / build) often outlives the parent node briefly.
$esbuildCandidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "esbuild.exe" -and (Test-CommandLineInAppRoot $_.CommandLine $rootNorm)
    })
foreach ($p in $esbuildCandidates) {
    Safe-StopProcessById -ProcessId $p.ProcessId -Label "esbuild.exe"
}

# 2) cloudflared using this app's config path.
$cloudCandidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "cloudflared.exe" -and (Test-CommandLineInAppRoot $_.CommandLine $rootNorm)
    })
foreach ($p in $cloudCandidates) {
    Safe-StopProcessById -ProcessId $p.ProcessId -Label "cloudflared.exe"
}
if ($cloudCandidates.Count -eq 0) {
    Log "No cloudflared.exe process found for this app folder." DarkYellow
}

# 3) Free stack ports (node listeners not matched by command line).
$freeScript = Join-Path $AppRoot "free-windal-stack-ports.ps1"
if ($ReleaseApiPort5001 -or $ReleasePorts5174) {
    $ports = @()
    if ($ReleaseApiPort5001) { $ports += 5001 }
    if ($ReleasePorts5174) { $ports += 5174 }
    if (Test-Path -LiteralPath $freeScript) {
        Log ""
        Log ("==> Freeing ports: {0}" -f ($ports -join ", ")) Cyan
        & $freeScript -Ports $ports
    } else {
        Log "free-windal-stack-ports.ps1 not found; skipping port cleanup." Yellow
    }
}

$clientKey = ""
$cfgPath = Join-Path $AppRoot "connection.config.json"
if (Test-Path -LiteralPath $cfgPath) {
    try {
        $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
        if ($cfg.PSObject.Properties.Name -contains "clientName" -and -not [string]::IsNullOrWhiteSpace([string]$cfg.clientName)) {
            $clientKey = [string]$cfg.clientName
        } elseif ($cfg.PSObject.Properties.Name -contains "defaultClientKey") {
            $clientKey = [string]$cfg.defaultClientKey
        }
    } catch {
        Log ("Could not parse connection.config.json: {0}" -f $_.Exception.Message) Yellow
    }
}

if ($StopScheduledTasks -and -not [string]::IsNullOrWhiteSpace($clientKey)) {
    Log ""
    Log "==> Stopping scheduled tasks (prevent auto-restart during update)..." Cyan
    foreach ($taskName in @("FAS-$clientKey-API", "FAS-$clientKey-AllServices", "FAS-$clientKey-AppStack")) {
        try {
            $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($t) {
                Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
                Log ("Stopped scheduled task: {0}" -f $taskName) Green
            }
        } catch {
            Log ("Task not found or not running: {0}" -f $taskName) DarkYellow
        }
    }
}

if ($StopWindowsServices -and -not [string]::IsNullOrWhiteSpace($clientKey)) {
    foreach ($serviceName in @("FAS-$clientKey-API", "FAS-$clientKey-AllServices")) {
        try {
            $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -ne "Stopped") {
                Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
                Log ("Stopped Windows service: {0}" -f $serviceName) Green
            }
        } catch {
            Log ("Service not found: {0}" -f $serviceName) DarkYellow
        }
    }
}

if ($WaitSeconds -gt 0) {
    Log ""
    Log ("Waiting {0}s for file handles to release..." -f $WaitSeconds) DarkGray
    Start-Sleep -Seconds $WaitSeconds
}

Log ""
Log "Done. APPTEST runtime processes are stopped for this app root." Cyan
exit 0
