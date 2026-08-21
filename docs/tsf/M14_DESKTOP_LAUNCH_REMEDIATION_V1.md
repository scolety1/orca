# M14 — TSF Desktop Launch + V1 Release-Candidate Remediation

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
   - Runs `orca open` (or `orca status --json` first, to skip the relaunch if Orca is
     already running) to ensure Orca itself is up.
   - Polls `http://127.0.0.1:4610/api/meta` on a bounded interval/timeout.
   - If it becomes reachable: launches a dedicated app-mode window pointed at
     `http://127.0.0.1:4610` (Microsoft Edge's built-in `--app=` mode — ships with every
     Windows 11 install, so no bundled browser engine and no Electron fork are needed —
     falls back to the OS default browser if `msedge.exe` cannot be located).
   - If it times out: opens the same dedicated window pointed at the local, static
     `first-run-setup.html` guide instead of a bare error.
2. **`tsf/launcher/first-run-setup.html`** — a small, self-contained static page (TSF's
   own dark/purple palette, no network calls) with the exact guided steps above, a copy-
   path control, and a "Check again" button that re-invokes the readiness poll.
3. **`tsf/launcher/install-tsf-launcher.ps1`** — one-time local install: copies the
   launcher files to a stable per-user location, writes the Desktop and Start Menu
   `.lnk` shortcuts (icon, working directory, hidden console window), and an
   `uninstall-tsf-launcher.ps1` counterpart that removes them.
4. A generated TSF icon (`tsf/launcher/tsf.ico`) for the shortcuts, built from TSF's own
   established purple/ship-wheel identity — no external asset dependency.

None of this touches `src/**` (Orca core) or adds a `dependencies` entry to any
`package.json`.

## Acceptance tests (mapped to Tim's 8 named checks)

| # | Test | How it's verified |
|---|------|--------------------|
| 1 | Cold launch | Desktop shortcut → Orca not yet running → launcher starts Orca, backend comes up, dedicated window opens on the real UI, no manual step |
| 2 | Relaunch | Orca already running → launcher skips redundant `orca open`, window opens immediately |
| 3 | Runtime unavailable | Backend never becomes reachable (plugin not yet registered) → honest first-run guide shown, not a blank page or crash |
| 4 | Provider state | TSF UI's own existing provider/account surfaces (Work, Agents) render honestly through the dedicated window exactly as they do in a browser tab |
| 5 | Current UI | Rebuilt bundle proven (above) to contain Evaluation, Flight Recorder, Fleet Planning |
| 6 | Operator flow | Every nav tab (Home, Work, Projects, Agents, Evaluation, Fleet, plus in-project Estimate/Keep Going/Flight Recorder/Memory tabs) reachable from the dedicated window |
| 7 | Shutdown | Closing the app window leaves `tsf/server`'s child process lifecycle exactly as it already is under Orca's own plugin deactivate() — no separate process for the launcher to leak, since it exits once the window is launched |
| 8 | No developer bootstrap | Nothing in the shortcut path invokes `npm`, a dev server, or a raw localhost URL Tim has to type |

## Explicitly out of scope

Code signing, public/external distribution, any change to `src/**`, any new product
capability beyond "make the existing UI reachable by double-click," and M15 or any
milestone beyond M14.
