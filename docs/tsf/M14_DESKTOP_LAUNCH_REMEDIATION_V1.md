# M14 — TSF Desktop Launch + V1 Release-Candidate Remediation

## Post-hands-on-test remediation (this section first: it supersedes the
## Edge `--app` design described below)

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
   - Runs `orca open` to ensure Orca itself is up (idempotent -- safe whether Orca is
     already running or not).
   - Polls `http://127.0.0.1:4610/api/meta` on a bounded interval/timeout.
   - Either way (reachable or not), hosts a genuine dedicated window **in this same
     process** by loading the WebView2 SDK's managed assemblies (`tsf/launcher/webview2/`,
     vendored) via `Add-Type` and creating a plain WinForms `Form` + `WebView2` control --
     no second executable is ever launched (see the remediation section above for why:
     Smart App Control blocks a compiled host exe outright, but has nothing new to
     evaluate when the control is loaded into the already-trusted `powershell.exe`
     process itself). Navigates to `http://127.0.0.1:4610` if reachable, or to the local
     `first-run-setup.html` guide if not -- the guide's own polling then transitions the
     same window in place once the backend comes up, no relaunch needed.
   - A named Mutex + `FindWindow`/`SetForegroundWindow` makes a relaunch activate the
     existing window instead of opening a second one.
2. **`tsf/launcher/first-run-setup.html`** — a small, self-contained static page (TSF's
   own dark/purple palette, no network calls) with the exact guided steps above, a copy-
   path control, and a "Check again" button that re-invokes the readiness poll.
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
| 1 | Cold launch | Desktop shortcut → Orca not yet running → launcher starts Orca, backend comes up, dedicated window opens on the real UI, no manual step |
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
