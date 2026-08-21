# Thousand Sunny Fleet Overlay

This directory is the separable TSF-owned overlay for the Orca foundation. It keeps Orca in charge of agents, terminals, sessions, worktrees, provider launch, browser/runtime facts, and recovery. TSF owns provider-neutral roles, compact handoffs, portfolio attention controls, mission state, adoption, release protection, evidence, and high-level Health.

The implementation is fixture-only. It grants no authority to onboard a real project, push, merge, deploy, publish, read credentials, or mutate production.

Run the bounded checks with:

```powershell
node --test tsf/test/foundation-contracts.test.mjs
node --test tsf/test/*.test.mjs
node tsf/health/foundation-health.mjs
node tsf/fixtures/run-dogfood.mjs
```

## Operator UI

`tsf/ui` is the standalone TSF operator frontend (Home / Work / Projects / Agents, Planner Chat, Adoption). It is a separate npm project — not part of the root pnpm workspace — and reads real TSF domain state and real pilot evidence through `tsf/server`, its narrow adapter. See `docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md` for the architecture.

```powershell
cd tsf/ui
npm install
npm run dev   # http://127.0.0.1:4600 — UI and its /api adapter in one process
```

## Desktop launch (M6)

TSF is also registered as a real Orca plugin (`orca-plugin.json`/`main.mjs`): once enabled and added as a dev plugin path in Orca's own Settings, activating it spawns `tsf/server` automatically and the `TSF: Open UI` command opens it in your browser — no manual `npm run dev` needed. This path serves `tsf/ui`'s **built** output (`tsf/ui/dist`), not the Vite dev server, and `dist/` is gitignored — build it once first:

```powershell
cd tsf/ui
npm install
npm run build
```

Without a build, the plugin still starts `tsf/server` correctly, but the UI itself 404s (a log line at activation names this exact cause).
