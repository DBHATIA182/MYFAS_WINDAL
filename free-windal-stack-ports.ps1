# Free listeners on Windal stack ports before (re)start. Used by .bat/.cmd starters.
param(
    [int[]]$Ports = @(5001, 5173, 5174)
)
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
        Write-Host "  stopping PID $procId (was listening on port $port)"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            & $env:SystemRoot\System32\taskkill.exe /F /PID $procId | Out-Null
        }
    }
}
