<#
.SYNOPSIS
  Stage all changes, commit, and push to origin/current branch.

.DESCRIPTION
  Use this on your local repo to quickly publish all pending changes.
  It runs:
    1) git add -A
    2) git commit -m "<message>"
    3) git push origin <current-branch>

.PARAMETER CommitMessage
  Commit message to use. If not provided, a timestamped default is used.

.EXAMPLE
  .\push-all-to-git.ps1 -CommitMessage "Update sale bill printing flow"

.EXAMPLE
  .\push-all-to-git.ps1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$CommitMessage = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not installed or not in PATH."
    }
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $RepoRoot

Ensure-Command "git"

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
    throw "This folder is not a git repository: $RepoRoot"
}

$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes to commit. Working tree is clean." -ForegroundColor Yellow
    exit 0
}

if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $CommitMessage = "Update project files ($stamp)"
}

Write-Host ""
Write-Host "==> Staging all changes" -ForegroundColor Cyan
git add -A
if ($LASTEXITCODE -ne 0) { throw "git add failed." }

Write-Host ""
Write-Host "==> Committing changes" -ForegroundColor Cyan
git commit -m $CommitMessage
if ($LASTEXITCODE -ne 0) { throw "git commit failed." }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
    throw "Could not detect current branch."
}

Write-Host ""
Write-Host "==> Pushing to origin/$branch" -ForegroundColor Cyan
git push origin $branch
if ($LASTEXITCODE -ne 0) { throw "git push failed." }

Write-Host ""
Write-Host "Done. Changes pushed to origin/$branch." -ForegroundColor Green
