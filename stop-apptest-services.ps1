<#
.SYNOPSIS
  Stops APPTEST runtime processes (API, frontend, tunnel) for this app folder.

.DESCRIPTION
  Safely stops only processes tied to the current AppRoot path:
  - node.exe running server.cjs or vite
  - cloudflared.exe using this app's config/path

  Optional switches can also stop known scheduled tasks and Windows services
  for the configured client.

.PARAMETER AppRoot
  App folder path. Defaults to this script's folder.

.PARAMETER StopScheduledTasks
  Also stop scheduled tasks:
  FAS-<client>-API, FAS-<client>-AllServices, FAS-<client>-AppStack

.PARAMETER StopWindowsServices
  Also stop Windows services with names:
  FAS-<client>-API or FAS-<client>-AllServices (if present).

.PARAMETER ReleaseApiPort5001
  After the normal stop, find anything listening on TCP port 5001 and stop it if the
  process is node.exe (frees the API port when a stray Node process was missed).

.EXAMPLE
  .\stop-apptest-services.ps1

.EXAMPLE
  .\stop-apptest-services.ps1 -StopScheduledTasks -StopWindowsServices

.EXAMPLE
  .\stop-apptest-services.ps1 -ReleaseApiPort5001
#>
[CmdletBinding()]
param(
    [string]$AppRoot = "",
    [switch]$StopScheduledTasks,
    [switch]$StopWindowsServices,
    [switch]$ReleaseApiPort5001
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Log([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
    Write-Host $Message -ForegroundColor $Color
}

function Safe-StopProcessById([int]$ProcessId, [string]$Label) {
    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Log ("Stopped {0} (PID {1})" -f $Label, $ProcessId) Green
    } catch {
        Log ("Could not stop {0} (PID {1}): {2}" -f $Label, $ProcessId, $_.Exception.Message) Yellow
    }
}

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$likeRoot = "*" + $AppRoot + "*"

Log ""
Log ("==> Stopping APPTEST processes for: {0}" -f $AppRoot) Cyan

# 1) Stop Node processes tied to this app folder (API + Vite).
$nodeCandidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "node.exe" -and
        $_.CommandLine -and
        $_.CommandLine -like $likeRoot -and
        ($_.CommandLine -match "server\.cjs" -or $_.CommandLine -match "vite")
    }

if ($nodeCandidates) {
    foreach ($p in $nodeCandidates) {
        Safe-StopProcessById -ProcessId $p.ProcessId -Label "node.exe"
    }
} else {
    Log "No node.exe API/frontend process found for this app." DarkYellow
}

# 2) Stop cloudflared processes tied to this app folder.
$cloudCandidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "cloudflared.exe" -and
        $_.CommandLine -and
        $_.CommandLine -like $likeRoot
    }

if ($cloudCandidates) {
    foreach ($p in $cloudCandidates) {
        Safe-StopProcessById -ProcessId $p.ProcessId -Label "cloudflared.exe"
    }
} else {
    Log "No cloudflared.exe process found for this app." DarkYellow
}

# 2b) Optional: free API port when a Node listener was not matched by path (EADDRINUSE on 5001).
if ($ReleaseApiPort5001) {
    Log ""
    Log "==> Checking TCP port 5001 (API)..." Cyan
    try {
        $rawPids = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { $_.OwningProcess }
        $pids = @($rawPids | Sort-Object -Unique | Where-Object { $_ -and $_ -gt 4 })
        if ($pids.Count -eq 0) {
            Log "No LISTEN process found on port 5001." DarkYellow
        }
        foreach ($procId in $pids) {
            $wp = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
            if (-not $wp) { continue }
            if ($wp.Name -ne "node.exe") {
                Log ("Port 5001: PID {0} is {1} - not stopped automatically. Close it manually if needed." -f $procId, $wp.Name) Yellow
                continue
            }
            Safe-StopProcessById -ProcessId $procId -Label "node.exe (listener on :5001)"
        }
    } catch {
        Log ("Port check failed: {0}" -f $_.Exception.Message) Yellow
    }
}

# 3) Optional: stop known scheduled tasks for this client.
$clientKey = ""
$cfgPath = Join-Path $AppRoot "connection.config.json"
if (Test-Path -LiteralPath $cfgPath) {
    try {
        $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
        if ($cfg.PSObject.Properties.Name -contains "clientName" -and -not [string]::IsNullOrWhiteSpace([string]$cfg.clientName)) {
            $clientKey = [string]$cfg.clientName
        } elseif ($cfg.PSObject.Properties.Name -contains "defaultClientKey" -and -not [string]::IsNullOrWhiteSpace([string]$cfg.defaultClientKey)) {
            $clientKey = [string]$cfg.defaultClientKey
        } else {
            $clientKey = ""
        }
    } catch {
        Log ("Could not parse connection.config.json: {0}" -f $_.Exception.Message) Yellow
    }
}

if ($StopScheduledTasks) {
    if ([string]::IsNullOrWhiteSpace($clientKey)) {
        Log "Skipping scheduled task stop: clientName/defaultClientKey not found in connection.config.json" Yellow
    } else {
        $taskNames = @(
            "FAS-$clientKey-API",
            "FAS-$clientKey-AllServices",
            "FAS-$clientKey-AppStack"
        )
        foreach ($taskName in $taskNames) {
            try {
                Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
                Log ("Stopped scheduled task: {0}" -f $taskName) Green
            } catch {
                Log ("Task not running or not found: {0}" -f $taskName) DarkYellow
            }
        }
    }
}

# 4) Optional: stop likely NSSM service names for this client.
if ($StopWindowsServices) {
    if ([string]::IsNullOrWhiteSpace($clientKey)) {
        Log "Skipping service stop: clientName/defaultClientKey not found in connection.config.json" Yellow
    } else {
        $serviceNames = @(
            "FAS-$clientKey-API",
            "FAS-$clientKey-AllServices"
        )
        foreach ($serviceName in $serviceNames) {
            try {
                $svc = Get-Service -Name $serviceName -ErrorAction Stop
                if ($svc.Status -ne "Stopped") {
                    Stop-Service -Name $serviceName -Force -ErrorAction Stop
                    Log ("Stopped Windows service: {0}" -f $serviceName) Green
                } else {
                    Log ("Service already stopped: {0}" -f $serviceName) DarkYellow
                }
            } catch {
                Log ("Service not found or could not stop: {0}" -f $serviceName) DarkYellow
            }
        }
    }
}

Start-Sleep -Seconds 1

try {
    $still5001 = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
    if ($still5001) {
        Log ""
        Log "Port 5001 is still in use (API will fail with EADDRINUSE). Run:" Yellow
        Log "  .\stop-apptest-services.ps1 -ReleaseApiPort5001" Yellow
        Log "Or stop the owning process in Task Manager (Details tab: find PID from netstat)." Yellow
    }
} catch {
    # Get-NetTCPConnection not available on very old hosts; ignore.
}

Log ""
Log "Done. APPTEST runtime processes are stopped for this app root." Cyan
