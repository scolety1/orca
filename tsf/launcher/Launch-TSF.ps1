<#
.SYNOPSIS
  Thousand Sunny Fleet desktop launcher (M14).

.DESCRIPTION
  Ensures Orca itself is running (`orca open` -- idempotent, safe on every launch),
  waits for the TSF backend (spawned by Orca's own TSF plugin, once registered) to
  become reachable on its fixed port, then hosts the real TSF UI in a genuine
  dedicated Windows window -- its own title/icon/taskbar entry, no browser chrome
  or branding. If the backend never comes up (most likely: the plugin isn't
  registered in Orca yet), the same window shows the guided first-run setup page
  instead of a blank page or a crash; that page's own polling transitions the
  window in place once the backend comes up, with no relaunch needed.

  Runs on Windows PowerShell (built into every Windows install) rather than Node --
  Node is only ever spawned by Orca's own bundled runtime for tsf/server itself, and
  this script must not assume Tim has a separate Node install on PATH.

  M14 defect 2 fix: an earlier version of this launcher shelled out to
  `msedge.exe --app=`, which Tim rejected as "a browser wrapper, not a dedicated
  Windows application". A follow-up attempt to replace it with a compiled,
  self-contained .NET/WebView2 host .exe was blocked outright by Windows Smart App
  Control on the real target machine (confirmed via Microsoft-Windows-
  CodeIntegrity/Operational event 3077/3118 -- an unsigned new executable image is
  rejected before it ever runs, and this cannot be worked around without code
  signing, which is out of scope for this local V1). This version instead hosts a
  WebView2 control *directly inside this already-trusted, Microsoft-signed
  powershell.exe process* -- no second executable image is ever loaded, so Smart
  App Control has nothing new to evaluate, while still producing a real, separate,
  independently-titled/iconed top-level window with its own taskbar entry.
#>

$ErrorActionPreference = 'Stop'

$TsfPort = 4610
$TsfUrl = "http://127.0.0.1:$TsfPort"
$ReadyTimeoutSeconds = 30
$PollIntervalSeconds = 1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FirstRunSetupPath = Join-Path $ScriptDir 'first-run-setup.html'
$IconPath = Join-Path $ScriptDir 'tsf.ico'
$WebView2Dir = Join-Path $ScriptDir 'webview2'
$DataDir = Join-Path $env:LOCALAPPDATA 'ThousandSunnyFleet'
$WebViewProfileDir = Join-Path $DataDir 'webview2-profile'
$MutexName = 'Global\ThousandSunnyFleet.SingleInstance'
$WindowTitle = 'Thousand Sunny Fleet'

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

function Test-TsfReachable {
    param([int]$TimeoutSec = 3)
    try {
        $res = Invoke-WebRequest -Uri "$TsfUrl/api/meta" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $res.StatusCode -eq 200
    } catch {
        return $false
    }
}

# --- Single-instance handling ---------------------------------------------
# Relaunching while a window is already open should activate it, not spawn a
# second one. A named Mutex is the standard reliable signal for this; window
# activation itself uses plain Win32 calls (FindWindow/SetForegroundWindow) so
# it works whether or not this exact script instance created that window.
Add-Type -Namespace TsfNative -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
'@

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)
if (-not $createdNew) {
    Write-Log 'Already running -- activating the existing window instead of opening a second one.'
    $hwnd = [TsfNative.Win32]::FindWindow($null, $WindowTitle)
    if ($hwnd -ne [IntPtr]::Zero) {
        if ([TsfNative.Win32]::IsIconic($hwnd)) { [TsfNative.Win32]::ShowWindow($hwnd, 9) | Out-Null } # SW_RESTORE
        [TsfNative.Win32]::SetForegroundWindow($hwnd) | Out-Null
    }
    exit 0
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
    # Cap each attempt's own timeout to whatever's left so a slow/hanging
    # request near the deadline can't push the total wait past the
    # documented ReadyTimeoutSeconds bound.
    $remaining = [Math]::Max(1, [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
    $attemptTimeout = [Math]::Min(3, $remaining)
    if (Test-TsfReachable -TimeoutSec $attemptTimeout) { $ready = $true; break }
    if ((Get-Date).AddSeconds($PollIntervalSeconds) -ge $deadline) { break }
    Start-Sleep -Seconds $PollIntervalSeconds
}

if ($ready) {
    Write-Log 'TSF backend reachable -- opening the dedicated window on the real UI.'
    $initialUrl = $TsfUrl
} else {
    Write-Log 'TSF backend not reachable after timeout -- opening the dedicated window on the first-run guide.'
    # [System.Uri]'s own file-path constructor percent-encodes spaces, '#',
    # '?', and other URL-significant characters a real checkout path could
    # contain, which a naive slash-flip would instead let corrupt the URL.
    $initialUrl = ([System.Uri]$FirstRunSetupPath).AbsoluteUri
}

# --- Host the dedicated window ---------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $WebView2Dir 'Microsoft.Web.WebView2.WinForms.dll')

# WebView2Loader.dll is a native DLL resolved via the process's own working
# directory / DLL search path -- copy it into the profile dir (already
# writable, already per-user) and make that the process's current directory
# so the loader is found regardless of where this script itself lives.
if (-not (Test-Path $WebViewProfileDir)) { New-Item -ItemType Directory -Path $WebViewProfileDir -Force | Out-Null }
Copy-Item (Join-Path $WebView2Dir 'WebView2Loader.dll') (Join-Path $WebViewProfileDir 'WebView2Loader.dll') -Force
[Environment]::CurrentDirectory = $WebViewProfileDir

$form = New-Object System.Windows.Forms.Form
$form.Text = $WindowTitle
$form.Width = 1280
$form.Height = 860
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = New-Object System.Drawing.Size(720, 480)
if (Test-Path $IconPath) {
    $form.Icon = New-Object System.Drawing.Icon($IconPath)
}

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$webView.Dock = 'Fill'
$creationProps = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$creationProps.UserDataFolder = $WebViewProfileDir
$webView.CreationProperties = $creationProps
$form.Controls.Add($webView)

$webView.add_CoreWebView2InitializationCompleted({
    param($s, $e)
    if (-not $e.IsSuccess) {
        Write-Log "WebView2 initialization failed: $($e.InitializationException)"
    }
})
# The window's own Text is deliberately left fixed as "Thousand Sunny Fleet"
# (WinForms does not auto-sync it to the hosted page's <title> the way a
# browser tab would) -- both because that is the identity Tim asked for, and
# because the single-instance FindWindow check above depends on this exact
# title never changing, on the first-run guide or the real UI alike.
$webView.add_NavigationCompleted({
    param($s, $e)
    Write-Log "Navigation completed: success=$($e.IsSuccess) status=$($e.WebErrorStatus)"
})

$form.Add_Shown({
    $webView.Source = [Uri]$initialUrl
})

[System.Windows.Forms.Application]::Run($form)
Write-Log 'Window closed -- launcher exiting.'
$mutex.ReleaseMutex()
