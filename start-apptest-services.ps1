param(
    [string]$AppRoot,
    [string]$CloudflaredConfig
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptRoot
}

if ([string]::IsNullOrWhiteSpace($CloudflaredConfig)) {
    $CloudflaredConfig = Join-Path $AppRoot "config.yml"
}

function Resolve-CloudflaredPath {
    $cloudflaredFromPath = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($cloudflaredFromPath) {
        return $cloudflaredFromPath.Source
    }

    $localCloudflared = Join-Path $AppRoot "cloudflared.exe"
    if (Test-Path -LiteralPath $localCloudflared) {
        return $localCloudflared
    }

    throw "cloudflared.exe was not found in PATH or in $AppRoot"
}

if (-not (Test-Path -LiteralPath $AppRoot)) {
    throw "App folder not found: $AppRoot"
}

if (-not (Test-Path -LiteralPath $CloudflaredConfig)) {
    throw "Cloudflared config not found: $CloudflaredConfig"
}

$cloudflaredExe = Resolve-CloudflaredPath

$nodePathSuffix = "`$env:Path += ';' + [Environment]::GetEnvironmentVariable('ProgramFiles') + '\nodejs;' + [Environment]::GetEnvironmentVariable('LOCALAPPDATA') + '\Programs\nodejs'"
$serverCommand = "Set-Location -LiteralPath '$AppRoot'; $nodePathSuffix; npm.cmd run server"
$frontendCommand = "Set-Location -LiteralPath '$AppRoot'; $nodePathSuffix; npm.cmd run dev -- --host 0.0.0.0 --port 5174"
$tunnelCommand = "Set-Location -LiteralPath '$AppRoot'; & '$cloudflaredExe' tunnel --config '$CloudflaredConfig' run"

Start-Process -FilePath "powershell.exe" -WorkingDirectory $AppRoot -ArgumentList @("-NoExit", "-Command", $serverCommand)
Start-Sleep -Seconds 2

Start-Process -FilePath "powershell.exe" -WorkingDirectory $AppRoot -ArgumentList @("-NoExit", "-Command", $frontendCommand)
Start-Sleep -Seconds 2

Start-Process -FilePath "powershell.exe" -WorkingDirectory $AppRoot -ArgumentList @("-NoExit", "-Command", $tunnelCommand)

Write-Host "Started API, frontend, and tunnel terminals."
