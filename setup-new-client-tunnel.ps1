param(
    [Parameter(Mandatory = $true)]
    [string]$ClientKey,

    [string]$OraclePrimaryUser = "DAL",
    [string]$OraclePrimaryPassword = "DAL",
    [string]$OracleSecondaryUser = "DAL",
    [string]$OracleSecondaryPassword = "DAL",
    [string]$OracleConnectString = "XE",
    [string]$OfflinePackageRoot = "",
    [string]$BaseDomain = "fasaccountingsoftware.in",
    [int]$DevPort = 5174,
    [switch]$SkipClientSetup
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-CloudflaredExePath {
    # Prefer real installs — PATH often hits C:\Windows\System32\cloudflared.exe (invalid stub → "not a valid Win32 application").
    $candidateExePaths = @(
        (Join-Path $env:ProgramFiles "Cloudflared\cloudflared.exe"),
        (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Cloudflared\cloudflared.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Cloudflared\cloudflared.exe")
    )
    foreach ($exePath in $candidateExePaths) {
        if (Test-Path -LiteralPath $exePath) {
            return (Resolve-Path -LiteralPath $exePath).Path
        }
    }
    $winDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows).TrimEnd("\")
    $blocked = @(
        $(Join-Path $winDir "System32"),
        $(Join-Path $winDir "SysWOW64")
    ) | ForEach-Object { $_.TrimEnd("\") }

    $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $src = $cmd.Source
        $parent = (Split-Path -Parent $src).TrimEnd("\")
        foreach ($b in $blocked) {
            if ($parent -ieq $b) {
                $src = $null
                break
            }
        }
        if ($src -and (Test-Path -LiteralPath $src)) {
            return (Resolve-Path -LiteralPath $src).Path
        }
    }
    throw @"
cloudflared.exe not found under Program Files / Local AppData.

Install Cloudflare Tunnel (winget install Cloudflare.cloudflared).
If PATH points to Windows\System32\cloudflared.exe, rename or delete that stub so the installed binary is used, then run this script again.
"@
}

function Invoke-Cloudflared {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $script:CfExe -ArgumentList $Arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $stdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $stderr = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
        $output = (($stdout, $stderr) -join [Environment]::NewLine).Trim()
        if ($p.ExitCode -ne 0) {
            throw "cloudflared failed (`"$script:CfExe`" $($Arguments -join ' ')):`n$output"
        }
        return $output
    }
    finally {
        Remove-Item -Path $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
    }
}

function Ensure-TunnelDnsRoute {
    param(
        [Parameter(Mandatory = $true)][string]$TunnelIdOrName,
        [Parameter(Mandatory = $true)][string]$Hostname
    )
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $script:CfExe -ArgumentList @("tunnel", "route", "dns", "-f", $TunnelIdOrName, $Hostname) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $stdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $stderr = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
        $output = (($stdout, $stderr) -join [Environment]::NewLine).Trim()
        if ($p.ExitCode -eq 0) {
            return $output
        }
        # cloudflared sometimes exits non-zero even when the route now exists.
        if (
            $output -match "Added CNAME" -or
            $output -match "already exists" -or
            $output -match "already configured to route" -or
            $output -match "code:\s*1003"
        ) {
            Write-Host "Route already present/accepted: $Hostname" -ForegroundColor DarkYellow
            return $output
        }
        throw "cloudflared route failed ($Hostname):`n$output"
    }
    finally {
        Remove-Item -Path $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
    }
}

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $appRoot

if ([string]::IsNullOrWhiteSpace($OfflinePackageRoot)) {
    $OfflinePackageRoot = Join-Path (Split-Path -Parent $appRoot) "mobile application software"
}

Write-Step "Using app root: $appRoot"
Write-Step "Client key: $ClientKey"
Write-Step "Offline package root: $OfflinePackageRoot"

if (-not $SkipClientSetup) {
    Write-Step "Running setup-client.ps1"
    .\setup-client.ps1 `
        -ClientKey $ClientKey `
        -OraclePrimaryUser $OraclePrimaryUser `
        -OraclePrimaryPassword $OraclePrimaryPassword `
        -OracleSecondaryUser $OracleSecondaryUser `
        -OracleSecondaryPassword $OracleSecondaryPassword `
        -OracleConnectString $OracleConnectString `
        -OfflinePackageRoot $OfflinePackageRoot
}

$script:CfExe = Resolve-CloudflaredExePath
Write-Host "Using cloudflared: $script:CfExe" -ForegroundColor DarkGray

Write-Step "Creating tunnel (or validating existing tunnel)"
$createOutput = ""
try {
    $createOutput = Invoke-Cloudflared -Arguments @("tunnel", "create", $ClientKey)
}
catch {
    $createOutput = $_.Exception.Message
    if ($createOutput -match "already exists") {
        Write-Host "Tunnel '$ClientKey' already exists. Reusing existing tunnel." -ForegroundColor DarkYellow
    }
    else {
        throw
    }
}

$uuidRegex = [regex]'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
$uuidMatch = $uuidRegex.Match($createOutput)

if ($uuidMatch.Success) {
    $tunnelUuid = $uuidMatch.Value.ToLower()
}
else {
    $listOutput = Invoke-Cloudflared -Arguments @("tunnel", "list")
    $line = ($listOutput -split "`r?`n" | Where-Object { $_ -match "\s$ClientKey\s" } | Select-Object -First 1)
    if (-not $line) {
        throw "Could not determine tunnel UUID for '$ClientKey'. Run: `"$script:CfExe`" tunnel list"
    }
    $lineUuid = $uuidRegex.Match($line)
    if (-not $lineUuid.Success) {
        throw "Could not parse tunnel UUID from line: $line"
    }
    $tunnelUuid = $lineUuid.Value.ToLower()
}

Write-Step "Tunnel UUID: $tunnelUuid"

$credPath = "C:\Users\$env:USERNAME\.cloudflared\$tunnelUuid.json"
if (-not (Test-Path $credPath)) {
    Write-Step "Credentials JSON not found; fetching token to create it"
    Invoke-Cloudflared -Arguments @("tunnel", "token", "--cred-file", $credPath, $tunnelUuid) | Out-Null
}

if (-not (Test-Path $credPath)) {
    throw "Credentials file missing after token fetch: $credPath"
}

# Copy token next to config.yml so client PCs do not depend on C:\Users\...\.cloudflared paths.
$appCredPath = Join-Path $appRoot "$tunnelUuid.json"
Copy-Item -LiteralPath $credPath -Destination $appCredPath -Force
Write-Step "Copied tunnel credentials to: $appCredPath"

$clientSubdomain = "$ClientKey".ToLower()
$appHost = "$clientSubdomain.$BaseDomain"
$apiHost = "$clientSubdomain-api.$BaseDomain"

Write-Step "Mapping DNS hostnames"
Write-Host "Creating route: $appHost" -ForegroundColor Yellow
Ensure-TunnelDnsRoute -TunnelIdOrName $tunnelUuid -Hostname $appHost | Out-Null
Write-Host "Creating route: $apiHost" -ForegroundColor Yellow
Ensure-TunnelDnsRoute -TunnelIdOrName $tunnelUuid -Hostname $apiHost | Out-Null

Write-Step "Updating config.yml"
$configPath = Join-Path $appRoot "config.yml"
$configContent = @"
tunnel: $tunnelUuid
credentials-file: ./$tunnelUuid.json

ingress:
  - hostname: $appHost
    service: http://localhost:$DevPort
  - hostname: $apiHost
    service: http://localhost:5001
  - service: http_status:404
"@
$configContent | Set-Content -Path $configPath -Encoding UTF8

Write-Step "Done"
Write-Host "config.yml updated: $configPath" -ForegroundColor Green
Write-Host "credentials file (also under APPTEST): $appCredPath" -ForegroundColor Green
Write-Host "cloudflared copy: $credPath" -ForegroundColor DarkGray
Write-Host "App route: https://$appHost" -ForegroundColor Green
Write-Host "API route: https://$apiHost" -ForegroundColor Green
Write-Host ""
Write-Host "DNS verification (CNAME should point to $tunnelUuid.cfargotunnel.com):" -ForegroundColor Yellow
try {
    $appDns = Resolve-DnsName -Type CNAME $appHost -ErrorAction Stop | Select-Object -First 1
    Write-Host " - $appHost -> $($appDns.NameHost)" -ForegroundColor Green
}
catch {
    Write-Host " - $appHost -> not visible yet (DNS propagation may take a minute)." -ForegroundColor DarkYellow
}
try {
    $apiDns = Resolve-DnsName -Type CNAME $apiHost -ErrorAction Stop | Select-Object -First 1
    Write-Host " - $apiHost -> $($apiDns.NameHost)" -ForegroundColor Green
}
catch {
    Write-Host " - $apiHost -> not visible yet (DNS propagation may take a minute)." -ForegroundColor DarkYellow
}
Write-Host ""
Write-Host "Start runtime in separate terminals:" -ForegroundColor Yellow
Write-Host "1) npm.cmd run server"
Write-Host "2) npm.cmd run dev -- --host 0.0.0.0 --port $DevPort"
Write-Host ("3) `"{0}`" tunnel --config `"{1}`" run" -f $script:CfExe, $configPath)

