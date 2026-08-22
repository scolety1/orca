<#
.SYNOPSIS
  One-shot, best-effort nudge that activates the TSF plugin's worker process
  in the currently-running Orca instance (M14 real-machine finding).

.DESCRIPTION
  Real, confirmed root cause: Orca's own plugin system starts a dev plugin's
  worker process lazily -- only the first time one of its registered commands
  is invoked, or one of its subscribed events is delivered (confirmed by
  reading src/main/plugins/plugin-service.ts, plugin-worker-controller.ts, and
  plugin-event-delivery.ts, read-only, no core changes). TSF's manifest only
  subscribes to worktree.created/worktree.removed/agent.status.changed, none
  of which fire automatically at a bare Orca cold start -- so without some
  external nudge, TSF's backend only comes alive whenever Tim happens to do
  something (elsewhere in Orca) that incidentally triggers one of those
  events, which measured 4m23s once and 24+ minutes another time on the real
  machine: not a bug, just genuinely unbounded from the plugin's own side.

  This script closes that gap using Orca's own real, already-shipped runtime
  RPC surface -- the exact same local named-pipe protocol and
  plugins.invokeCommand method every `orca` CLI command already uses
  internally (see src/cli/runtime/transport.ts, src/cli/runtime/metadata.ts,
  src/main/runtime/rpc/methods/plugins.ts, all read-only) -- to invoke TSF's
  own already-registered, read-only `tsf-status` command. Invoking any
  registered command activates the worker exactly the same way a real command
  invocation from Orca's command palette would; this script only automates
  that, using Orca's own supported inter-process contract, rather than
  reimplementing any part of Orca's plugin runtime.

  Deliberately a separate process (invoked via Start-Process, never inline on
  the launcher's UI thread): named-pipe I/O has no reliable timeout API in
  classic Windows PowerShell, so isolating it here means a slow or hung
  attempt can never freeze the dedicated TSF window, only this disposable
  helper process, which itself still enforces an overall deadline below.

  Also owns the "launch Orca if it isn't running" decision (M14 live-use
  finding, post-GA): Launch-TSF.ps1 used to call `orca open --json` itself on
  every retry/recovery tick, unconditionally. Reading src/cli/runtime/
  client.ts's openOrca() (read-only, no core changes) shows it calls
  launchOrcaApp() -- which re-spawns the Orca executable -- *before* checking
  whether a desktop window is already available, not after; Electron's own
  single-instance handling in the already-running Orca then answers that
  second launch by focusing Orca's existing window (src/main/index.ts's
  requestDesktopActivation -> focusExistingWindow -> app.focus({steal:true}),
  plus moveTop()/an always-on-top pulse/a 100ms focus retry on win32).
  Confirmed live: a single manual `orca open --json` call while Orca was
  already running with a visible window visibly stole OS foreground focus to
  Orca within ~1-2 seconds, with zero effect on TSF's own window -- matching
  Tim's live-use report exactly (TSF never minimized; Orca kept surfacing in
  front of it). `orca open` is only ever actually needed to start Orca in the
  first place, so that decision now lives here, gated on Orca's own runtime
  metadata pointing at a still-live process, rather than firing blindly on
  every tick from the launcher's UI thread.
#>

$ErrorActionPreference = 'Stop'

$TsfPluginKey = 'thousand-sunny-fleet.foundation'
$TsfCommandId = 'tsf-status'
$ConnectTimeoutMs = 1500
$OverallDeadline = (Get-Date).AddSeconds(8)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $env:LOCALAPPDATA 'ThousandSunnyFleet'

function Write-NudgeLog {
    param([string]$Message)
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
    $line = "$(Get-Date -Format o) [activation-nudge] $Message"
    Add-Content -Path (Join-Path $DataDir 'launcher.log') -Value $line -ErrorAction SilentlyContinue
}

# Bounded async read: PipeStream throws "Timeouts are not supported on this
# stream" for the classic Read/ReadTimeout API, so the read side is bounded
# via Task.Wait(ms) on ReadAsync instead -- the one API that genuinely
# supports a deadline here.
function Read-LineBounded {
    param(
        [System.IO.Pipes.NamedPipeClientStream]$Pipe,
        [System.Text.StringBuilder]$Buffer,
        [datetime]$Deadline
    )
    while ($true) {
        $newlineIndex = $Buffer.ToString().IndexOf("`n")
        if ($newlineIndex -ge 0) {
            $line = $Buffer.ToString().Substring(0, $newlineIndex)
            $Buffer.Remove(0, $newlineIndex + 1) | Out-Null
            return $line
        }
        $remainingMs = [int](($Deadline - (Get-Date)).TotalMilliseconds)
        if ($remainingMs -le 0) {
            return $null
        }
        $chunk = New-Object byte[] 4096
        $readTask = $Pipe.ReadAsync($chunk, 0, $chunk.Length)
        if (-not $readTask.Wait([Math]::Min($remainingMs, 2000))) {
            return $null
        }
        $bytesRead = $readTask.Result
        if ($bytesRead -le 0) {
            return $null
        }
        $Buffer.Append([System.Text.Encoding]::UTF8.GetString($chunk, 0, $bytesRead)) | Out-Null
    }
}

try {
    $metaPath = Join-Path $env:APPDATA 'orca\orca-runtime.json'

    # Is Orca genuinely running right now? Metadata presence alone isn't
    # enough -- a crashed/killed Orca can leave a stale file behind pointing
    # at a dead pid -- so confirm the pid is actually alive before treating
    # `orca open` as unnecessary.
    $orcaConfirmedRunning = $false
    if (Test-Path $metaPath) {
        try {
            $probeMeta = Get-Content $metaPath -Raw | ConvertFrom-Json
            if ($probeMeta.pid -and (Get-Process -Id $probeMeta.pid -ErrorAction SilentlyContinue)) {
                $orcaConfirmedRunning = $true
            }
        } catch {
            # Malformed/unreadable metadata -- fall through and treat as "not confirmed running".
        }
    }

    if (-not $orcaConfirmedRunning) {
        $orcaCmd = Get-Command orca -ErrorAction SilentlyContinue
        if ($orcaCmd) {
            try {
                Start-Process -FilePath $orcaCmd.Source -ArgumentList @('open', '--json') -WindowStyle Hidden
                Write-NudgeLog 'Orca not confirmed running -- launched it.'
            } catch {
                Write-NudgeLog "Failed to launch Orca: $_"
            }
        } else {
            Write-NudgeLog "'orca' command not found -- cannot launch Orca."
        }
    }

    if (-not (Test-Path $metaPath)) {
        Write-NudgeLog 'No orca-runtime.json yet -- Orca is not up far enough to nudge.'
        exit 0
    }
    $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
    if (-not $meta.authToken) {
        Write-NudgeLog 'Runtime metadata has no authToken -- skipping.'
        exit 0
    }
    $pipeTransport = $meta.transports | Where-Object { $_.kind -eq 'named-pipe' } | Select-Object -First 1
    if (-not $pipeTransport) {
        Write-NudgeLog 'No named-pipe transport in runtime metadata -- skipping.'
        exit 0
    }
    $pipeName = $pipeTransport.endpoint -replace '^\\\\\.\\pipe\\', ''

    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(
        '.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous
    )
    try {
        $pipe.Connect($ConnectTimeoutMs)
    } catch {
        Write-NudgeLog "Could not connect to Orca's runtime pipe yet: $_"
        exit 0
    }

    $requestId = [Guid]::NewGuid().ToString()
    $envelope = @{
        id = $requestId
        authToken = $meta.authToken
        method = 'plugins.invokeCommand'
        params = @{ pluginKey = $TsfPluginKey; commandId = $TsfCommandId }
    }
    $json = (ConvertTo-Json $envelope -Compress -Depth 6) + "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $pipe.Write($bytes, 0, $bytes.Length)
    $pipe.Flush()

    $buffer = New-Object System.Text.StringBuilder
    $response = $null
    while ((Get-Date) -lt $OverallDeadline) {
        $line = Read-LineBounded -Pipe $pipe -Buffer $buffer -Deadline $OverallDeadline
        if ($null -eq $line) { break }
        if ($line.Trim().Length -eq 0) { continue }
        try {
            $frame = $line | ConvertFrom-Json
        } catch {
            continue
        }
        if ($frame.PSObject.Properties.Name -contains '_keepalive') { continue }
        if ($frame.id -eq $requestId) {
            $response = $frame
            break
        }
    }

    if ($null -eq $response) {
        Write-NudgeLog 'No response before the overall deadline -- Orca may still be starting up.'
    } elseif ($response.ok) {
        Write-NudgeLog "tsf-status invoked successfully -- TSF's worker should now be active."
    } else {
        $errText = if ($response.error) { $response.error | ConvertTo-Json -Compress } else { '(no error detail)' }
        Write-NudgeLog "plugins.invokeCommand returned an error (expected while the plugin is still being discovered): $errText"
    }
} catch {
    Write-NudgeLog "Unexpected error: $_"
} finally {
    if ($pipe) { $pipe.Dispose() }
}
