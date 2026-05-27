# Deprecated — use: setup-windal-tunnel.cmd dal-srfipulses routes
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-windal-tunnel.ps1') -ClientKey dal-srfipulses -RoutesOnly
