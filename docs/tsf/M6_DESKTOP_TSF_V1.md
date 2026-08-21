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

5. **Plugin execution model**: `src/main/plugins/plugin-host-runtime.ts`
   defines `createPluginWorkerRuntime` — plugin `main.mjs` modules run
   inside a dedicated Node `worker_thread`, not the main Electron
   process and not a browser/vm sandbox. The only searched-for
   capability/permission gate (`capabilities`, `process`, `childProcess`,
   `spawn`) turned up no matches in that file — meaning the *exposed
   `orca` API object* is a bounded surface (`commands.register`,
   `host.call`, `events.on`, `log`), but it's still an open question
   (not yet verified) whether the worker thread itself is permitted to
   `import('node:child_process')` directly the way `tsf/adapters/
   orca-orchestration-bridge.mjs`/`orca-capacity-bridge.mjs` already do
   elsewhere in this program. **Unresolved — first thing wave 2 must
   verify before committing to a design**, since the whole "connects
   to/starts required local TSF/Orca services" criterion hinges on it.

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

## Open questions for wave 2 (deliberately not resolved by guessing)

1. Can a plugin's `main.mjs` (running in `createPluginWorkerRuntime`'s
   worker thread) `import('node:child_process')` and spawn/manage a
   long-lived local process (`tsf/server/http-server.mjs`) today? Read
   `plugin-host-runtime.ts` and its worker-thread bootstrap fully, and
   probe empirically in a safe fixture if the source alone doesn't
   settle it.
2. Can a plugin panel's `entry` serve more than one static HTML file —
   i.e., can `panel.html` embed/proxy the full built `tsf/ui/dist`
   (multi-route SPA, its own JS/CSS assets, calls to a local `/api`
   origin) rather than being a single inline-script page? Read how
   `contributes.panels[].entry` is resolved and loaded (likely also in
   `src/main/plugins/`).
3. If (1) or (2) turn out to be infeasible or too constrained, the
   fallback design is a small, separate, `tsf`-owned Electron/Node
   launcher (its own `package.json`/build, NOT touching `src/main`)
   that starts `startStandaloneServer` in production mode (after adding
   static-file serving of `tsf/ui/dist` to it, still inside
   `tsf/server/http-server.mjs`) and opens a plain window/browser tab
   pointed at it — still zero Orca core delta, just not reusing the
   plugin-panel surface. Needs its own smoke-test/build-packaging
   research before design.
4. "Windows application build with reliable launch, graceful
   backend-unavailable state, clean shutdown" needs a concrete decision
   on which of the two paths above is used before this can be scoped
   further, since the packaging story differs substantially between
   "extend the existing Orca plugin" and "ship a second app."

## Acceptance criteria re-check against current code (not claims)

- "Double-click launch opens TSF UI and connects to/starts required
  local TSF/Orca services" — NOT met; no launcher exists in either
  candidate form yet.
- "Planner Chat, projects, Health, adoption all work without manual
  localhost commands" — NOT met; all require `npm run dev` today.
- "Orca core delta stays 0" — achievable either way; both candidate
  designs above stay entirely inside `tsf/`.
- "Windows application build with reliable launch, graceful
  backend-unavailable state, clean shutdown" — NOT met; depends on
  wave-2's design decision.
- "Update/install strategy documented; unsigned local dev installer
  acceptable; no external distribution" — NOT met; not yet designed.
- "Smoke-tested locally" — NOT met; nothing to test yet.

No acceptance criterion is already satisfied by existing code (unlike
M4/M5) — this milestone's gap really is close to "everything," but wave
2's job is answering questions 1-2 above before writing any
implementation, exactly the research-first discipline this program has
already validated twice.
