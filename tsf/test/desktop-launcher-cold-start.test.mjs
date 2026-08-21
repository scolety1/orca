import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// M14 real cold-start regression: Tim's own hands-on test reproduced "Orca
// launched, Thousand Sunny Fleet itself never opened" -- root-caused to a
// real launcher instance (PID confirmed still alive, no window, no WinForms/
// WebView2 modules loaded) stuck for 10+ minutes, almost certainly inside the
// pre-window-creation `orca open`/reachability-poll code that an earlier
// version of Launch-TSF.ps1 ran *before* ever creating a window -- a slow
// cold boot plus a single unbounded/hanging call anywhere in that stretch
// meant nothing ever appeared, silently (a hidden-window PowerShell process
// has no console to surface an error on).
//
// There is no Windows GUI test harness in this repo's CI to actually drive
// WinForms/WebView2, so this is a structural regression guard on the real,
// shipped source rather than a behavioral one: it encodes the exact
// invariant whose violation caused the bug (window creation must never be
// gated behind a blocking readiness check) so a future edit that
// reintroduces that shape fails loudly here instead of silently on a real
// machine. The behavior itself -- immediate window, indefinite polling,
// real auto-transition once a backend comes up -- was independently
// reproduced and verified live (screenshotted, log-timestamped) as part of
// this fix; see docs/tsf/M14_DESKTOP_LAUNCH_REMEDIATION_V1.md.

const TSF_ROOT = path.join(import.meta.dirname, '..')
const launcherSource = readFileSync(path.join(TSF_ROOT, 'launcher', 'Launch-TSF.ps1'), 'utf8')
const guideSource = readFileSync(path.join(TSF_ROOT, 'launcher', 'first-run-setup.html'), 'utf8')
const nudgeSource = readFileSync(
  path.join(TSF_ROOT, 'launcher', 'Invoke-TsfActivationNudge.ps1'),
  'utf8'
)

test('Launch-TSF.ps1 never gates window creation behind a blocking network/process call', () => {
  // The exact shape that caused the bug: a synchronous `orca open` /
  // Invoke-WebRequest readiness loop running *before* the Form is created.
  // Neither must appear anywhere in this script -- readiness is the hosted
  // page's job now (see the next test).
  assert.ok(
    !/Invoke-WebRequest/.test(launcherSource),
    'Launch-TSF.ps1 must not poll reachability itself (PowerShell/.NET ' +
      'Invoke-WebRequest -TimeoutSec is not reliable against a non-listening ' +
      'loopback port and can hang far longer than its stated timeout) -- ' +
      "the hosted page does this instead, using the browser engine's own " +
      'networking stack.'
  )
  assert.ok(
    !/&\s*orca\s+open/.test(launcherSource),
    'orca open must be invoked as a non-blocking, fire-and-forget call ' +
      '(Start-Process), never as a direct synchronous invocation that could ' +
      'block the whole script on a slow/cold Orca startup before any window ' +
      'exists.'
  )
  assert.match(
    launcherSource,
    /Start-Process\s+-FilePath\s+\$orcaCmd\.Source\s+-ArgumentList\s+@\(\s*'open'/,
    'orca open must be launched via Start-Process (non-blocking).'
  )
})

test('Launch-TSF.ps1 creates and shows the window before any readiness-dependent work', () => {
  const formCreationIndex = launcherSource.indexOf('New-Object System.Windows.Forms.Form')
  const applicationRunIndex = launcherSource.indexOf(
    '[System.Windows.Forms.Application]::Run($form)'
  )
  assert.ok(formCreationIndex > 0, 'expected to find the Form construction')
  assert.ok(
    applicationRunIndex > formCreationIndex,
    'expected Application.Run to follow Form construction'
  )

  // Between creating the Form and running it, the only "wait" allowed is
  // handing navigation off to the hosted page -- there must be no bounded
  // sleep/poll loop in between (that was the previous, buggy shape).
  const betweenCreationAndRun = launcherSource.slice(formCreationIndex, applicationRunIndex)
  assert.ok(
    !/Start-Sleep/.test(betweenCreationAndRun),
    'no blocking sleep/poll may sit between creating the window and running it'
  )
})

test('Launch-TSF.ps1 surfaces failures visibly rather than dying silently', () => {
  assert.match(
    launcherSource,
    /catch\s*\{\s*\n\s*Show-HonestError/,
    'the top-level try/catch around window setup must show a visible error, ' +
      'not just log one -- a -WindowStyle Hidden process has no console for ' +
      'Tim to ever see a silent failure on'
  )
  assert.match(
    launcherSource,
    /Application\]::add_ThreadException/,
    'an unhandled exception dispatched during the WinForms message loop ' +
      '(e.g. a WebView2 callback) must also be routed to a visible error, ' +
      'not just exceptions during initial setup'
  )
})

test('first-run-setup.html polls indefinitely and never gives up on its own', () => {
  assert.match(
    guideSource,
    /setInterval\(checkReady,\s*POLL_INTERVAL_MS\)/,
    'the readiness poll must be a plain, ever-repeating setInterval'
  )
  // The one thing allowed to stop the interval is success itself
  // (navigating away unloads the page). There must be no retry-count/give-up
  // path that could stop polling while still on this page.
  assert.ok(
    !/clearInterval/.test(guideSource),
    'nothing should ever clearInterval() the readiness poll while still on ' +
      'this page -- indefinite retry is the whole point'
  )
})

test('first-run-setup.html shows something immediately and only escalates copy over time, never blanks out', () => {
  assert.match(
    guideSource,
    /id="starting-phase"/,
    'an immediately-visible starting state must exist'
  )
  assert.match(
    guideSource,
    /REVEAL_SETUP_AFTER_MS/,
    'setup steps must be time-gated, not shown as an immediate assumption of failure'
  )
  assert.match(
    guideSource,
    /STALLED_HINT_AFTER_MS/,
    'a long-stalled wait must eventually say so plainly rather than spinning forever unacknowledged'
  )
})

// M14 real live-state regression: Tim's own machine showed the plugin
// genuinely registered, enabled, and Orca running -- yet the backend still
// took several minutes to activate, confirmed via real process-creation
// timestamps (Orca's own subprocesses started within seconds; the TSF
// plugin-host-entry.js process didn't appear until 4m23s later, with no
// error anywhere -- there is no supported lever, CLI or otherwise, for this
// launcher to make Orca's own plugin reconciliation faster). The bug this
// guards against: showing "you haven't registered this" language during a
// wait that is completely normal for an already-correctly-configured
// machine, which actively misleads someone who (correctly) already
// completed setup and is now just waiting on Orca itself.
function readNumericConst(name) {
  const match = guideSource.match(new RegExp(`const ${name} = (\\d+)`))
  assert.ok(match, `expected to find a numeric const ${name}`)
  return Number(match[1])
}

test('first-run-setup.html tolerates a multi-minute activation delay before ever suggesting registration is the cause', () => {
  const reassureAfterMs = readNumericConst('REASSURE_AFTER_MS')
  const revealSetupAfterMs = readNumericConst('REVEAL_SETUP_AFTER_MS')
  const stalledHintAfterMs = readNumericConst('STALLED_HINT_AFTER_MS')

  // The real, observed activation delay was ~4m23s with nothing wrong.
  // Suggesting a registration problem meaningfully before that window has
  // fully elapsed would reproduce exactly the misleading message Tim's
  // real machine surfaced.
  const OBSERVED_REAL_ACTIVATION_DELAY_MS = 4 * 60 * 1000 + 23 * 1000
  assert.ok(
    revealSetupAfterMs >= OBSERVED_REAL_ACTIVATION_DELAY_MS,
    `REVEAL_SETUP_AFTER_MS (${revealSetupAfterMs}ms) must be at least as long as the ` +
      `real observed activation delay (${OBSERVED_REAL_ACTIVATION_DELAY_MS}ms) -- ` +
      'otherwise a correctly-configured machine gets told to double-check settings ' +
      'that were never the problem'
  )
  assert.ok(
    reassureAfterMs < revealSetupAfterMs && revealSetupAfterMs < stalledHintAfterMs,
    'the three escalation thresholds must be strictly increasing'
  )
})

test("first-run-setup.html's setup-phase copy double-checks rather than diagnoses", () => {
  // Must not claim the machine definitely hasn't registered the plugin --
  // it may well have, and just still be waiting on Orca's own activation.
  // Matches both the current phrasing and the actual old buggy wording
  // ("Orca hasn't been told where to find Thousand Sunny Fleet yet"), so a
  // revert to that old copy genuinely fails this assertion rather than
  // silently passing it.
  assert.ok(
    !/hasn'?t (?:been told|registered)/i.test(guideSource),
    'setup-phase copy must not assert the plugin is unregistered as a fact -- a ' +
      'correctly-registered machine can still be mid-activation for several minutes'
  )
  assert.match(
    guideSource,
    /double-check/i,
    'setup-phase copy should invite double-checking, not declare a diagnosis'
  )
})

// M14 real live-state regression: Tim's own machine showed Orca Plugin
// system ON, Thousand Sunny Fleet Foundation Dev * Enabled, the correct
// C:\TSF_ORCA\tsf path, Orca itself fully running -- yet Test-NetConnection
// against port 4610 genuinely failed twice, confirmed via the real,
// currently-running Orca process tree: every one of Orca's own subprocesses
// started within seconds of its main process, but the plugin-host-entry.js
// process for TSF did not exist at all yet. Reading Orca's own plugin
// activation source (plugin-service.ts's performRefresh/reconcile,
// plugin-worker-controller.ts's reconcile, plugin-event-delivery.ts)
// confirmed the real mechanism: Orca starts a dev plugin's worker lazily,
// only on the first invokeCommand or subscribed-event delivery -- neither of
// which happens automatically at a bare cold start. The fix: this launcher
// invokes TSF's own already-registered tsf-status command itself, via
// Orca's real runtime RPC (the same named-pipe protocol and
// plugins.invokeCommand method every `orca` CLI command already uses).
test('Launch-TSF.ps1 fires the activation nudge on every background retry tick, not just orca open', () => {
  const tickHandlerStart = launcherSource.indexOf('$invokeOrcaOpen = {')
  const tickHandlerEnd = launcherSource.indexOf(
    '$orcaRetryTimer.Add_Tick($invokeOrcaOpen)',
    tickHandlerStart
  )
  assert.ok(
    tickHandlerStart > 0 && tickHandlerEnd > tickHandlerStart,
    'expected to find the retry-tick handler body'
  )
  const tickHandlerBody = launcherSource.slice(tickHandlerStart, tickHandlerEnd)
  assert.match(
    tickHandlerBody,
    /\$nudgeScriptPath/,
    'the same tick handler that retries `orca open` must also retry the activation nudge -- ' +
      'Orca being open is not sufficient on its own, per the real evidence above'
  )
  assert.match(
    launcherSource,
    /\$nudgeScriptPath\s*=.*Invoke-TsfActivationNudge\.ps1/,
    '$nudgeScriptPath must actually resolve to Invoke-TsfActivationNudge.ps1'
  )
  assert.match(
    tickHandlerBody,
    /-WindowStyle\s+Hidden/,
    'the nudge must be launched non-blocking (Start-Process), never inline, since named-pipe ' +
      'I/O has no reliable timeout API in classic PowerShell and could otherwise freeze the window'
  )
})

test('Invoke-TsfActivationNudge.ps1 targets the real plugin key/command and never throws unhandled', () => {
  assert.match(
    nudgeSource,
    /\$TsfPluginKey\s*=\s*'thousand-sunny-fleet\.foundation'/,
    'must target the real, qualified TSF plugin key'
  )
  assert.match(
    nudgeSource,
    /\$TsfCommandId\s*=\s*'tsf-status'/,
    'must invoke a real, already-registered, read-only TSF command'
  )
  assert.match(
    nudgeSource,
    /method\s*=\s*'plugins\.invokeCommand'/,
    "must call Orca's real plugins.invokeCommand RPC method"
  )
  // The whole script must be wrapped so a missing runtime, an unreachable
  // pipe, or any other failure degrades to a logged no-op -- this runs
  // unattended on every retry tick and must never surface an error dialog
  // for what is explicitly a best-effort nudge, not a required step.
  const tryIndex = nudgeSource.indexOf('try {')
  const catchIndex = nudgeSource.lastIndexOf('} catch {')
  assert.ok(
    tryIndex !== -1 && catchIndex > tryIndex,
    'expected a top-level try/catch wrapping the whole attempt'
  )
})

test('Invoke-TsfActivationNudge.ps1 bounds its own runtime instead of relying on PipeStream timeouts', () => {
  // PipeStream.ReadTimeout genuinely throws "Timeouts are not supported on
  // this stream" for a NamedPipeClientStream opened this way (confirmed
  // empirically) -- the read side must be bounded via Task.Wait(ms) on
  // ReadAsync instead, not by trying to set ReadTimeout.
  assert.ok(
    !/\.ReadTimeout\s*=/.test(nudgeSource),
    'must not rely on PipeStream.ReadTimeout -- it is not supported on a NamedPipeClientStream here'
  )
  assert.match(
    nudgeSource,
    /ReadAsync/,
    'reads must go through the async API so they can be bounded with Task.Wait(ms)'
  )
  assert.match(
    nudgeSource,
    /\$OverallDeadline/,
    'the whole attempt must have an overall wall-clock deadline, not just a per-call timeout'
  )
})
