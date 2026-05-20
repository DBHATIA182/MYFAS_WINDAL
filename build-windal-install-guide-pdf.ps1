<#
  Builds docs\WINDAL_CLIENT_INSTALLATION.pdf from docs\WINDAL_CLIENT_INSTALLATION_GUIDE.html using Edge headless.
  Run from the apptest folder; requires Microsoft Edge.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = Join-Path $root "docs\WINDAL_CLIENT_INSTALLATION_GUIDE.html"
$pdf = Join-Path $root "docs\WINDAL_CLIENT_INSTALLATION.pdf"
if (-not (Test-Path -LiteralPath $html)) {
    throw "Missing: $html"
}
$edgeCandidates = @(
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
    throw "Microsoft Edge (msedge.exe) not found. Open WINDAL_CLIENT_INSTALLATION_GUIDE.html in a browser and use Print -> Save as PDF."
}
$fileUrl = "file:///" + ($html -replace "\\", "/")
& $edge --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $fileUrl
Start-Sleep -Seconds 2
if (-not (Test-Path -LiteralPath $pdf)) {
    throw "PDF was not created. Try opening the HTML and Print to PDF manually."
}
Write-Host "Wrote: $pdf" -ForegroundColor Green
