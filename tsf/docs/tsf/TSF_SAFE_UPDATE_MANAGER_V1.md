# TSF Safe Update Manager V1

Not numbered as a milestone wave (explicit instruction: no M15). Builds on
the Keep Going/Live Work Feed/Command foundation already adopted.

## Goal

Make updating TSF itself safe, understandable, and boring: a trustworthy
runtime identity, an update-safety gate that never restarts underneath
active project work, governed (fast-forward-only) self-adoption with a
receipt and a real rollback path, an artifact-rebuild contract that makes
"forgot to rebuild the UI" structurally impossible, and an honest
plugin-packaging feasibility measurement.

## What was built

| Concern | Module(s) |
|---|---|
| Real git plumbing (rev-parse, ancestry, ff-only merge, hard reset) | `tsf/adapters/git-identity.mjs` |
| Live runtime identity classification | `tsf/domain/runtime-identity.mjs`, `tsf/server/runtime-identity-tracker.mjs`, `GET /api/runtime-identity` |
| UI bundle identity stamping | `tsf/ui/vite.config.ts`'s `buildIdentityPlugin` -> `dist/build-identity.json` |
| Update safety (active-work gate) | `tsf/domain/update-safety.mjs`, `GET /api/update-safety` (reuses `fleet-work-status.mjs`, the same aggregator Work/Command already share) |
| Governed self-adoption + receipt | `tsf/domain/self-update-adoption.mjs` |
| Artifact rebuild contract | `tsf/domain/artifact-rebuild-contract.mjs` |
| Stale-process detection | `tsf/server/runtime-identity-tracker.mjs`'s `isProcessAlive`/runtime-metadata file (TSF-owned; M14's own equivalent pattern is scoped to Orca's process, not `tsf/server`) |
| Post-update health verification | `tsf/server/post-update-verification.mjs` |
| Operator UX | `tsf/ui/src/components/SystemStatusIndicator.tsx` (sidebar, same trigger-button -> Dialog shape as `CapacityIndicator.tsx`) |

Real test coverage: `tsf/test/git-identity.test.mjs` (real disposable git
repos -- real fast-forward, real refused divergence, real rollback),
`tsf/test/runtime-identity.test.mjs`, `tsf/test/update-safety.test.mjs`,
`tsf/test/self-update-adoption.test.mjs`, `tsf/test/artifact-rebuild-contract.test.mjs`,
`tsf/test/runtime-identity-tracker.test.mjs`, `tsf/test/http-runtime-identity.test.mjs`,
`tsf/test/self-update-scenarios.test.mjs` (real spawn/kill of `tsf/server`
as a genuine child process, twice, with real PID/commit verification each
time -- not simulated).

## Deliberately not built this pass (disclosed, not silently skipped)

**A one-click "Apply Now" self-restart action.** Safely having the process
serving the current HTTP request also kill and replace itself is a real,
separate piece of engineering (a supervisor/watchdog process outside the
request/response cycle) -- not a checkbox on top of what exists today. The
UI shows real, honest status and tells the operator the exact real command
to run; it does not pretend a one-click restart exists. This is the
single largest remaining gap between what's here and the full "click
Apply, TSF safely updates itself" operator experience the spec describes.

**Actual execution of a governed adoption merge.** `self-update-adoption.mjs`
and `git-identity.mjs`'s `ffOnlyMerge`/`resetHardTo` are real and tested
against real repos -- but nothing in this pass actually runs a merge
against this worktree's own accepted `tsf/main`, since doing so live,
unsupervised, was never asked for and the receipt's own `decidedBy ===
'TIM'` gate means it structurally can't happen without your explicit
authorization anyway.

## Plugin packaging feasibility -- real, measured numbers

Investigated whether TSF's Dev-plugin registration (used today because it
was assumed the tree exceeds Orca's normal install limits) is still
necessary, or whether a real packaged install is now feasible.

**Orca's real, documented limit** (`src/main/plugins/plugin-content-hash.ts`):
2,000 files/dirs, 50 MiB total, enforced during normal (non-Dev) plugin
install via a content-addressed hash of the whole tree.

**TSF's real, measured size** (this worktree, `node_modules` excluded --
`tsf/node_modules` does not exist; `tsf/ui/node_modules` is dev-tooling
only, ~155 MiB / 8,251 files, never runtime-required):

| Scope | Files | Bytes |
|---|---|---|
| Full `tsf/` source tree (no `node_modules`) | 419 entries | 4,578,707 (≈4.37 MiB) |
| Runtime-required subset only (`server/ domain/ adapters/ routing/ providers/ contracts/` + `panel.html` + `ui/dist` + `main.mjs` + `orca-plugin.json`) | 114 files | 1,375,897 (≈1.31 MiB) |
| `tsf/ui/dist` alone (built, included above) | 3 files | 667,594 (≈652 KiB) |

**Finding: the assumption does not hold.** Both the full source tree and
the runtime-required subset are well under Orca's 2,000-file/50 MiB cap --
by roughly 5x on file count and 10-40x on size. The real reason TSF uses
the Dev-plugin path is documented elsewhere
(`docs/tsf/M6_DESKTOP_TSF_V1.md:159-171`): Orca's Dev-plugin support
(`devPluginPaths`) already existed and needed no separate installer, not a
size/count limit -- and Orca's content-hash/size gate (`hashPluginTree`)
is in fact never even invoked for a Dev-mode plugin with no instructional
contributions (TSF's manifest declares none), so it was never actually
gating TSF's tree either way.

**Conclusion:** a real, installable package is measurably feasible
(runtime subset + built UI + manifest, excluding `test/ docs/ fixtures/
pilots/ launcher/ programs/` and both `node_modules` trees). Building the
actual packaging script/pipeline is a real follow-up task, not done in
this pass (the investigation was scoped to measuring feasibility
honestly, not shipping a new distribution mechanism) -- but the numbers
mean it is no longer correct to say TSF is too large for Orca's normal
install path. Dev-plugin registration can stay for now by choice
(zero-friction local development), not by size necessity.

## Operator workflow today

1. Open the **System** indicator in the left sidebar (below the nav list) --
   shows real running/disk/UI-bundle commit identity and real update
   safety (`SAFE_NOW` / `WAIT_FOR_ACTIVE_WORK` / `TIM_REQUIRED`, with the
   real blocking project(s) linked if any).
2. If `UI_BUNDLE_STALE`: `cd tsf/ui && npm run build`, reload the page.
3. If `LIVE_RUNTIME_STALE` and safety is `SAFE_NOW`: reload the TSF plugin
   from Orca (or otherwise restart the `tsf/server` process) -- no active
   work will be interrupted, since the safety check already confirmed that.
4. If safety is `WAIT_FOR_ACTIVE_WORK` or `TIM_REQUIRED`: the indicator
   names exactly which project(s) are blocking and why; wait for that work
   to clear, or resolve what needs you, before restarting.
5. Governed self-adoption (merging a verified candidate worktree into
   accepted `tsf/main`) is not yet a one-click UI action -- run the ff-only
   merge yourself once `assessAdoptionReadiness` (or your own judgment)
   confirms every condition, and record the outcome; a future pass can
   wire this into the same System panel.
