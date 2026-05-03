<#
  Started by the API (background). Runs git pull + npm ci + build, then stops Node/cloudflared
  for this app and launches run-autostart-stack.cmd again.

  Log: logs\deploy-update.log
#>
$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AppRoot

$logDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'deploy-update.log'

function Log([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -LiteralPath $log -Value $line
    Write-Host $line
}

Log '--- deploy update started ---'
try {
    $who = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    Log ("Running as user: " + $who)
} catch {
    Log ("Running user detect failed: " + $_.Exception.Message)
}

function Add-PathIfExists([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return }
    if (-not (Test-Path -LiteralPath $p)) { return }
    $parts = ($env:Path -split ';') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
    if ($parts -notcontains $p) {
        $env:Path = "$env:Path;$p"
    }
}

function Resolve-CommandSafe([string]$name, [string[]]$fallbacks) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($f in $fallbacks) {
        if (Test-Path -LiteralPath $f) { return $f }
    }
    return $null
}

try {
    Add-PathIfExists (Join-Path $env:ProgramFiles 'Git\cmd')
    Add-PathIfExists (Join-Path $env:ProgramFiles 'Git\bin')
    Add-PathIfExists (Join-Path $env:ProgramFiles 'nodejs')
    Add-PathIfExists (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')

    $gitPath = Resolve-CommandSafe 'git.exe' @(
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        (Join-Path $env:ProgramFiles 'Git\bin\git.exe')
    )
    $npmPath = Resolve-CommandSafe 'npm.cmd' @(
        (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd')
    )
    Log ("git path: " + ($gitPath ?? 'NOT FOUND'))
    Log ("npm path: " + ($npmPath ?? 'NOT FOUND'))
    if ($gitPath) {
        $gv = (& $gitPath --version 2>&1 | Out-String).Trim()
        if ($gv) { Log ("git version: " + $gv) }
    }
    if ($npmPath) {
        $nv = (& $npmPath --version 2>&1 | Out-String).Trim()
        if ($nv) { Log ("npm version: " + $nv) }
    }
} catch {
    Log ("WARN command-path precheck failed: " + $_.Exception.Message)
}

function Stop-AppProcesses {
    Log 'Stopping app-related processes...'
    try {
        $likeRoot = '*' + $AppRoot + '*'
        $targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and
                ($_.CommandLine -like $likeRoot) -and
                ($_.Name -in @('node.exe', 'esbuild.exe', 'cloudflared.exe'))
            }
        foreach ($p in $targets) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                Log ("Stopped by path/name filter: " + $p.Name + " PID " + $p.ProcessId)
            } catch {
                Log ("Could not stop PID " + $p.ProcessId + ": " + $_.Exception.Message)
            }
        }
    } catch {
        Log ("WARN path-based stop failed: " + $_.Exception.Message)
    }

    try {
        Get-Process node, esbuild, cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                Stop-Process -Id $_.Id -Force -ErrorAction Stop
                Log ("Stopped by process-name filter: " + $_.ProcessName + " PID " + $_.Id)
            } catch {
                Log ("Could not stop " + $_.ProcessName + " PID " + $_.Id + ": " + $_.Exception.Message)
            }
        }
    } catch {
        Log ("WARN process-name stop failed: " + $_.Exception.Message)
    }
}

try {
    Stop-AppProcesses
    Start-Sleep -Seconds 1

    $updateScript = Join-Path $AppRoot 'update-from-git.ps1'
    if (-not (Test-Path -LiteralPath $updateScript)) {
        throw "Missing update-from-git.ps1"
    }
    Log 'Running update-from-git.ps1 -Branch main (subprocess) ...'
    $tmpOut = Join-Path $logDir ("update-from-git-" + [Guid]::NewGuid().ToString('N') + ".log")
    $updateProc = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        "`"$updateScript`"",
        '-Branch',
        'main'
    ) -WorkingDirectory $AppRoot -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpOut -Wait -PassThru
    if (Test-Path -LiteralPath $tmpOut) {
        try {
            Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue | ForEach-Object {
                $line = String($_).Trim()
                if ($line) { Log $line }
            }
        } finally {
            Remove-Item -LiteralPath $tmpOut -Force -ErrorAction SilentlyContinue
        }
    }
    if ($updateProc.ExitCode -ne 0) { throw "update-from-git.ps1 exited with code $($updateProc.ExitCode)" }
    Log 'update-from-git.ps1 finished OK'
} catch {
    Log ("ERROR in update step: " + $_.Exception.Message)
    exit 1
}

Stop-AppProcesses

Start-Sleep -Seconds 2

try {
    $psLauncher = Join-Path $AppRoot 'start-apptest-services.ps1'
    $cmdLauncher = Join-Path $AppRoot 'run-autostart-stack.cmd'
    if (Test-Path -LiteralPath $psLauncher) {
        Log 'Starting start-apptest-services.ps1...'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$psLauncher`"", '-AppRoot', "`"$AppRoot`"") -WorkingDirectory $AppRoot -WindowStyle Minimized
        Log 'start-apptest-services.ps1 started.'
    } elseif (Test-Path -LiteralPath $cmdLauncher) {
        Log 'Starting run-autostart-stack.cmd...'
        Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$cmdLauncher`"") -WorkingDirectory $AppRoot -WindowStyle Minimized
        Log 'run-autostart-stack.cmd started.'
    } else {
        Log 'WARN: Neither start-apptest-services.ps1 nor run-autostart-stack.cmd found — start services manually.'
    }
} catch {
    Log ("ERROR starting launcher: " + $_.Exception.Message)
    exit 1
}

Log '--- deploy update finished ---'
exit 0
