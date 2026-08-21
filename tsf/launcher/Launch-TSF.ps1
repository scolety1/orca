<#
.SYNOPSIS
  Thousand Sunny Fleet desktop launcher (M14).

.DESCRIPTION
  Ensures Orca itself is running (`orca open`, retried in the background a
  bounded number of times -- idempotent and safe on every launch), then hosts
  the real TSF UI in a genuine dedicated Windows window -- its own title/icon
  /taskbar entry, no browser chrome or branding. If the backend isn't reachable
  yet (cold Orca boot, plugin not yet registered, or anything else), the same
  window shows a branded "Starting..." state immediately, then the guided
  first-run setup page if the wait crosses a real-cold-boot-shaped threshold --
  never a blank page, a frozen window, or a silent failure.

  Runs on Windows PowerShell (built into every Windows install) rather than
  Node -- Node is only ever spawned by Orca's own bundled runtime for
  tsf/server itself, and this script must not assume Tim has a separate Node
  install on PATH.

  M14 remediation history (see docs/tsf/M14_DESKTOP_LAUNCH_REMEDIATION_V1.md
  for the full evidence trail of each):
  - v1 shelled out to `msedge.exe --app=`, which Tim rejected as a browser
    wrapper, not a dedicated app.
  - v2 replaced that with a compiled, self-contained .NET/WebView2 host .exe,
    which Windows Smart App Control hard-blocked outright on the real target
    machine (unsigned executable, no user override in enforcement mode).
  - v3 (this version, still) hosts a WebView2 control *directly inside this
    already-trusted, Microsoft-signed powershell.exe process* -- no second
    executable image is ever loaded, so Smart App Control has nothing new to
    evaluate.
  - v4 (this version's actual changes) fixes a real cold-start failure Tim's
    own hands-on test reproduced: earlier versions ran `orca open` and a
    bounded readiness poll *before* ever creating a window, so a slow cold
    boot (a real possibility this script must tolerate, not assume away)
    meant Tim saw nothing at all for up to 30+ seconds -- and any unhandled
    exception anywhere in that pre-window-creation code path would silently
    kill the whole (hidden-window) process with zero visible trace, which is
    the most likely explanation for "Orca opened, TSF never did": something
    threw before a window ever appeared, and -WindowStyle Hidden means that
    error was never seen. Fixed by (a) creating and showing the window
    *immediately*, before any network/process readiness work at all -- the
    hosted page itself now owns all of the waiting/retry/reveal logic and
    never gives up on its own -- and (b) wrapping the entire launch sequence
    in a top-level handler that surfaces any real failure via a visible
    MessageBox rather than dying silently.
#>

$ErrorActionPreference = 'Stop'

# TSF's fixed backend port (4610) is no longer referenced directly here --
# first-run-setup.html owns the reachability check against it and the
# eventual navigation once ready. See that file if the port ever changes.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FirstRunSetupPath = Join-Path $ScriptDir 'first-run-setup.html'
$IconPath = Join-Path $ScriptDir 'tsf.ico'
$WebView2Dir = Join-Path $ScriptDir 'webview2'
$DataDir = Join-Path $env:LOCALAPPDATA 'ThousandSunnyFleet'
$WebViewProfileDir = Join-Path $DataDir 'webview2-profile'
$MutexName = 'Global\ThousandSunnyFleet.SingleInstance'
$WindowTitle = 'Thousand Sunny Fleet'
# Retried, not just fired once: if Orca's own launch is slow or hiccups,
# repeating this bounded number of times gives it real chances to recover
# rather than the launcher assuming one attempt was enough. `orca open` is
# documented idempotent/safe to call repeatedly. Bounded to comfortably
# outlast the real, observed plugin-activation delay (~4m23s on Tim's own
# machine, Orca itself already fully up within seconds -- see
# first-run-setup.html's own thresholds for the fuller evidence/rationale)
# in case a repeated call ever turns out to help nudge a stalled Orca
# instance specifically, even though ordinary plugin reconciliation timing
# is Orca's own internal behavior this launcher has no supported lever over.
$OrcaOpenRetryCount = 24
$OrcaOpenRetryIntervalMs = 15000

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

# Everything below -- including the single-instance Win32/Mutex setup and the
# orca-CLI check -- is wrapped in one top-level handler. An earlier version of
# this fix left the Win32 P/Invoke compilation and Mutex construction outside
# the try/catch on the theory that they're simple/safe; an independent review
# correctly pointed out that's exactly the same silent-death shape this whole
# rewrite exists to eliminate (a cold `Add-Type` compile or a restricted
# Mutex-creation environment could still throw before any window exists, with
# nothing to catch it). Now nothing between here and Application.Run can fail
# silently.
try {
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

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    # Must run before any Form/Control is created on this thread -- WinForms
    # throws if called any later, which is why this sits here rather than
    # right before Application.Run below.
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
    [System.Windows.Forms.Application]::add_ThreadException({
        param($s, $e)
        Write-Log "Unhandled UI-thread exception: $($e.Exception.ToString())"
        Show-HonestError "Thousand Sunny Fleet hit an unexpected error: $($e.Exception.Message)"
    })

    # Fire-and-forget, retried: ensures Orca is launching/running without
    # ever blocking window creation on it. Idempotent per its own contract,
    # so repeating this while Orca is already up is a harmless no-op.
    $orcaRetryTimer = New-Object System.Windows.Forms.Timer
    $orcaRetryTimer.Interval = $OrcaOpenRetryIntervalMs
    $script:orcaOpenAttempts = 0
    $invokeOrcaOpen = {
        $script:orcaOpenAttempts++
        try {
            Start-Process -FilePath $orcaCmd.Source -ArgumentList @('open', '--json') -WindowStyle Hidden
        } catch {
            Write-Log "orca open attempt $($script:orcaOpenAttempts) failed to start: $_"
        }
        if ($script:orcaOpenAttempts -ge $OrcaOpenRetryCount) {
            $orcaRetryTimer.Stop()
        }
    }
    $orcaRetryTimer.Add_Tick($invokeOrcaOpen)
    & $invokeOrcaOpen
    $orcaRetryTimer.Start()

    # --- Host the dedicated window, immediately -----------------------------
    Add-Type -Path (Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll')
    Add-Type -Path (Join-Path $WebView2Dir 'Microsoft.Web.WebView2.WinForms.dll')

    # WebView2Loader.dll is a native DLL resolved via the process's own
    # working directory / DLL search path -- copy it into the profile dir
    # (already writable, already per-user) and make that the process's
    # current directory so the loader is found regardless of where this
    # script itself lives.
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
            Show-HonestError "Thousand Sunny Fleet couldn't start its display component: $($e.InitializationException.Message)"
        }
    })
    $webView.add_NavigationCompleted({
        param($s, $e)
        Write-Log "Navigation completed: success=$($e.IsSuccess) status=$($e.WebErrorStatus) url=$($webView.Source)"
    })

    # The page itself (first-run-setup.html) owns all subsequent
    # waiting/retry/reveal logic and auto-navigates to the real UI the
    # moment the backend answers -- see that file for the "Starting..." ->
    # (optionally) setup-guide -> real UI state machine. This is always the
    # first thing shown, whether or not the backend turns out to be reachable
    # in a second or in two minutes.
    $form.Add_Shown({
        $fileUrl = ([System.Uri]$FirstRunSetupPath).AbsoluteUri
        $webView.Source = [Uri]$fileUrl
    })

    [System.Windows.Forms.Application]::Run($form)
    $orcaRetryTimer.Stop()
    Write-Log 'Window closed -- launcher exiting.'
} catch {
    Show-HonestError "Thousand Sunny Fleet hit an unexpected error and couldn't start: $($_.Exception.Message)"
} finally {
    try { $mutex.ReleaseMutex() } catch { }
}
