# Free listeners on Windal stack ports before (re)start. Used by .bat/.cmd starters.
param(
    [object[]]$Ports = @(5001, 5173, 5174)
)
# .cmd passes -Ports 5001,5174,5175 as one string; normalize to int[].
$flat = @($Ports | ForEach-Object { ($_ -as [string]).Split(',') } | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' })
if ($flat.Count -gt 0) {
    $Ports = [int[]]$flat
}
$ErrorActionPreference = 'SilentlyContinue'
foreach ($port in $Ports) {
    $pids = [System.Collections.Generic.HashSet[int]]::new()

    foreach ($c in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        [void]$pids.Add([int]$c.OwningProcess)
    }

    foreach ($line in netstat -ano 2>$null) {
        if ($line -notmatch ":$port\s+.*LISTENING") { continue }
        $tok = ($line -replace '\s+', ' ').Trim().Split(' ')
        $last = $tok[-1]
        if ($last -match '^\d+$') { [void]$pids.Add([int]$last) }
    }

    foreach ($procId in $pids) {
        if ($procId -le 4) { continue }
        $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Write-Host "  stopping PID $procId ($procName) on port $port"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            & $env:SystemRoot\System32\taskkill.exe /F /PID $procId 2>&1 | ForEach-Object { Write-Host $_ }
        }
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            Write-Host "  ERROR: could not stop PID $procId - close its terminal or run this script as Administrator."
        }
    }
}
