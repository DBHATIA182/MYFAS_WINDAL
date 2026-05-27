<#
.SYNOPSIS
  Create or reuse a Cloudflare tunnel, add DNS routes, write config.yml + credentials JSON.

.DESCRIPTION
  One script — no multi-line paste. Finds cloudflared under Program Files (x86) first
  (avoids the broken C:\Windows\System32\cloudflared.exe stub).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-windal-tunnel.ps1 -ClientKey dal-srfipulses

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-windal-tunnel.ps1 -ClientKey dal-srfipulses -RoutesOnly

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-windal-tunnel.ps1 -Login
#>
param(
    [Parameter(ParameterSetName = 'Tunnel', Mandatory = $true)]
    [string]$ClientKey,

    [Parameter(ParameterSetName = 'Login')]
    [switch]$Login,

    [switch]$FullClientSetup,
    [switch]$RoutesOnly,

    [string]$BaseDomain = 'fasaccountingsoftware.in',
    [int]$DevPort = 5174,
    [int]$ApiPort = 5001,

    [string]$OraclePrimaryUser = 'DAL',
    [string]$OraclePrimaryPassword = 'DAL',
    [string]$OracleSecondaryUser = 'DAL',
    [string]$OracleSecondaryPassword = 'DAL',
    [string]$OracleConnectString = 'XE'
)

$ErrorActionPreference = 'Stop'
$appRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -LiteralPath $appRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-CloudflaredExe {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Cloudflared\cloudflared.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
        (Join-Path $env:ProgramFiles 'Cloudflared\cloudflared.exe'),
        (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Cloudflared\cloudflared.exe')
    )
    foreach ($p in $candidates) {
        if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p).Length -gt 1000)) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }
    throw @"
cloudflared.exe not found.

Install:  winget install Cloudflare.cloudflared
Then run this script again.
"@
}

function Invoke-Cf {
    param([Parameter(Mandatory)][string[]]$Args)
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $script:CfExe -ArgumentList $Args -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $output = @(
            if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw }
            if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw }
        ) -join [Environment]::NewLine
        $output = $output.Trim()
        if ($p.ExitCode -ne 0) {
            throw "cloudflared failed: $($Args -join ' ')`n$output"
        }
        return $output
    }
    finally {
        Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
    }
}

function Invoke-CfAllowAlready {
    param([Parameter(Mandatory)][string[]]$Args)
    try {
        return Invoke-Cf -Args $Args
    }
    catch {
        $msg = $_.Exception.Message
        if ($msg -match 'already exists|already configured') {
            Write-Host $msg -ForegroundColor DarkYellow
            return $msg
        }
        throw
    }
}

function Add-TunnelDnsRoute {
    param([string]$TunnelRef, [string]$Hostname)
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $script:CfExe -ArgumentList @(
            'tunnel', 'route', 'dns', '-f', $TunnelRef, $Hostname
        ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $output = @(
            if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw }
            if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw }
        ) -join [Environment]::NewLine
        $output = $output.Trim()
        if ($p.ExitCode -eq 0) {
            Write-Host $output -ForegroundColor Green
            return
        }
        if ($output -match 'Added CNAME|already exists|already configured|code:\s*1003') {
            Write-Host "OK (route present): $Hostname" -ForegroundColor DarkYellow
            if ($output) { Write-Host $output -ForegroundColor DarkGray }
            return
        }
        throw "DNS route failed for $Hostname`n$output"
    }
    finally {
        Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
    }
}

function Get-TunnelUuidFromList {
    param([string]$Name)
    $uuidRegex = [regex]'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    $list = Invoke-Cf -Args @('tunnel', 'list')
    $line = ($list -split "`r?`n" | Where-Object { $_ -match "\s$([regex]::Escape($Name))\s" } | Select-Object -First 1)
    if (-not $line) {
        throw "Tunnel '$Name' not found. Run without -RoutesOnly to create it, or check Cloudflare Zero Trust > Tunnels."
    }
    $m = $uuidRegex.Match($line)
    if (-not $m.Success) { throw "Could not read tunnel UUID from: $line" }
    return $m.Value.ToLower()
}

function Ensure-CredentialsJson {
    param([string]$Uuid)
    $userCred = Join-Path $env:USERPROFILE ".cloudflared\$Uuid.json"
    $appCred = Join-Path $appRoot "$Uuid.json"
    if (-not (Test-Path -LiteralPath $userCred)) {
        Write-Step "Fetching tunnel token"
        Invoke-Cf -Args @('tunnel', 'token', '--cred-file', $userCred, $Uuid) | Out-Null
    }
    if (-not (Test-Path -LiteralPath $userCred)) {
        throw "Missing credentials: $userCred. Run: setup-windal-tunnel.cmd login"
    }
    Copy-Item -LiteralPath $userCred -Destination $appCred -Force
    Write-Host "Credentials: $appCred" -ForegroundColor Green
    return $appCred
}

function Write-ConfigYml {
    param(
        [string]$Uuid,
        [string]$AppHost,
        [string]$ApiHost,
        [int]$WebPort,
        [int]$ApiPortLocal
    )
    $path = Join-Path $appRoot 'config.yml'
    $lines = @(
        "tunnel: $Uuid",
        "credentials-file: ./$Uuid.json",
        '',
        'ingress:',
        "  - hostname: $AppHost",
        "    service: http://localhost:$WebPort",
        "  - hostname: $ApiHost",
        "    service: http://localhost:$ApiPortLocal",
        '  - service: http_status:404'
    )
    $lines | Set-Content -Path $path -Encoding UTF8
    Write-Host "config.yml: $path" -ForegroundColor Green
}

$script:CfExe = Get-CloudflaredExe
Write-Host "cloudflared: $script:CfExe" -ForegroundColor DarkGray
& $script:CfExe --version

if ($Login) {
    Write-Step 'Cloudflare login (browser will open)'
    & $script:CfExe tunnel login
    Write-Host 'Login done. Re-run with -ClientKey <name> to create tunnel and routes.' -ForegroundColor Green
    exit 0
}

$cert = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
if (-not (Test-Path -LiteralPath $cert)) {
    Write-Host ""
    Write-Host 'Cloudflare login required first. Run ONE command:' -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$appRoot\setup-windal-tunnel.ps1`" -Login" -ForegroundColor White
    exit 1
}

$ClientKey = $ClientKey.Trim().ToLower()
if ($ClientKey -notmatch '^[a-z0-9][a-z0-9-]{1,62}$') {
    throw "Invalid ClientKey '$ClientKey'. Use lowercase letters, numbers, hyphens (e.g. dal-srfipulses)."
}

$appHost = "$ClientKey.$BaseDomain"
$apiHost = "$ClientKey-api.$BaseDomain"

if ($RoutesOnly) {
    Write-Step "DNS routes only for tunnel: $ClientKey"
    $uuid = Get-TunnelUuidFromList -Name $ClientKey
    Add-TunnelDnsRoute -TunnelRef $uuid -Hostname $appHost
    Add-TunnelDnsRoute -TunnelRef $uuid -Hostname $apiHost
    Write-ConfigYml -Uuid $uuid -AppHost $appHost -ApiHost $apiHost -WebPort $DevPort -ApiPortLocal $ApiPort
    Ensure-CredentialsJson -Uuid $uuid | Out-Null
    Write-Step 'Routes updated'
    Write-Host "  https://$appHost" -ForegroundColor Green
    Write-Host "  https://$apiHost" -ForegroundColor Green
    exit 0
}

if ($FullClientSetup) {
    Write-Step 'Full client setup (npm, Oracle config, scheduled task)'
    $setupArgs = @{
        ClientKey               = $ClientKey
        OraclePrimaryUser       = $OraclePrimaryUser
        OraclePrimaryPassword   = $OraclePrimaryPassword
        OracleSecondaryUser     = $OracleSecondaryUser
        OracleSecondaryPassword = $OracleSecondaryPassword
        OracleConnectString     = $OracleConnectString
    }
    & (Join-Path $appRoot 'setup-client.ps1') @setupArgs
}

Write-Step "Tunnel: $ClientKey"
$uuidRegex = [regex]'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
$createOut = Invoke-CfAllowAlready -Args @('tunnel', 'create', $ClientKey)
$m = $uuidRegex.Match($createOut)
if ($m.Success) {
    $uuid = $m.Value.ToLower()
    Write-Host "Created tunnel UUID: $uuid" -ForegroundColor Green
}
else {
    $uuid = Get-TunnelUuidFromList -Name $ClientKey
    Write-Host "Using existing tunnel UUID: $uuid" -ForegroundColor DarkYellow
}

Write-Step 'DNS routes (CNAME in fasaccountingsoftware.in)'
Add-TunnelDnsRoute -TunnelRef $uuid -Hostname $appHost
Add-TunnelDnsRoute -TunnelRef $uuid -Hostname $apiHost

Ensure-CredentialsJson -Uuid $uuid | Out-Null
Write-ConfigYml -Uuid $uuid -AppHost $appHost -ApiHost $apiHost -WebPort $DevPort -ApiPortLocal $ApiPort

Write-Step 'Done'
Write-Host ""
Write-Host 'Public URLs:' -ForegroundColor Yellow
Write-Host "  https://$appHost" -ForegroundColor Green
Write-Host "  https://$apiHost" -ForegroundColor Green
Write-Host ""
Write-Host 'Start services (3 terminals or run start-windal-stack.cmd):' -ForegroundColor Yellow
Write-Host '  1) npm.cmd run server'
Write-Host "  2) npm.cmd run dev -- --host 0.0.0.0 --port $DevPort"
Write-Host "  3) .\start-windal-tunnel.cmd"
Write-Host ""
Write-Host 'Cloudflare dashboard should show Healthy + 2 apps after step 3 is running.' -ForegroundColor DarkGray
