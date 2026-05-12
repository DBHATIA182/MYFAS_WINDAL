<#
.SYNOPSIS
  Pull latest code from Git, install exact dependencies (npm ci), rebuild UI.

.DESCRIPTION
  Run this on a client PC after the folder is a Git clone with
  remote "origin". Keeps package.json / lockfile in sync so imports like "xlsx" resolve.

.PARAMETER Branch
  Git branch to checkout and pull (default: main).

.EXAMPLE
  .\update-from-git.ps1
  .\update-from-git.ps1 -Branch develop
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Branch = "main"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AppRoot

function Ensure-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command '$name' is not in PATH. Install it and retry."
    }
}

Write-Host ""
Write-Host "==> APPTEST update-from-git ($Branch)" -ForegroundColor Cyan
Write-Host "    Folder: $AppRoot"

Ensure-Command "git"
Ensure-Command "npm"

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot ".git"))) {
    throw @"
This folder is not a Git repository (.git missing).

One-time fix on this PC:
  1. Rename or move the current folder (backup), e.g. APPTEST_OLD
  2. git clone <YOUR_REPO_URL> E:\WINDAL\APPTEST
  3. Copy back ONLY client-specific files (e.g. connection.config.json, config.yml for cloudflared)
  4. Run: npm ci
  5. Run: npm run build
  6. Run this script again for future updates.
"@
}

git fetch origin
if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }

git checkout $Branch
if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed." }

# Stash local edits (e.g. old hardcoded APP_ROOT in Update-APPTEST-From-Desktop.cmd), pull, then re-apply.
# Requires Git for Windows 2.27+; avoids "would be overwritten by merge" when the desktop launcher was modified.
git pull origin $Branch --autostash
if ($LASTEXITCODE -ne 0) {
    throw @"
git pull failed.

If the error mentions unknown option 'autostash', upgrade Git for Windows (2.27+), then run this script again.
Otherwise: open a terminal in this folder, run  git status , fix conflicts or run  git stash -u  then  git pull origin $Branch  then  git stash pop , and run this script again.
"@
}

Write-Host ""
Write-Host "==> npm ci (exact deps from package-lock.json)" -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

Write-Host ""
Write-Host "==> npm run build (production UI in dist\)" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

Write-Host ""
Write-Host "Done. Restart whatever runs Node on this PC:" -ForegroundColor Green
Write-Host "  - If you use start-apptest-services.ps1: close the old API/dev/tunnel windows, then run it again." -ForegroundColor Green
Write-Host "  - If you use Task Scheduler / NSSM: restart those services." -ForegroundColor Green
Write-Host ""
