<#
.SYNOPSIS
  Restart Windal stack: free ports 5001/5174, then start API + Vite + tunnel in background (log files only).

.PARAMETER AppRoot
  APPTEST folder (default: script directory).

.PARAMETER Ports
  TCP ports to free before start (default 5001, 5174).

.PARAMETER KillAllCloudflared
  Stops all cloudflared.exe. Default false - other client tunnels on the same PC are left running.

.PARAMETER WaitSeconds
  Seconds to wait after freeing ports (default 3).

.PARAMETER ProductionWeb
  Build once and serve with vite preview (recommended for phone on dal-demo). Slower restart; much more reliable than Vite dev through Cloudflare.
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [int[]]$Ports = @(5001, 5174, 5175),
    [switch]$KillAllCloudflared,
    [int]$WaitSeconds = 3,
    [switch]$ProductionWeb = $true
)

$ErrorActionPreference = 'Continue'

function Get-NormalizedAppRoot {
    param(
        [string]$Path,
        [string]$Fallback
    )
    $p = [string]$Path
    if ([string]::IsNullOrWhiteSpace($p)) {
        $p = $Fallback
    }
    $p = $p.Trim().Trim('"').Trim("'")
    while ($p.Length -gt 3 -and ($p.EndsWith('\') -or $p.EndsWith('/'))) {
        $p = $p.Substring(0, $p.Length - 1)
    }
    if (-not (Test-Path -LiteralPath $p)) {
        throw "App folder not found: '$p' (check -AppRoot; avoid trailing backslash inside quotes from .cmd)"
    }
    return (Resolve-Path -LiteralPath $p).Path
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Get-NormalizedAppRoot -Path $AppRoot -Fallback $scriptDir

$logsDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}
$bootProbe = Join-Path $logsDir 'autostart-bootstrap.log'
try {
    Add-Content -LiteralPath $bootProbe -Value ('[{0}] Start-WindalStack.ps1 started USER={1} COMPUTER={2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $env:USERNAME, $env:COMPUTERNAME) -Encoding UTF8
} catch {
    # ignore probe write errors
}

$stackLog = Join-Path $logsDir 'windal-stack.log'
function Write-StackLog([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $stackLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Add-ToolPaths {
    $extra = @(
        ${env:ProgramFiles} + '\Cloudflared',
        ${env:ProgramFiles(x86)} + '\Cloudflared',
        ${env:ProgramFiles} + '\cloudflared',
        ${env:ProgramFiles(x86)} + '\cloudflared',
        ${env:ProgramFiles} + '\nodejs',
        $env:LOCALAPPDATA + '\Programs\nodejs'
    )
    foreach ($p in $extra) {
        if ((Test-Path -LiteralPath $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path = "$p;$env:Path"
        }
    }
}

function Test-PortListening([int]$port) {
    foreach ($c in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        if ($c.OwningProcess -gt 4) { return $true }
    }
    foreach ($line in netstat -ano 2>$null) {
        if ($line -match ":$port\s+.*LISTENING") { return $true }
    }
    return $false
}

function Resolve-ToolExe {
    param([string]$Name)
    $map = @{
        'node.exe' = @(
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        )
        'npm.cmd' = @(
            (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd')
        )
        'cloudflared.exe' = @(
            (Join-Path $env:ProgramFiles 'Cloudflared\cloudflared.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Cloudflared\cloudflared.exe'),
            (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe')
        )
    }
    foreach ($p in $map[$Name]) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Start-HiddenCmdJob {
    param(
        [string]$Name,
        [string]$CmdLine,
        [string]$LogFile
    )
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $banner = "echo. & echo === $Name started $stamp === & echo."
    $full = "cd /d `"$AppRoot`" & $banner & $CmdLine >> `"$LogFile`" 2>&1"
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $full) -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru
    Write-StackLog "$Name started (PID $($p.Id)) -> $LogFile"
}

Add-ToolPaths
Write-StackLog "=== Windal stack restart === AppRoot=$AppRoot"

$freeScript = Join-Path $AppRoot 'free-windal-stack-ports.ps1'
if (-not (Test-Path -LiteralPath $freeScript)) {
    throw "Missing $freeScript"
}

Write-StackLog "Freeing ports: $($Ports -join ', ')"
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $freeScript -Ports $Ports 2>&1 | ForEach-Object { Write-StackLog $_ }

if ($KillAllCloudflared) {
    Write-StackLog 'Stopping all cloudflared.exe'
    & $env:SystemRoot\System32\taskkill.exe /F /IM cloudflared.exe 2>&1 | ForEach-Object { Write-StackLog $_ }
}

if ($WaitSeconds -gt 0) {
    Start-Sleep -Seconds $WaitSeconds
}

foreach ($port in $Ports) {
    if (Test-PortListening $port) {
        Write-StackLog "Port $port still in use - freeing again"
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $freeScript -Ports @($port) 2>&1 | ForEach-Object { Write-StackLog $_ }
        Start-Sleep -Seconds 2
        if (Test-PortListening $port) {
            Write-StackLog "ERROR: port $port still LISTENING - stop the process manually or reboot"
        } else {
            Write-StackLog "Port $port is now free."
        }
    } else {
        Write-StackLog "Port $port is free."
    }
}

$nodeExe = Resolve-ToolExe 'node.exe'
$npmCmd = Resolve-ToolExe 'npm.cmd'
if (-not $nodeExe) {
    Write-StackLog 'ERROR: node.exe not found. Install Node.js LTS to Program Files\nodejs'
    exit 1
}
if (-not $npmCmd) {
    Write-StackLog 'ERROR: npm.cmd not found.'
    exit 1
}
Write-StackLog "Using node: $nodeExe"

$serverLog = Join-Path $logsDir 'server.log'
$frontendLog = Join-Path $logsDir 'frontend.log'
$tunnelLog = Join-Path $logsDir 'tunnel.log'

$nodeQ = '"' + $nodeExe + '"'
$npmQ = '"' + $npmCmd + '"'
Start-HiddenCmdJob -Name 'Windal-API' -CmdLine "$nodeQ server.cjs" -LogFile $serverLog
Start-Sleep -Seconds 2

if ($ProductionWeb) {
    Write-StackLog 'ProductionWeb: npm run build (for mobile / dal-demo tunnel)'
    $buildLog = Join-Path $logsDir 'frontend-build.log'
    $buildCmd = "cd /d `"$AppRoot`" & $npmQ run build >> `"$buildLog`" 2>&1"
    $bp = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $buildCmd) -WorkingDirectory $AppRoot -WindowStyle Hidden -Wait -PassThru
    if ($bp.ExitCode -ne 0) {
        Write-StackLog "ERROR: npm run build failed (exit $($bp.ExitCode)). See $buildLog"
        exit $bp.ExitCode
    }
    Write-StackLog 'ProductionWeb: starting vite preview on 5174'
    Start-HiddenCmdJob -Name 'Windal-Preview' -CmdLine "$npmQ run preview" -LogFile $frontendLog
} else {
    Write-StackLog 'WARNING: Starting Vite DEV on port 5175 only - dal-demo tunnel needs -ProductionWeb (default).'
    Start-HiddenCmdJob -Name 'Windal-Vite' -CmdLine "$npmQ run dev" -LogFile $frontendLog
}
Start-Sleep -Seconds 8

try {
    $probe = Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 15
    $body = [string]$probe.Content
    if ($body -match '/SRC/main\.jsx|/@vite/client') {
        Write-StackLog 'ERROR: Port 5174 is still Vite DEV. Stop all node on 5174, then run this script again (do not run npm run dev on 5174).'
    } elseif ($body -match '/assets/index-[^"]+\.js') {
        Write-StackLog 'OK: Port 5174 is production preview (/assets/ bundle) - phone should work after cache clear.'
    } else {
        Write-StackLog 'WARNING: Port 5174 responded but HTML format unexpected. Check logs\frontend.log'
    }
} catch {
    Write-StackLog "WARNING: Could not probe http://127.0.0.1:5174/ - $($_.Exception.Message)"
}

Start-Sleep -Seconds 1

$configYml = Join-Path $AppRoot 'config.yml'
$cfExe = Resolve-ToolExe 'cloudflared.exe'
if ((Test-Path -LiteralPath $configYml) -and $cfExe) {
    $cfQ = '"' + $cfExe + '"'
    Start-HiddenCmdJob -Name 'Windal-Tunnel' -CmdLine "$cfQ tunnel --config `"$configYml`" run" -LogFile $tunnelLog
} elseif (-not (Test-Path -LiteralPath $configYml)) {
    Write-StackLog 'WARNING: config.yml missing - tunnel not started'
} else {
    Write-StackLog 'WARNING: cloudflared.exe not found - tunnel not started'
}

Write-StackLog 'Done. No taskbar windows (background). Check logs\server.log if site does not load.'
Write-StackLog 'Auto-start at boot (Admin): setup-windal-autostart.cmd'
