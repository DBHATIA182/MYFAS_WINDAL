<#
.SYNOPSIS
  Pull latest code from Git, install exact dependencies (npm ci), rebuild UI.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Branch = "main",
    [string]$AppRoot = "",
    [switch]$SkipProcessStop
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
Set-Location -LiteralPath $AppRoot

function Ensure-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command '$name' is not in PATH. Install it and retry."
    }
}

function Invoke-Npm([string[]]$npmArgs) {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        & $npmCmd.Source @npmArgs
    } else {
        & npm @npmArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($npmArgs -join ' ') failed (exit $LASTEXITCODE)."
    }
}

if (-not $SkipProcessStop) {
    $stopScript = Join-Path $AppRoot "stop-apptest-services.ps1"
    if (Test-Path -LiteralPath $stopScript) {
        Write-Host ""
        Write-Host "==> Ensuring no APPTEST processes lock files..." -ForegroundColor Cyan
        & $stopScript -AppRoot $AppRoot -ReleaseApiPort5001 -ReleasePorts5174 -WaitSeconds 2
    }
}

Write-Host ""
Write-Host "==> APPTEST update-from-git ($Branch)" -ForegroundColor Cyan
Write-Host "    Folder: $AppRoot"

Ensure-Command "git"

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot ".git"))) {
    throw @"
This folder is not a Git repository (.git missing).

One-time fix on this PC:
  1. Rename current folder to apptest_old
  2. git clone <YOUR_REPO_URL> D:\windal\apptest
  3. Copy connection.config.json, config.yml, and tunnel *.json from backup
  4. npm.cmd ci && npm.cmd run build
"@
}

git fetch origin
if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }

git checkout $Branch
if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed." }

git pull origin $Branch --autostash
if ($LASTEXITCODE -ne 0) {
    throw @"
git pull failed.

Run: git status
Then: git stash -u
Then: git pull origin $Branch
Then: git stash pop
"@
}

Write-Host ""
Write-Host "==> npm ci" -ForegroundColor Cyan
Invoke-Npm @("ci")

Write-Host ""
Write-Host "==> npm run build" -ForegroundColor Cyan
Invoke-Npm @("run", "build")

Write-Host ""
Write-Host "Done. Restart API + Vite + tunnel if not started automatically." -ForegroundColor Green
exit 0
