[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ClientKey = "dal-modern",

    [Parameter(Mandatory = $false)]
    [string]$OraclePrimaryUser = "DAL",

    [Parameter(Mandatory = $false)]
    [string]$OraclePrimaryPassword = "DAL",

    [Parameter(Mandatory = $false)]
    [string]$OracleConnectString = "XE",

    [Parameter(Mandatory = $false)]
    [string]$OracleSecondaryUser = "DAL",

    [Parameter(Mandatory = $false)]
    [string]$OracleSecondaryPassword = "DAL",

    [Parameter(Mandatory = $false)]
    [bool]$DualHubEnabled = $false,

    [Parameter(Mandatory = $false)]
    [bool]$DualHubRequired = $false,

    [Parameter(Mandatory = $false)]
    [string]$AutoStartMode = "task",

    [Parameter(Mandatory = $false)]
    [switch]$SkipBuild,

    # Skip winget/offline install when Node + cloudflared are already on the PC.
    [Parameter(Mandatory = $false)]
    [switch]$SkipPrerequisiteInstall,

    [Parameter(Mandatory = $false)]
    [bool]$AutoInstallNode = $true,

    [Parameter(Mandatory = $false)]
    [bool]$AutoInstallCloudflared = $true,

    [Parameter(Mandatory = $false)]
    [string]$OfflinePackageRoot = ""
)

$ErrorActionPreference = "Stop"

if ($SkipPrerequisiteInstall) {
    $AutoInstallNode = $false
    $AutoInstallCloudflared = $false
}

function Get-OfflinePackageSearchRoots {
    param([string]$ExplicitRoot, [string]$AppRoot)
    $roots = @()
    if (-not [string]::IsNullOrWhiteSpace($ExplicitRoot)) {
        $roots += $ExplicitRoot.Trim()
    }
    $roots += @(
        (Join-Path $AppRoot "offline-installers"),
        (Join-Path $AppRoot "installers"),
        (Join-Path (Split-Path $AppRoot -Parent) "offline-installers"),
        "e:\mobile application software",
        "d:\mobile application software"
    )
    $seen = @{}
    $unique = @()
    foreach ($r in $roots) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $norm = $r.Trim().TrimEnd('\')
        $key = $norm.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            $unique += $norm
        }
    }
    return $unique
}

function Write-Step([string]$message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Ensure-Command([string]$commandName) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$commandName' is not available. Install it first."
    }
}

function Test-WingetAvailable {
    return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Ensure-Winget {
    if (-not (Test-WingetAvailable)) {
        throw @"
winget is not available on this PC and Node.js / cloudflared were not found locally.

Do ONE of the following, then run setup again:

  A) Install prerequisites manually (no winget):
     - Node.js LTS: https://nodejs.org/  (need v18+)
     - cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
     Then run:
       powershell -ExecutionPolicy Bypass -File .\setup-client.ps1 -AutoInstallNode `$false -AutoInstallCloudflared `$false

  B) Copy offline installers into:
       .\offline-installers\
     (node-v*-x64.msi and cloudflared-windows-amd64.msi) and run setup again.

  C) Install App Installer from Microsoft Store (enables winget), then retry setup.

Searched offline folders:
$($script:OfflineSearchRootsDisplay)
"@
    }
}

function Refresh-CommonPathEntries {
    $candidatePaths = @(
        "$env:ProgramFiles\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs",
        "$env:ProgramFiles\Cloudflared",
        "${env:ProgramFiles(x86)}\Cloudflared",
        "${env:ProgramFiles(x86)}\cloudflared",
        "$env:ProgramFiles\cloudflared",
        "$env:LOCALAPPDATA\Programs\Cloudflared",
        "$env:ProgramFiles\Cloudflare\Cloudflare WARP"
    )
    foreach ($p in $candidatePaths) {
        if ((Test-Path $p) -and -not ($env:Path -split ";" | Where-Object { $_ -eq $p })) {
            $env:Path = "$env:Path;$p"
        }
    }
}

function Resolve-CommandPathFromKnownLocations {
    param([Parameter(Mandatory = $true)][string]$CommandName)

    $exeName = "$CommandName.exe"
    $candidateExePaths = @()

    switch ($CommandName.ToLowerInvariant()) {
        "cloudflared" {
            $candidateExePaths = @(
                (Join-Path $env:ProgramFiles "Cloudflared\cloudflared.exe"),
                (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
                (Join-Path ${env:ProgramFiles(x86)} "Cloudflared\cloudflared.exe"),
                (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\Cloudflared\cloudflared.exe")
            )
        }
        "node" {
            $candidateExePaths = @(
                (Join-Path $env:ProgramFiles "nodejs\node.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
            )
        }
        "npm" {
            $candidateExePaths = @(
                (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
                (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd")
            )
        }
        default {
            return $null
        }
    }

    foreach ($exePath in $candidateExePaths) {
        if (Test-Path $exePath) {
            $dir = Split-Path -Parent $exePath
            if ($env:Path -notlike "*$dir*") {
                $env:Path = "$env:Path;$dir"
            }
            return $exePath
        }
    }

    return $null
}

function Get-NodeMajorVersion {
    try {
        $nodeVersionRaw = (& node --version) 2>$null
        if (-not $nodeVersionRaw) {
            return $null
        }
        $majorText = (($nodeVersionRaw -replace "^v", "").Split(".") | Select-Object -First 1)
        return [int]$majorText
    } catch {
        return $null
    }
}

function Test-NodeVersionSupported {
    param([int]$MinimumMajor = 18)
    $major = Get-NodeMajorVersion
    if (-not $major) {
        return $false
    }
    return $major -ge $MinimumMajor
}

function Get-LatestInstallerFile {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string[]]$Patterns
    )
    if (-not (Test-Path $RootPath)) {
        return $null
    }
    $matches = foreach ($pattern in $Patterns) {
        Get-ChildItem -Path $RootPath -Filter $pattern -File -ErrorAction SilentlyContinue
    }
    return ($matches | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

function Install-NodeFromLocal {
    param([string]$RootPath)

    $installer = Get-LatestInstallerFile -RootPath $RootPath -Patterns @(
        "node-v*-x64.msi",
        "node-v*-x64.exe",
        "node-v*-win-x64.zip",
        "node-v*-x64.zip"
    )
    if (-not $installer) {
        return $false
    }

    Write-Step "Installing Node.js from local package: $($installer.Name)"

    if ($installer.Extension -ieq ".msi") {
        $msiArgs = "/i `"$($installer.FullName)`" /qn /norestart"
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "Node.js MSI install failed with exit code $($proc.ExitCode)."
        }
        return $true
    }

    if ($installer.Extension -ieq ".exe") {
        $exeProc = Start-Process -FilePath $installer.FullName -ArgumentList "/quiet" -Wait -PassThru
        if ($exeProc.ExitCode -ne 0) {
            throw "Node.js EXE install failed with exit code $($exeProc.ExitCode)."
        }
        return $true
    }

    $destination = Join-Path $env:LOCALAPPDATA "Programs\nodejs"
    if (-not (Test-Path $destination)) {
        New-Item -Path $destination -ItemType Directory -Force | Out-Null
    }
    Expand-Archive -Path $installer.FullName -DestinationPath $destination -Force
    return $true
}

function Install-CloudflaredFromLocal {
    param([string]$RootPath)

    $installer = Get-LatestInstallerFile -RootPath $RootPath -Patterns @(
        "cloudflared-windows-amd64.msi",
        "cloudflared-windows-amd64.exe",
        "cloudflared-windows-amd64",
        "cloudflared*.msi",
        "cloudflared*.exe"
    )
    if (-not $installer) {
        return $false
    }

    Write-Step "Installing Cloudflared from local package: $($installer.Name)"

    if ($installer.Extension -ieq ".msi") {
        $msiArgs = "/i `"$($installer.FullName)`" /qn /norestart"
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "Cloudflared MSI install failed with exit code $($proc.ExitCode)."
        }
        return $true
    }

    $targetDirCandidates = @(
        (Join-Path $env:ProgramFiles "Cloudflared"),
        (Join-Path $env:LOCALAPPDATA "Programs\Cloudflared")
    )
    $lastError = $null

    foreach ($dir in $targetDirCandidates) {
        try {
            if (-not (Test-Path $dir)) {
                New-Item -Path $dir -ItemType Directory -Force | Out-Null
            }
            $targetPath = Join-Path $dir "cloudflared.exe"
            Copy-Item -Path $installer.FullName -Destination $targetPath -Force
            return $true
        } catch {
            $lastError = $_
        }
    }

    if ($lastError) {
        throw "Failed to place cloudflared.exe from local package. $($lastError.Exception.Message)"
    }
    return $false
}

function Try-InstallFromLocalPackage {
    param(
        [Parameter(Mandatory = $true)][string]$CommandName,
        [Parameter(Mandatory = $true)][string[]]$OfflineRootPaths
    )
    foreach ($root in $OfflineRootPaths) {
        if (-not (Test-Path $root)) { continue }
        $installed = $false
        switch ($CommandName.ToLowerInvariant()) {
            "node" { $installed = Install-NodeFromLocal -RootPath $root }
            "npm" { $installed = Install-NodeFromLocal -RootPath $root }
            "cloudflared" { $installed = Install-CloudflaredFromLocal -RootPath $root }
            default { $installed = $false }
        }
        if ($installed) {
            Write-Host "  Used offline package from: $root" -ForegroundColor DarkGray
            return $true
        }
    }
    return $false
}

function Install-WithWinget {
    param(
        [Parameter(Mandatory = $true)][string]$PackageId,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )
    Write-Step "Installing $DisplayName via winget"
    & winget install --id $PackageId --exact --source winget --silent --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "winget install failed for $DisplayName ($PackageId)."
    }
}

function Ensure-CommandOrInstall {
    param(
        [Parameter(Mandatory = $true)][string]$CommandName,
        [Parameter(Mandatory = $true)][string]$PackageId,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][bool]$CanInstall,
        [Parameter(Mandatory = $true)][string[]]$OfflineRootPaths
    )
    $commandExists = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($commandExists) {
        if (($CommandName -ieq "node" -or $CommandName -ieq "npm") -and -not (Test-NodeVersionSupported -MinimumMajor 18)) {
            $detectedMajor = Get-NodeMajorVersion
            Write-Step "Detected old Node.js version '$detectedMajor'. Upgrading Node.js from offline package."
        } else {
            return
        }
    }
    if (-not $CanInstall) {
        throw "Required command '$CommandName' is missing and auto-install is disabled."
    }

    $installedFromLocal = Try-InstallFromLocalPackage -CommandName $CommandName -OfflineRootPaths $OfflineRootPaths
    if (-not $installedFromLocal) {
        if (Test-WingetAvailable) {
            Install-WithWinget -PackageId $PackageId -DisplayName $DisplayName
        } else {
            Ensure-Winget
        }
    }

    Refresh-CommonPathEntries
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        $resolvedPath = Resolve-CommandPathFromKnownLocations -CommandName $CommandName
        if ($resolvedPath) {
            if (($CommandName -ieq "node" -or $CommandName -ieq "npm") -and -not (Test-NodeVersionSupported -MinimumMajor 18)) {
                throw "Node.js was found but version is too old. Install Node.js 18+ from '$OfflineRootPath' and run setup again."
            }
            return
        }
        $rootsHint = ($OfflineRootPaths | Where-Object { Test-Path $_ } | Select-Object -First 3) -join "; "
        throw "$DisplayName installation did not expose '$CommandName' in PATH. Put installers in .\offline-installers\ or open a new terminal and run setup again. Checked: $rootsHint"
    }

    if (($CommandName -ieq "node" -or $CommandName -ieq "npm") -and -not (Test-NodeVersionSupported -MinimumMajor 18)) {
        throw "Node.js version is too old after installation. Ensure Node.js 18+ installer exists in .\offline-installers\ and run setup again."
    }
}

function Get-ClientKey {
    param([string]$InitialValue)
    $value = $InitialValue
    while ([string]::IsNullOrWhiteSpace($value)) {
        $value = Read-Host "Enter client key (example: dal-rgind)"
    }
    $value = $value.Trim().ToLowerInvariant()
    if ($value -notmatch "^[a-z0-9-]+$") {
        throw "Client key '$value' is invalid. Use lowercase letters, numbers, and hyphen only."
    }
    return $value
}

function Ensure-PropertyObject {
    param(
        [Parameter(Mandatory = $true)][psobject]$Parent,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )
    $existing = $Parent.PSObject.Properties[$PropertyName]
    if (-not $existing) {
        $Parent | Add-Member -MemberType NoteProperty -Name $PropertyName -Value ([pscustomobject]@{})
        return
    }
    if ($existing.Value -isnot [psobject]) {
        $Parent.$PropertyName = [pscustomobject]@{}
    }
}

function Set-ConfigProperty {
    param(
        [Parameter(Mandatory = $true)][psobject]$Target,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Value
    )
    if ($Target.PSObject.Properties[$Name]) {
        $Target.$Name = $Value
    } else {
        $Target | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Save-RunBackendCmd {
    param([string]$AppRootPath)

    $runCmdPath = Join-Path $AppRootPath "run-backend.cmd"
    $logsPath = Join-Path $AppRootPath "logs"

    if (-not (Test-Path $logsPath)) {
        New-Item -Path $logsPath -ItemType Directory | Out-Null
    }

    $cmdContent = @"
@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
echo [%date% %time%] Starting API server...>> logs\server.log
npm.cmd run server >> logs\server.log 2>&1
"@

    Set-Content -Path $runCmdPath -Value $cmdContent -Encoding Ascii
    return $runCmdPath
}

function Register-AutoStartTask {
    param(
        [string]$TaskName,
        [string]$RunCmdPath
    )
    $taskRun = "cmd.exe /c `"$RunCmdPath`""
    & schtasks /Create /TN $TaskName /TR $taskRun /SC ONSTART /RL HIGHEST /RU SYSTEM /F | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create startup task '$TaskName'. Run PowerShell as Administrator."
    }
}

function Register-NssmService {
    param(
        [string]$ServiceName,
        [string]$AppRootPath
    )
    $candidates = @(
        (Join-Path $AppRootPath "nssm.exe"),
        (Join-Path $AppRootPath "tools\nssm\nssm.exe")
    )
    $nssmPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $nssmPath) {
        throw "NSSM not found. Put nssm.exe in app root or use -AutoStartMode task."
    }

    & $nssmPath install $ServiceName "cmd.exe" "/c npm.cmd run server" | Out-Host
    & $nssmPath set $ServiceName AppDirectory $AppRootPath | Out-Host
    & $nssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Host
    & $nssmPath start $ServiceName | Out-Host
}

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $appRoot

$offlineSearchRoots = Get-OfflinePackageSearchRoots -ExplicitRoot $OfflinePackageRoot -AppRoot $appRoot
$script:OfflineSearchRootsDisplay = ($offlineSearchRoots | ForEach-Object {
    if (Test-Path $_) { "  [found] $_" } else { "  [missing] $_" }
}) -join [Environment]::NewLine

Write-Step "Checking prerequisites"
Write-Host "Offline installer search paths:" -ForegroundColor DarkGray
Write-Host $script:OfflineSearchRootsDisplay -ForegroundColor DarkGray

Ensure-CommandOrInstall -CommandName "node" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS" -CanInstall $AutoInstallNode -OfflineRootPaths $offlineSearchRoots
Ensure-CommandOrInstall -CommandName "npm" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS (npm)" -CanInstall $AutoInstallNode -OfflineRootPaths $offlineSearchRoots
Ensure-CommandOrInstall -CommandName "cloudflared" -PackageId "Cloudflare.cloudflared" -DisplayName "Cloudflare Tunnel" -CanInstall $AutoInstallCloudflared -OfflineRootPaths $offlineSearchRoots

$client = Get-ClientKey -InitialValue $ClientKey
$configPath = Join-Path $appRoot "connection.config.json"

if (-not (Test-Path $configPath)) {
    throw "connection.config.json not found at $configPath"
}

Write-Step "Updating connection.config.json for client '$client'"
$config = Get-Content -Path $configPath -Raw | ConvertFrom-Json

Ensure-PropertyObject -Parent $config -PropertyName "domain"
if (-not $config.domain.rootDomain) { Set-ConfigProperty -Target $config.domain -Name "rootDomain" -Value "fasaccountingsoftware.in" }
if (-not $config.domain.apiSubdomainSuffix) { Set-ConfigProperty -Target $config.domain -Name "apiSubdomainSuffix" -Value "-api" }

$rootDomain = $config.domain.rootDomain
$apiSuffix = $config.domain.apiSubdomainSuffix
$webOrigin = "https://$client.$rootDomain"
$apiBase = "https://$client$apiSuffix.$rootDomain"

Set-ConfigProperty -Target $config -Name "clientName" -Value $client
Set-ConfigProperty -Target $config -Name "defaultClientKey" -Value $client
if ($config.PSObject.Properties["clients"]) {
    $config.PSObject.Properties.Remove("clients")
}

Ensure-PropertyObject -Parent $config -PropertyName "oracle"
Set-ConfigProperty -Target $config.oracle -Name "primary" -Value ([pscustomobject]@{
    user = $OraclePrimaryUser
    password = $OraclePrimaryPassword
    connectString = $OracleConnectString
})
Set-ConfigProperty -Target $config.oracle -Name "secondaryOracle" -Value ([pscustomobject]@{
    user = $OracleSecondaryUser
    password = $OracleSecondaryPassword
    connectString = $OracleConnectString
})
Set-ConfigProperty -Target $config.oracle -Name "dualHubEnabled" -Value $DualHubEnabled
Set-ConfigProperty -Target $config.oracle -Name "dualHubRequired" -Value $DualHubRequired
foreach ($legacy in @('grain', 'grainHubEnabled', 'requireGrainHub')) {
    if ($config.oracle.PSObject.Properties[$legacy]) {
        $config.oracle.PSObject.Properties.Remove($legacy)
    }
}

$config | ConvertTo-Json -Depth 50 | Set-Content -Path $configPath -Encoding UTF8

Write-Step "Installing npm packages"
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
}

if (-not $SkipBuild) {
    Write-Step "Building frontend assets"
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed."
    }
}

$autoStart = $AutoStartMode.Trim().ToLowerInvariant()
if ($autoStart -ne "none") {
    Write-Step "Configuring auto start ($autoStart)"
    $runCmdPath = Save-RunBackendCmd -AppRootPath $appRoot
    $serviceName = "FAS-$client-API"

    if ($autoStart -eq "task") {
        Register-AutoStartTask -TaskName $serviceName -RunCmdPath $runCmdPath
    } elseif ($autoStart -eq "nssm") {
        Register-NssmService -ServiceName $serviceName -AppRootPath $appRoot
    } else {
        throw "Unknown AutoStartMode '$AutoStartMode'. Use task, nssm, or none."
    }
}

Write-Step "Setup complete"
try {
    $nodeVersion = (& node --version) 2>$null
    if ($nodeVersion) { Write-Host "Node version    : $nodeVersion" -ForegroundColor Green }
} catch {}
try {
    $cfVersionRaw = (& cloudflared --version) 2>$null
    if ($cfVersionRaw) {
        $cfVersion = ($cfVersionRaw | Select-Object -First 1)
        Write-Host "Cloudflared     : $cfVersion" -ForegroundColor Green
    }
} catch {}
Write-Host "Client key      : $client" -ForegroundColor Green
Write-Host "Web origin      : $webOrigin" -ForegroundColor Green
Write-Host "API base        : $apiBase" -ForegroundColor Green
Write-Host "Oracle connect  : $OracleConnectString" -ForegroundColor Green
Write-Host "Auto start mode : $autoStart" -ForegroundColor Green
Write-Host ""
Write-Host "Run API manually (CMD always finds Node):" -ForegroundColor Yellow
Write-Host "  .\run-backend.cmd" -ForegroundColor Yellow
Write-Host "Or in PowerShell after Node install, refresh PATH then:" -ForegroundColor Yellow
Write-Host '  $env:Path += ";$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\nodejs"' -ForegroundColor Gray
Write-Host "  npm.cmd run server   (use .cmd in PowerShell if execution policy blocks npm.ps1)" -ForegroundColor Gray
Write-Host "If npm is still unknown: close ALL PowerShell windows once, or sign out of Windows, then try again." -ForegroundColor DarkYellow
