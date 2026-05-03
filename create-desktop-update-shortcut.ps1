param(
    [string]$AppRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$targetCmd = Join-Path $AppRoot "Update-APPTEST-From-Desktop.cmd"

if (-not (Test-Path -LiteralPath $targetCmd)) {
    throw "Updater batch file not found: $targetCmd"
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktopPath)) {
    throw "Could not resolve Desktop folder for current user."
}

$shortcutPath = Join-Path $desktopPath "APPTEST Update.lnk"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetCmd
$shortcut.WorkingDirectory = $AppRoot
$shortcut.WindowStyle = 1
$shortcut.IconLocation = "shell32.dll,238"
$shortcut.Description = "Stop services, update from Git, and restart APPTEST services."
$shortcut.Save()

Write-Host ""
Write-Host "Shortcut created:" -ForegroundColor Green
Write-Host "  $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "Tip: Right-click shortcut -> Properties -> Advanced -> Run as administrator." -ForegroundColor Yellow
