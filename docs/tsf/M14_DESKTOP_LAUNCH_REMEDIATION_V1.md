# M14 — TSF Desktop Launch + V1 Release-Candidate Remediation

## Third hands-on-test remediation: the real plugin-activation delay (read first)

Tim's third hands-on test was a genuine partial pass: cold launch, immediate window,
and Orca auto-starting all confirmed working. But with the plugin visibly registered
*and* Enabled in Orca's own Settings, the window stayed on "Still starting…"
indefinitely, with Tim deliberately changing nothing (no uninstall/toggle/refresh) so
the live state could be diagnosed as-is.

**Diagnosed from the live machine, not guessed at.** `netstat`/`Get-NetTCPConnection`
showed port 4610 genuinely `LISTENING`, with an `ESTABLISHED` connection from Tim's
own real launcher window -- so the backend *was* reachable, and (confirmed by direct
`curl -H "Origin: null"`) still correctly sending the CORS header from the M14
wave-3 fix. The real question was why activation took so long in the first place.
Cross-referencing real process-creation timestamps answered it: Orca's main process
and every one of its own subprocesses (GPU, network service, renderer, crashpad
handler, parcel watcher, session scanner) all started within 5 seconds of each
other -- but the one process that actually runs the TSF plugin
(`plugin-host-entry.js`) didn't appear until **4 minutes 23 seconds** later, with no
error anywhere in Orca's own logs. Reading Orca's own plugin-service source
(`src/main/plugins/plugin-service.ts`, read-only, confirms no core changes are
needed) confirmed there is no bug to point at here and no supported lever this
launcher (or Tim) has to make that reconciliation faster -- `orca` has no
plugin-management CLI surface at all, confirmed both by `orca --help` and by
`orca status --json`'s capability list. This is Orca's own internal activation
timing, observed once at ~4.5 minutes, and Orca core stays untouched per this whole
program's constraint.

**What was actually wrong, and the fix.** Given a multi-minute wait can be entirely
normal, the real defect was the *page's own messaging*: `first-run-setup.html`
declared "Orca hasn't been told where to find Thousand Sunny Fleet yet" as fact only
20 seconds in -- actively misleading on a machine that, like Tim's, is already
correctly configured and simply still activating. Fixed by re-timing and re-wording
the escalation entirely around the real observed delay: a plain "Starting…" for the
first 90 seconds, an honest "this can take a few minutes, nothing to do yet" from
90s, the registration steps revealed only past 5 minutes and framed as something to
*double-check* rather than a diagnosis, and a "this is genuinely unusual" note only
past 10 minutes. The backend readiness poll itself was already correct (indefinite,
CORS-fixed, auto-transitioning) -- confirmed unchanged and still working via the same
live specimen. `Launch-TSF.ps1`'s background `orca open` retry window was also
extended (6 attempts/90s -> 24 attempts/6 minutes) as cheap insurance in case a
repeated call ever does help an unusually slow Orca instance specifically, though the
observed delay here was in Orca's plugin reconciliation, not its own startup.
Added regression coverage asserting the escalation thresholds are provably longer
than the real observed delay, and that the setup-phase copy never asserts
non-registration as fact.

---

## Second hands-on-test remediation: the real cold-start failure

Tim's second hands-on test ("I clicked the shortcut. Orca launched successfully.
Thousand Sunny Fleet itself never opened.") reproduced a real, confirmed defect in
the wave-3 launcher, caught with direct live evidence rather than guessed at:

**Live specimen found and inspected.** A `powershell.exe` process from Tim's own
test (`Launch-TSF.ps1`, matching his shortcut's exact command line) was still alive
**10+ minutes** after his test, holding the single-instance Mutex, with **no window
title and no `WebView2`/`System.Windows.Forms` modules loaded at all** -- proving it
never reached the point of creating any window, guide or otherwise, and had been
stuck since very early in the script.

**Root cause.** The wave-3 script ran, in order, *before ever creating a window*:
(1) a synchronous `& orca open --json` call, then (2) a bounded, up-to-30-second
`Invoke-WebRequest`-based reachability poll. Two independent problems compound
here: `orca open`'s own real duration on a genuine cold boot is unbounded from the
script's point of view (nothing caps how long it can take), and separately,
`Invoke-WebRequest -TimeoutSec` on Windows PowerShell 5.1 does not reliably bound
the *connection* phase against a non-listening loopback port -- a known class of
issue where the underlying connect attempt can hang well past the stated timeout.
Either one stalling silently explains the specimen exactly: stuck before any
window, for many minutes, with `-WindowStyle Hidden` meaning nothing was ever
visible to Tim and no console existed to show an error even if one had been
thrown.

**Fix (structural, not a timeout tweak).** Window creation no longer waits on
*anything*: `Launch-TSF.ps1` now creates and shows the dedicated window
immediately (measured: ~1 second from double-click), before touching Orca or the
network at all. `orca open` is now fired via `Start-Process` (non-blocking,
fire-and-forget, retried up to 6 times 15s apart in the background -- real
recover/retry, not one attempt) instead of a synchronous call. All reachability
waiting moved entirely into `first-run-setup.html`'s own `fetch()`-based polling,
which runs on the browser engine's networking stack (not subject to the same
PowerShell/.NET quirk) and **never gives up on its own** -- it shows a neutral
"Starting Thousand Sunny Fleet…" state immediately, reveals the guided
registration steps only if the wait crosses a real-cold-boot-shaped threshold
(20s), and says so plainly if it's been stalled a long time (75s), all while
continuing to poll indefinitely. A top-level error handler (plus a WinForms
`ThreadException` handler for anything thrown later, during the message loop
itself) now shows a real, visible `MessageBox` for any genuine failure --
eliminating the entire class of silent death `-WindowStyle Hidden` otherwise
allows.

**Verified for real, not just reasoned about:** killed and inspected the actual
stuck specimen from Tim's test (confirmed the diagnosis above); measured the new
window appearing in ~0.7-1.1s against the live backend; reproduced the full
"Starting…" → (reveal at 20s) → auto-transition sequence end-to-end on a scratch
port, including bringing a real server up mid-wait and confirming the auto
navigation fired; re-verified relaunch (single instance, zero duplicates) and
clean shutdown, both on the new version. Added
`test/desktop-launcher-cold-start.test.mjs`: a structural regression guard
(Windows GUI behavior has no test harness in this repo's CI) that fails if the
exact bug shape (a blocking call gating window creation, or a give-up path in the
page's poll) is ever reintroduced -- confirmed it actually catches the old,
buggy wave-3 source when pointed at it.

---

## First hands-on-test remediation (superseded in the areas above, still
## accurate for what M6 already provides and the guided-first-run reasoning)

Tim's own hands-on acceptance test (plugin registered, enabled, Orca restarted,
launcher run) reproduced two real defects. Both are fixed; the architecture
section further down is updated to match, but is kept for its still-accurate
reasoning about what M6 already provides and why a guided first-run step (not
a silent settings write) is the right one-time-config design.

**Defect 1 — plugin enabled but the launcher still said "Checking...":**
diagnosed from real runtime evidence (not by asking Tim to redo setup).
`netstat`/`Get-CimInstance` confirmed the real `tsf/server` process (spawned by
Orca's own plugin activation, `Orca.exe C:\TSF_ORCA\tsf\server\http-server.mjs`)
was genuinely listening on 4610 and answering `/api/meta` with `200`. The
first-run page's own `fetch()` poll, though, runs from a `file://` origin
(`Origin: null`), and `tsf/server`'s JSON responses carried no
`Access-Control-Allow-Origin` header -- Chromium-based engines (WebView2
included) complete such a request at the network level (which is why every
process/port check looked "reachable") but discard the response in `fetch()`
before the page's JS ever sees it, so the guide could never detect a
genuinely-ready backend, no matter how long Tim waited. Fixed with one header
on `tsf/server`'s shared `json()` response helper
(`Access-Control-Allow-Origin: *` -- safe here since this server only ever
binds 127.0.0.1). Reproduced and fixed end-to-end on a scratch port with a
real client/server pair, confirmed via a real Add-Type-hosted WebView2 window
auto-transitioning from the guide to the live UI the moment the fixed server
came up, with no relaunch.

**Defect 2 — Edge `--app` didn't feel like a dedicated Windows app:** the
first fix attempt (a compiled, self-contained .NET 8 + WebView2 WinForms host,
`dotnet publish -r win-x64 --self-contained`) built and ran cleanly in
isolation, but **Windows Smart App Control hard-blocked it on the real target
machine** the moment it tried to launch (`Microsoft-Windows-CodeIntegrity
/Operational` event 3077/3118: "did not meet the Enterprise signing level
requirements"). Smart App Control rejects unrecognized/unsigned executable
images outright, with no user-facing override once a machine is in
enforcement mode; obtaining a code-signing certificate is both out of scope
for this local V1 (Tim's own instruction) and a paid/approval-requiring
decision this program does not make unilaterally. This is the exact case
Tim's own instruction anticipated ("unless evidence shows another minimal
approach is materially better") -- the evidence here is unambiguous, so the
compiled-exe project was discarded entirely (never committed).

The actual fix: host the WebView2 control **directly inside `Launch-TSF.ps1`'s
own `powershell.exe` process** instead of shelling out to Edge or a second
executable. `powershell.exe` is already Microsoft-signed and already runs
successfully on this machine (it's what the Desktop shortcut has always
invoked); loading the WebView2 SDK's managed `net462` assemblies into it via
`Add-Type` and creating a plain WinForms `Form` + `WebView2` control produces
a genuine, separate, independently-titled/iconed top-level window with its own
taskbar entry -- no second executable image is ever loaded, so Smart App
Control has nothing new to evaluate. Confirmed empirically: the compiled exe
was blocked (event log evidence above); the identical WebView2 control hosted
this way was not (no new CodeIntegrity event, real window, real content
rendered, screenshotted). See `tsf/launcher/webview2/NOTICE.md` for the
vendored-DLL rationale and licensing, and `Launch-TSF.ps1`'s own header
comment for the full explanation in-place.

Single-instance handling (relaunch activates the existing window rather than
opening a second one) was added at the same time via a named Mutex +
`FindWindow`/`SetForegroundWindow`, since the window is now this same process
rather than a fire-and-forget child.

---


Authorized directly by Tim after the M13 handoff, triggered by a concrete defect the
M6-desktop-launch investigation surfaced on the real machine: no TSF installer/exe/
shortcut exists, and TSF's Orca plugin has never been registered (`pluginSystemEnabled:
false`, `devPluginPaths: []` in the real live `orca-data.json`). This is the one bounded,
fixable defect M13 found — M14 exists to close exactly it, nothing more.

## Hard constraints (verbatim from Tim's authorization)

- No new product capabilities. No forking/rebuilding Orca's desktop app merely for a TSF
  icon. Smallest supported architecture. Orca core source delta stays 0.
- Normal operation must never require Tim to: open Orca manually first, enable Orca
  plugin settings by hand, `cd` into the repo, run `npm run dev`, type a localhost URL,
  launch Claude/Codex manually, or use Orca's command palette just to open TSF.
- Never silently overwrite unrelated Orca settings. If one-time configuration is
  unavoidable, make it part of an explicit TSF first-run setup, not raw settings editing
  by Tim.
- Prefer a dedicated TSF window (not a bare browser tab) if achievable without
  duplicating Orca's runtime. Keep the dark/purple TSF interface; give it a name, icon,
  close/minimize, and a clean relaunch.
- Produce a concrete local Windows artifact: deterministic build, simple local install,
  Start Menu + Desktop shortcuts, uninstall path where practical. No code signing/public
  distribution required for this local V1.
- After automated packaging/verification is GREEN, stop for exactly one hands-on Tim
  test. Never claim that human proof without Tim performing it.

## What already exists (M6) and is reused unchanged

- `tsf/main.mjs`'s `activate(orca)` already spawns `tsf/server` as a real child process
  for as long as Orca has the plugin active (`startServerLifecycle`, bounded backoff,
  EADDRINUSE treated as "already running"), on the fixed port `TSF_SERVER_PORT = 4610`.
  Once the plugin is registered and enabled, "Orca is running" already implies "the TSF
  backend is running" — no new server-lifecycle code is needed for M14.
- `tsf/server` already serves the built `tsf/ui/dist` SPA as static files alongside
  `/api/*` (confirmed: rebuilding `tsf/ui/dist` from the current accepted source and
  grepping the bundle for `Fleet Planning`, `Flight Recorder`, `regression-check`,
  `fleet/schedule`, `NO_ESTIMATE_ON_FILE_FOR_PROJECT` — all present, one match each — proves
  the M9/M11/M12 UI is genuinely in the fresh build, not the stale M8 one it replaces).
- The real, supported Orca CLI already exposes exactly the two primitives a launcher
  needs and nothing unsupported: `orca open` (launch Orca, wait for the runtime to be
  reachable) and `orca status --json` (`app.running`, `app.pid`, `runtime.reachable`).
  There is no CLI for plugin registration — that gap is what M14's first-run setup step
  closes.

## The one-time configuration gap, and why it stays a guided step

`devPluginPaths` has no CLI surface; the only supported way to register a dev plugin
path is Orca's own Settings → Plugins → Development section. Two ways to close this
were considered:

1. **Programmatically merge-patch the real `orca-data.json`** (append to
   `devPluginPaths`, flip `pluginSystemEnabled` only if false, touch nothing else).
   Rejected for V1: the file's schema is Orca's internal, undocumented state — writing
   to it directly ties TSF to an implementation detail that can change under an Orca
   upgrade with no compatibility contract, and produces exactly the kind of silent,
   unsupervised settings mutation Tim's own constraint is warning against, even with an
   additive merge.
2. **A TSF-owned guided first-run screen** that detects the backend isn't reachable yet,
   shows Tim the exact three steps in Orca's existing, real, already-shipped Settings UI
   (open Settings → Plugins, turn on "Plugin system", paste one exact folder path into
   Development, enable "Thousand Sunny Fleet Foundation" once it appears), offers a
   one-click "Copy path" button, and re-polls automatically. **Chosen.** It uses only
   Orca's existing supported UI, makes the one-time step fully visible and Tim-driven
   rather than silent, and needs no dependency on `orca-data.json`'s internal shape.

This step runs at most once per machine — after it, the plugin stays registered and
enabled across every future Orca launch, and every subsequent TSF launch is a true cold
double-click with no manual steps.

## Architecture: what M14 actually adds

A small, dependency-free launcher living entirely under `tsf/launcher/` (zero Orca core
delta, zero new runtime dependencies):

1. **`tsf/launcher/Launch-TSF.ps1`** — the launch orchestrator, written in PowerShell
   rather than Node: Node is already a hard requirement for `tsf/server` itself, but only
   because *Orca's own bundled runtime* spawns it (`process.execPath` inside `main.mjs`,
   Orca's own Electron/Node, not a system install) — a launcher Tim double-clicks
   directly cannot assume Node exists on his machine at all, only Windows' own built-in
   PowerShell, which is what "no developer bootstrap" actually requires here:
   - Creates and shows a genuine dedicated window **immediately, before anything else**
     (measured live: ~1 second from double-click) -- by loading the WebView2 SDK's
     managed assemblies (`tsf/launcher/webview2/`, vendored) via `Add-Type` and creating
     a plain WinForms `Form` + `WebView2` control in this same process. No second
     executable is ever launched (see the remediation section above for why: Smart App
     Control blocks a compiled host exe outright, but has nothing new to evaluate when
     the control is loaded into the already-trusted `powershell.exe` process itself).
   - Fires `orca open` via `Start-Process` (non-blocking, retried up to 6 times 15s
     apart in the background) to ensure Orca itself is up -- this never gates window
     creation, and never blocks the UI thread.
   - Navigates the window straight to `first-run-setup.html`, which owns *all*
     reachability waiting itself (via `fetch()` against the browser engine's own
     networking stack, not PowerShell's) and never gives up on its own: an immediate
     neutral "Starting…" state, the guided registration steps revealed only past a
     real-cold-boot-shaped threshold, and an honest "this is stalled" note if the wait
     goes long -- auto-navigating the same window to the real UI the moment the backend
     answers, whether that's in one second or two minutes.
   - A named Mutex + `FindWindow`/`SetForegroundWindow` makes a relaunch activate the
     existing window instead of opening a second one.
   - A top-level error handler plus a WinForms `ThreadException` handler show a real,
     visible `MessageBox` for any genuine failure, anywhere in the launch sequence --
     no more silent death behind `-WindowStyle Hidden`.
2. **`tsf/launcher/first-run-setup.html`** — a small, self-contained static page (TSF's
   own dark/purple palette, no network calls) that is now the *first* thing shown on
   every launch, not just an error path -- see its own state machine above.
3. **`tsf/launcher/webview2/`** — the three WebView2 SDK files (`net462` managed +
   native loader) `Launch-TSF.ps1` loads, vendored rather than restored via NuGet at
   install time so the launcher needs no package-restore or build step on Tim's machine.
   See its `NOTICE.md` for the redistribution/licensing rationale.
4. **`tsf/launcher/Install-TsfLauncher.ps1`** — one-time local install: writes the
   Desktop and Start Menu `.lnk` shortcuts pointing at `Launch-TSF.ps1` in place (icon,
   working directory, hidden console window) — nothing is copied to a separate
   location, TSF keeps running from this checkout, same as M6 — and an
   `Uninstall-TsfLauncher.ps1` counterpart that removes them.
5. A generated TSF icon (`tsf/launcher/tsf.ico`) for the window/shortcuts, built from
   TSF's own established purple/ship-wheel identity — no external asset dependency.
6. One header on `tsf/server`'s shared JSON response helper
   (`Access-Control-Allow-Origin: *`) so the first-run guide's `file://`-origin
   readiness poll can actually read the response (Defect 1's fix -- see above).

None of this touches `src/**` (Orca core) or adds a `dependencies` entry to any
`package.json`.

## Acceptance tests (mapped to Tim's 8 named checks)

| # | Test | How it's verified |
|---|------|--------------------|
| 1 | Cold launch | Desktop shortcut → dedicated window appears within ~1s regardless of Orca's state (measured live) → `orca open` fires in the background (retried) → the window itself shows "Starting…" and transitions to the real UI the moment the backend answers, however long that takes → no manual step, no silent hang (this exact path was the wave-3 defect; see the remediation section above for the live specimen/root-cause evidence) |
| 2 | Relaunch | Orca and the window already running → the named-Mutex check finds the existing instance and activates its window (`FindWindow`/`SetForegroundWindow`) instead of opening a second one |
| 3 | Runtime unavailable | Backend never becomes reachable (plugin not yet registered) → honest first-run guide shown, not a blank page or crash; auto-transitions to the real UI in place the moment the backend comes up, no relaunch needed (real end-to-end proof: scratch-port server brought up while the guide was open and polling, window switched to the real UI within one 5s poll cycle) |
| 4 | Provider state | TSF UI's own existing provider/account surfaces (Work, Agents) render honestly inside the dedicated window exactly as they do in a browser tab |
| 5 | Current UI | Rebuilt bundle proven (above) to contain Evaluation, Flight Recorder, Fleet Planning |
| 6 | Operator flow | Every nav tab (Home, Work, Projects, Agents, Evaluation, Fleet, plus in-project Estimate/Keep Going/Flight Recorder/Memory tabs) reachable from the dedicated window |
| 7 | Shutdown | The launcher process now *is* the window (`Application.Run` blocks until it closes) rather than a fire-and-forget child -- closing the window ends that one process and releases the single-instance Mutex; `tsf/server`'s own lifecycle is unaffected either way, exactly as under Orca's plugin deactivate() |
| 8 | No developer bootstrap | Nothing in the shortcut path invokes `npm`, a dev server, or a raw localhost URL Tim has to type |

## Explicitly out of scope

Code signing, public/external distribution, any change to `src/**`, any new product
capability beyond "make the existing UI reachable by double-click," and M15 or any
milestone beyond M14.
