# M6: Desktop TSF — Wave 1 Research

## What already exists (read directly from source, not assumed)

1. **`tsf/ui`** is a standalone Vite/React SPA (`tsf/ui/package.json`, own
   `node_modules`, not part of the root pnpm workspace). It already has a
   built production bundle at `tsf/ui/dist`. Today it is only ever run via
   `cd tsf/ui && npm run dev` (`tsf/README.md`), which starts Vite's dev
   server with the real `tsf/server` backend mounted as middleware in the
   SAME process — the exact setup this whole program's own live proofs
   (M2 UI proof, M3 dogfood, M4 restart proof) have used by hand.

2. **`tsf/server/http-server.mjs`** exports `startStandaloneServer(port =
   4610)` (`tsf/server/http-server.mjs:582`) — a real, already-working
   plain Node `http.createServer` entry point, invoked directly when the
   file is run as `node http-server.mjs` (`import.meta.url ===
   pathToFileURL(process.argv[1]).href` guard at line 591). **Confirmed
   by grep: it serves ONLY the `/api/*` routes — no static-file serving
   of `tsf/ui/dist` exists anywhere in this file.** So today there is no
   single process that serves both the built UI and its API together;
   the dev-mode Vite-middleware trick is the only place that currently
   happens.

3. **Orca already has a real, general-purpose plugin system** (not
   something M6 needs to invent): `src/main/plugins/*` (core Orca,
   untouched by this program). TSF is already registered as a real Orca
   plugin: `tsf/orca-plugin.json` declares `contributes.panels` (id
   `foundation`, entry `panel.html`) and `contributes.commands`; `tsf/
   main.mjs` is the plugin's `activate(orca)` entry, calling
   `orca.commands.register(...)` and `orca.host.call('storage.get'/...)`.
   **This is the plugin's OWN existing wiring — entirely inside `tsf/`,
   zero Orca core files** — meaning it's a real, available integration
   point rather than something to build from nothing.

4. **However, the currently-registered panel is a stale, disconnected
   placeholder**: `tsf/panel.html` is a thin "Wave 4"-era static HTML
   page (inline `<script>`, `postMessage`-based `orca-panel-action`
   calls to `workspace.readContext` only) with zero relationship to the
   real, current TSF UI (`tsf/ui`'s PlannerChatPanel/LiveWorkFeed/
   KeepGoingPanel/etc., built across M2-M5) or the real `tsf/server` HTTP
   API. It predates all of M2-M5's actual product surface.

5. **Plugin execution model — CORRECTED in wave 2** (wave 1 misread this
   from the file name alone): `src/main/plugins/plugin-host-runtime.ts`'s
   `createPluginWorkerRuntime` is only the message-loop logic that runs
   *inside* the plugin process; the actual process is started by
   `src/main/plugins/plugin-host-process.ts`'s `startPluginWorker`, which
   calls real Node `child_process.fork(entryPath, [], {execArgv: [],
   stdio: [...,'ipc'], ...})`. This is a genuine, separate OS-level Node
   process (`ELECTRON_RUN_AS_NODE` makes the forked Electron binary run
   as plain Node) — not a `worker_thread`, not a vm sandbox. `execArgv:
   []` only strips inspector/loader flags; the process itself has full,
   unrestricted Node module access. Its environment is a scrubbed
   allowlist (`plugin-worker-env.ts`) that keeps `PATH`/`HOME`/
   `USERPROFILE`/Windows system vars but drops `LOCALAPPDATA`/
   `ProgramFiles` — a real, minor gotcha for `orca-capacity-bridge.mjs`'s/
   `orca-orchestration-bridge.mjs`'s own CLI-resolution order (their first
   two candidates would silently miss inside a plugin process; their
   hardcoded-path and bare-`orca`-on-PATH fallbacks still work).

## Wave 2 findings (both open questions resolved with hard evidence)

**Question 1 — can a plugin spawn/manage a long-lived child process?
YES, confirmed.** `startPluginWorker` (`plugin-host-process.ts:88`) is a
real `fork()` with no sandbox/permission flags. A plugin's `main.mjs`
(this TSF plugin's own `activate(orca)`) can `import('node:child_process')`
directly and spawn/manage `tsf/server` exactly the way
`orca-orchestration-bridge.mjs`/`orca-capacity-bridge.mjs` already spawn
the `orca` CLI elsewhere in this program — no new capability or host-API
grant is needed for this, since it's the plugin's own process doing the
spawning, not a call through the gated `orca.host.call` bridge.

**Question 2 — can a plugin panel host the full tsf/ui SPA or talk to a
local API? NO, structurally ruled out, confirmed.** `plugin-panel-
controller.ts`'s `load()` reads the panel's `entry` as a single blob of
text (`readContainedPluginArtifactText`, capped at 10MB) and wraps it
with `buildPluginPanelShellHtml` (`src/shared/plugins/plugin-panel-
shell.ts`) before mounting it in a sandboxed `srcdoc` iframe under a
**hard-coded CSP**: `` default-src 'none'; connect-src 'none'; script-src
'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src
data:; base-uri 'none'; form-action 'none' ``. `connect-src 'none'`
blocks **every** fetch/XHR/WebSocket call, including to a same-machine
`http://127.0.0.1` origin; `script-src`/`style-src '`unsafe-inline'`
only (no `self`/`https:`/any src-based loading) means no separate JS/CSS
asset files can load, so the built multi-file `tsf/ui/dist` bundle
cannot be mounted this way at all — only a single, fully self-contained,
offline HTML document (exactly what the current placeholder already
is). This is a deliberate security boundary (documented in the shell
builder's own comments: plugins are semi-trusted, panels are documents,
never browsing contexts), not an oversight to work around.

Compounding this: `src/shared/plugins/plugin-host-api.ts`'s
`PLUGIN_HOST_API_V0` is the complete, authoritative list of every method
a plugin may call — `workspace.readContext`, `terminal.sendText`,
`notifications.show`, `storage.*`, `secrets.*`, `settings.*`,
`events.subscribe`. **There is no `shell.openExternal`-equivalent
method** — a plugin cannot even ask the host to open an external URL/
browser window on its behalf.

**Conclusion: the plugin-panel path is ruled out entirely for hosting
the real TSF UI.** The panel can, at most, remain a tiny static status
display (as it already is) — it structurally cannot become the real UI
surface. The real, viable architecture uses only the plugin's *backend*
process (confirmed unrestricted in Q1), not its panel:

1. TSF's existing plugin (`main.mjs`'s `activate(orca)`) spawns
   `tsf/server` (extended to also serve `tsf/ui/dist` as static files —
   `startStandaloneServer` serves `/api` only today, per wave 1) as a
   real child process. Confirmed via `plugin-service.ts`'s
   `performRefresh`/`workerController.reconcile` that an approved
   plugin's worker process starts automatically as part of Orca's own
   startup plugin reconciliation (`whenReady()`), not lazily on
   panel-open — so this genuinely satisfies "connects to/starts" without
   Tim running any command.
2. Since no host API can open a window/URL, the plugin registers a real
   command (`orca.commands.register`, already the exact mechanism the
   current placeholder plugin uses) that, when invoked from Orca's
   command palette, spawns the OS's own "open URL" process (`start` on
   Windows, `open` on macOS, `xdg-open` on Linux) pointed at the local
   server's origin — a plain, unprivileged child-process launch, not a
   new host-API grant. This satisfies "double-click launch" as "one
   click from Orca's own command palette," not raw localhost commands.
3. `module.deactivate` (already a supported export per `plugin-host-
   runtime.ts`'s `handleInit`) kills the spawned `tsf/server` child on
   plugin/app shutdown — the "clean shutdown" criterion.
4. "Graceful backend-unavailable state" becomes: the opened browser tab
   shows whatever `tsf/ui`'s own existing fetch-failure UI already
   renders when `tsf/server` isn't reachable (needs checking in wave 3
   whether that already exists or needs adding).

## Wave 3 findings (all 3 remaining open items resolved)

1. **Child-process lifecycle**: `tsf/server/http-server.mjs`'s
   `startStandaloneServer(port)` (line 582) has NO restart-on-crash or
   port-conflict handling built in — it's a bare `server.listen(port,
   '127.0.0.1', ...)` with no `'error'` listener. This is correctly the
   launcher's job, not the server's — but confirmed there is no existing
   precedent to copy: `orca-orchestration-bridge.mjs`/`orca-capacity-
   bridge.mjs` are single-shot, timeout-bounded CLI calls, not long-lived
   process supervisors. **This is genuinely new logic the plugin's
   `activate()`/`deactivate()` must write**: spawn the server child,
   listen for its exit and restart with backoff (bounded — not an
   infinite crash loop), and handle `EADDRINUSE` by treating it as "a
   TSF server is likely already running" (single-instance-across-
   restarts) rather than fatally erroring, matching this program's
   established honest-failure-over-silent-guessing pattern.

2. **`tsf/ui`'s backend-unavailable handling — ALREADY ADEQUATE, no new
   UI code needed** (another criterion already satisfied by existing
   code, like M4/M5 found elsewhere): `tsf/ui/src/lib/use-api.ts`'s
   `useApi` hook (the shared read-path data loader used across pages)
   already catches a non-`ApiError` rejection (exactly what `fetch()`
   throws on connection-refused/network failure) and sets an honest
   `'Unavailable — could not reach the TSF operator API.'` message
   rather than crashing or hanging. Spot-checked the write path too:
   `PlannerChatPanel.tsx`'s `send()` has the same pattern (`'Could not
   reach the planner right now.'`). Nothing to add here.

3. **Windows packaging/install-strategy — confirmed no separate
   installer is needed**: `src/main/index.ts` wires plugin discovery to
   `store.getSettings().devPluginPaths`/`pluginSystemEnabled`/
   `pluginConsents` — real local dev-plugin support already exists in
   Orca's own Settings UI. TSF's plugin isn't automatically active out
   of the box; Tim must (once) enable the plugin system, add `tsf/`'s
   plugin root as a dev plugin path, and approve/consent to it — all
   through Orca's existing Settings surface, not a new installer or raw
   localhost commands. After that one-time setup, Orca's own startup
   plugin reconciliation (wave 2's finding) activates it automatically
   on every future launch. "Update/install strategy documented" for M6
   becomes: document this one-time Settings setup, not build a
   packaging pipeline.

All three wave-3 questions are answered. Implementation (wave 4+) can
now proceed: static-file serving in `tsf/server/http-server.mjs`, the
real spawn/restart/shutdown lifecycle in `tsf/main.mjs`'s
`activate()`/`deactivate()`, and a registered "open TSF UI" command
wired into `tsf/orca-plugin.json`'s `contributes.commands`.

## The real, remaining gap (confirmed, not assumed)

Unlike M4/M5, this milestone's original `"gaps": ["everything -- not
started"]` is basically accurate — there is no double-click desktop
launcher, no production-mode single-process server+static host, and the
one existing plugin-panel wiring is a dead placeholder. But it is
**narrower than "build a whole new Electron app"**: Orca's own plugin
system is a real, already-proven host mechanism sitting entirely inside
`tsf/`'s own files, so M6 may be achievable as an update to TSF's
existing plugin (`orca-plugin.json`/`main.mjs`/`panel.html`) rather than
a second, parallel Electron shell — IF plugin worker threads can spawn
the `tsf/server` process, and IF a plugin panel can point its
`entry`/iframe at the real `tsf/ui` bundle (as static assets or via a
locally-served origin) instead of a single static HTML file.

## Open questions from wave 1 — SUPERSEDED by wave 2's findings above

Both questions below are now resolved with direct evidence (see "Wave 2
findings"); kept here only as a record of what wave 1 asked.

1. ~~Can a plugin's `main.mjs` ... spawn/manage a long-lived local
   process?~~ Resolved YES.
2. ~~Can a plugin panel's `entry` serve the full built `tsf/ui/dist`?~~
   Resolved NO — structurally blocked by the panel's CSP.
3. The "fallback design" sketched in wave 1 (a second, separate `tsf`-
   owned Electron/Node launcher) is NOT needed: extending the existing
   plugin's backend process (spawn + a real command that opens the OS
   browser) satisfies the criteria without a second app. See wave 2.
4. See wave 2's "Remaining open items for wave 3" instead.

## Acceptance criteria re-check against current code (not claims)

- "Double-click launch opens TSF UI and connects to/starts required
  local TSF/Orca services" — NOT yet met; architecture now decided
  (wave 2: plugin auto-spawns `tsf/server`, a registered command opens
  the OS browser) but not implemented.
- "Planner Chat, projects, Health, adoption all work without manual
  localhost commands" — NOT yet met; all require `npm run dev` today;
  the wave-2 architecture removes that requirement once implemented.
- "Orca core delta stays 0" — achievable; the wave-2 design stays
  entirely inside `tsf/` (plugin manifest/main.mjs/server changes only).
- "Windows application build with reliable launch, graceful
  backend-unavailable state, clean shutdown" — NOT yet met; a plugin
  needs no separate Windows "build" beyond what it already ships as, so
  this narrows to: reliable spawn/restart-on-crash logic, `tsf/ui`'s own
  fetch-failure UI being adequate for backend-unavailable, and using
  the existing `deactivate()` export for clean shutdown — all wave 3.
- "Update/install strategy documented; unsigned local dev installer
  acceptable; no external distribution" — NOT yet met; simplified by the
  wave-2 finding (no second installer needed, it's the existing plugin).
- "Smoke-tested locally" — NOT met; nothing implemented yet.

Unlike M4/M5, no acceptance criterion was already fully satisfied by
existing code, but wave 2 substantially narrowed the real work: from
"decide between two unproven architectures" to "implement one
evidence-backed architecture," exactly the value of the research-first
discipline this program has now validated three times.
