# Wrapper: runs git_client_installation.txt without Invoke-Expression (encoding / parsing safe).
# Copy BOTH files to E:\WINDAL, then:
#   cd E:\WINDAL
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#   .\git_client_installation.ps1

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($here)) {
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$txt = Join-Path $here 'git_client_installation.txt'
if (-not (Test-Path -LiteralPath $txt)) {
    throw "Missing: $txt`nCopy git_client_installation.txt into the same folder as this script ($here)."
}

$tmp = Join-Path $env:TEMP ("git_client_install_" + [Guid]::NewGuid().ToString('n') + '.ps1')
try {
    $raw = Get-Content -LiteralPath $txt -Raw
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($tmp, $raw, $utf8Bom)
    & $tmp
} finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
