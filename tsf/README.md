# Thousand Sunny Fleet (TSF)

TSF is a separable, TSF-owned overlay on top of the Orca foundation
this repository is forked from. Orca stays in charge of agents,
terminals, sessions, worktrees, provider launch, and browser/runtime
facts. TSF owns provider-neutral roles, compact handoffs, portfolio
attention/notifications, mission state, onboarding, adoption, release
protection, evidence, and high-level project Health — everything about
*running a fleet of real software projects*, not the terminal/agent
substrate underneath it.

## Current status

TSF is real, not a simulation: it onboards real projects, dispatches
real autonomous work through Keep Going runs, and performs real
adoption (a real `git merge`, durably tracked so the system never
tells you twice about the same completion). It carries its own safety
mechanisms — project execution holds, a host resource-pressure
governor, mutation-tested response truthfulness — layered independent
of the underlying agent/provider. See
[`docs/tsf/TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2_FINAL_REPORT.md`](docs/tsf/TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2_FINAL_REPORT.md)
for the current, actively-maintained state of the control plane: what's
been hardened, what's still in progress, and the current stability
declaration.

## Architecture at a glance

- **`domain/`** — pure business logic (run/mission state machines,
  adoption, attention aggregation, resource pressure, receipts). No
  I/O; this is what the test suite mostly exercises directly.
- **`server/`** — HTTP routes, durable stores (JSON-file-backed,
  file-locked), and the command/chat bridges that turn a natural-
  language message into a real dispatch/adoption/hold action.
- **`ui/`** — the standalone TSF operator frontend (Home / Work /
  Projects / Agents, Planner Chat, Adoption). Not part of the root
  pnpm workspace — its own npm project.
- **`adapters/`** — bounded, capability-scoped connectors out to the
  real world (HTTP fetch, research workers, browser capture).
- **`providers/` / `routing/`** — provider-neutral role mapping and
  capacity-aware routing (which agent/model handles which role).
- **`contracts/`** — versioned JSON schemas for the structured
  payloads TSF passes between its own components.
- **`fixtures/` / `pilots/`** — disposable test fixtures and the
  evidence packages from real onboarding pilots.
- **`programs/`** — state for long-running autonomous programs.
- **`launcher/`** — first-run/desktop-launcher setup scripts.
- **`migration/`** — capability/upstream-delta manifests tracking
  Orca-foundation drift.
- **`test/`** — ~330 test files, ~3200+ tests. The real regression
  suite; see Testing below.

A handful of design/requirement docs live at `tsf/`'s own root
(`RESOURCE_PRESSURE_GOVERNOR_REQUIREMENT.md`, `ZERO_RELAY_PLANNER_WORKER_ARCHITECTURE.md`,
etc.) rather than under `docs/` — they're real, actively-referenced
specs (linked directly from the source files they specify), left in
place rather than moved to avoid breaking those references.

## Local startup

Run the bounded checks with:

```powershell
node --test tsf/test/foundation-contracts.test.mjs
node --test tsf/test/*.test.mjs
node tsf/health/foundation-health.mjs
node tsf/fixtures/run-dogfood.mjs
```

### Operator UI

`tsf/ui` is the standalone TSF operator frontend. It reads real TSF
domain state and real pilot evidence through `tsf/server`, its narrow
adapter. See
[`docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md`](../docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md)
for the architecture (in the historical/foundational docs corpus —
see that directory's own index for why).

```powershell
cd tsf/ui
npm install
npm run dev   # http://127.0.0.1:4600 — UI and its /api adapter in one process
```

### Desktop launch

TSF is also registered as a real Orca plugin (`orca-plugin.json` /
`main.mjs`): once enabled and added as a dev plugin path in Orca's own
Settings, activating it spawns `tsf/server` automatically and the
`TSF: Open UI` command opens it in your browser — no manual
`npm run dev` needed. This path serves `tsf/ui`'s **built** output
(`tsf/ui/dist`), not the Vite dev server, and `dist/` is gitignored —
build it once first:

```powershell
cd tsf/ui
npm install
npm run build
```

Without a build, the plugin still starts `tsf/server` correctly, but
the UI itself 404s (a log line at activation names this exact cause).

## Testing

The full suite lives under `tsf/test/`. From the repo root:

```powershell
node --test tsf/test/*.test.mjs
```

On a memory-constrained or shared machine, `--test-concurrency=4`
noticeably reduces peak memory with little to no wall-clock cost.

## Important docs

- **Current work**: [`docs/tsf/`](docs/tsf/README.md) (this directory's own index)
- **Foundation/history**: [`../docs/tsf/`](../docs/tsf/INDEX.md) (repo-root `docs/tsf/`, outside this directory)
- **Design system**: root [`AGENTS.md`](../AGENTS.md) / [`docs/STYLEGUIDE.md`](../docs/STYLEGUIDE.md) apply to any TSF UI work too
