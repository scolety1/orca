<#
.SYNOPSIS
  Thousand Sunny Fleet desktop launcher (M14).

.DESCRIPTION
  Ensures Orca itself is running (`orca open` -- idempotent, safe on every launch),
  waits for the TSF backend (spawned by Orca's own TSF plugin, once registered) to
  become reachable on its fixed port, then opens a dedicated app-mode window on the
  real TSF UI. If the backend never comes up (most likely: the plugin isn't
  registered in Orca yet), opens the guided first-run setup page instead of a blank
  page or a crash.

  Runs on Windows PowerShell (built into every Windows install) rather than Node --
  Node is only ever spawned by Orca's own bundled runtime for tsf/server itself, and
  this script must not assume Tim has a separate Node install on PATH.
#>

$ErrorActionPreference = 'Stop'

$TsfPort = 4610
$TsfUrl = "http://127.0.0.1:$TsfPort"
$ReadyTimeoutSeconds = 30
$PollIntervalSeconds = 1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FirstRunSetupPath = Join-Path $ScriptDir 'first-run-setup.html'
$DataDir = Join-Path $env:LOCALAPPDATA 'ThousandSunnyFleet'
$EdgeProfileDir = Join-Path $DataDir 'edge-app-profile'

function Write-Log {
    param([string]$Message)
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -Path (Join-Path $DataDir 'launcher.log') -Value $line -ErrorAction SilentlyContinue
}

function Show-HonestError {
    param([string]$Message)
    Write-Log "ERROR: $Message"
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, 'Thousand Sunny Fleet', 'OK', 'Error') | Out-Null
}

function Find-Edge {
    $cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    try {
        $regPath = (Get-ItemProperty 'HKLM:\SOFTWARE\Clients\StartMenuInternet\Microsoft Edge\shell\open\command' -ErrorAction Stop).'(default)'
        $exe = ($regPath -replace '^"([^"]+)".*$', '$1')
        if (Test-Path $exe) { return $exe }
    } catch {
        # No registry entry -- fall through to fixed-path probing below.
    }
    foreach ($candidate in @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

function Open-DedicatedWindow {
    param([string]$Url)
    $edge = Find-Edge
    if (-not (Test-Path $EdgeProfileDir)) { New-Item -ItemType Directory -Path $EdgeProfileDir -Force | Out-Null }
    if ($edge) {
        Start-Process -FilePath $edge -ArgumentList @(
            "--app=$Url",
            "--user-data-dir=$EdgeProfileDir",
            '--no-first-run'
        )
    } else {
        # No Edge found (unexpected on Windows 11) -- degrade to the default
        # browser rather than failing the launch outright.
        Write-Log 'msedge.exe not found -- falling back to the default browser (no dedicated app window).'
        Start-Process $Url
    }
}

function Test-TsfReachable {
    try {
        $res = Invoke-WebRequest -Uri "$TsfUrl/api/meta" -UseBasicParsing -TimeoutSec 3
        return $res.StatusCode -eq 200
    } catch {
        return $false
    }
}

Write-Log 'Launch requested.'

$orcaCmd = Get-Command orca -ErrorAction SilentlyContinue
if (-not $orcaCmd) {
    Show-HonestError "Thousand Sunny Fleet needs Orca installed first. The 'orca' command was not found on this machine. Install Orca, then launch Thousand Sunny Fleet again."
    exit 1
}

try {
    & orca open --json | Out-Null
} catch {
    # `orca open` failing is surfaced via the reachability timeout below, not a
    # hard exit here -- Orca may still be reachable via a stale/slow response.
    Write-Log "orca open reported an error: $_"
}

$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if (Test-TsfReachable) { $ready = $true; break }
    Start-Sleep -Seconds $PollIntervalSeconds
}

if ($ready) {
    Write-Log 'TSF backend reachable -- opening the dedicated window.'
    Open-DedicatedWindow -Url $TsfUrl
} else {
    Write-Log 'TSF backend not reachable after timeout -- opening the guided first-run setup page.'
    $fileUrl = 'file:///' + ($FirstRunSetupPath -replace '\\', '/')
    Open-DedicatedWindow -Url $fileUrl
}
