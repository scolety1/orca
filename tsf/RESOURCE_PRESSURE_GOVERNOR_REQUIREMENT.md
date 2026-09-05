# Resource Pressure Governor — Durable Requirement + Real-Evidence Reconciliation

Record only, per the same discipline as `ZERO_RELAY_PLANNER_WORKER_ARCHITECTURE.md`:
requirement recorded durably, reconciled against real code (not assumed),
no large implementation wave started. Applying the requirement's own
CRITICAL-tier guidance to itself: current host RAM was ~1.69 GB when this
was written — below the 2.5 GB floor this doc defines — so building the
full integration worktree + running its test suite is deferred to the
already-queued `ORCA_RESOURCE_AUDITOR_V0` integration mission once
resources clear, rather than adding a second heavyweight worker right now.

## 0. The incident (binding product evidence)

Real, repeated, same-session evidence: host RAM (15.11 GB total) dropped to
~1.69 GB free, previously as low as ~0.5–0.9 GB; TSF pilot servers and full
test suites have been killed under this pressure; multiple concurrent
Claude sessions, Chrome, TSF/Orca, and test processes are active
simultaneously. TSF must become resource-aware before dispatching work,
using Orca's real collectors as evidence, with TSF owning the
admission/governance policy on top.

## 1. Reconciliation against Orca's REAL resource collectors (not invented)

Read directly, not assumed:

- **`C:\TSF_ORCA\src\main\memory\host-memory.ts`** (`collectHostMemory`):
  a real, working, cross-platform host-memory collector. On Windows it
  reduces to `os.freemem()`/`os.totalmem()` (the darwin/`memory_pressure`
  and linux/`/proc/meminfo` paths are platform-gated and unavailable
  here); on macOS/Linux it prefers those richer sources when available,
  always falling back to the same Node primitives. `fallbackHostMemory()`
  is the honest degrade path.
- **`C:\TSF_ORCA\src\main\memory\collector.ts`**: combines
  `collectHostMemory()` with a real `enumerateProcesses()` — this is
  where per-process/per-session attribution would come from, but it runs
  inside Orca's Electron **main process**.
- **Critical finding**: TSF's own server (`tsf/server/http-server.mjs`,
  started via `main.mjs`'s `spawn`) runs as a **separate, plain Node.js
  child process — not inside Electron's main/renderer process at all**.
  It has no `ipcMain`/`contextBridge` access to `collector.ts`'s process
  enumeration. TSF's own declared plugin capabilities
  (`orca-plugin.json`: `workspace:read`, `storage`, `events:subscribe`,
  confirmed via `foundation-health.mjs`'s `pluginExtensionSeam`) do not
  include a host-memory or process-list capability today.

This produces a real, useful split, not a single monolithic gap:

| Capability | Needs Orca-core bridge? | Why |
|---|---|---|
| Raw host memory tiers (total/free/available, HEALTHY/PRESSURED/CRITICAL/EMERGENCY) | **No** | TSF's own Node process can call `os.freemem()`/`os.totalmem()` directly — on Windows this is the *exact same primitive* `collectHostMemory()` itself falls back to, so TSF loses nothing by reading it independently |
| Which specific Orca/Claude/Codex session or process owns how much memory | **Yes** | Requires `collector.ts`'s `enumerateProcesses()`, which lives in Orca's main process; this is the same `ORCA_CORE_GAP` already disclosed for `workspaceCleanup:scan`/PTY liveness in the Resource Auditor review — not a new gap, the same one |
| Automatic process retirement/termination | **Yes, and out of V0 scope entirely** | Destructive by nature; explicitly deferred to a separately-authorized V1 |

**This changes the shape of the mission**: the host-level pressure
governor (tiers, admission recommendation, `WAITING_FOR_RESOURCES`
surfacing) is buildable **entirely within TSF today**, no Orca-core
change needed. The richer "which session to reclaim" evidence remains
gated on the same bridge proposal the Resource Auditor review already
called for — this requirement does not need a second, different bridge
proposal, it needs the existing one extended with the fields below.

## 2. Policy (starting values, configurable — not hard-coded)

| Tier | Available RAM | Admission behavior |
|---|---|---|
| `HEALTHY` | ≥ 4.0 GB | Normal Fleet concurrency; full tests, browser pilots, research workers admitted per normal capacity policy |
| `PRESSURED` | 2.5–4.0 GB | Reduce new concurrency; finish already-running bounded work; delay additional full-suite tests; serialize heavy verification; avoid redundant browser/pilot servers; reuse existing workers; surface `WAITING_FOR_RESOURCES`, never a silent stall |
| `CRITICAL` | < 2.5 GB | Stop admitting new heavyweight workers/tests/pilots; let current bounded operations checkpoint/settle; Claude/PLANNER_DEEP replans around the constraint; produce a **read-only** reclaim plan (idle sessions, completed planners, stale pilots, duplicate test processes, estimated reclaim, confidence, protected active sessions) — never auto-kill/delete in V0 |
| `EMERGENCY` | < 1.5 GB | Fail closed on new resource-heavy dispatch; prioritize durable checkpointing of active work; surface **one** consolidated Needs You only if safe recovery needs owner-approved termination/cleanup — never one Needs You per process |

These four bands are exactly what this document's own writing conditions
demonstrate: written at ~1.69 GB (`CRITICAL`), the correct response per
this table is "stop admitting new heavyweight work, replan around it" —
which is exactly what happened (design recorded, worktree/full-suite work
deferred).

## 3. Generic integration contract (the requested handoff)

A `TSF_RESOURCE_PRESSURE_STATE_V0` a caller can read, shaped to compose
directly with the existing Resource Auditor V0 primitives
(`RESOURCE_CLASSIFICATIONS`, `applyProductionTrustBoundary`) rather than
inventing a second one:

```
{
  schemaVersion: 'TSF_RESOURCE_PRESSURE_STATE_V0',
  observedAt: <ISO8601>,
  evidenceSource: 'TSF_OS_MODULE' | 'ORCA_NATIVE_COLLECTOR',  // honest,
    // never claims ORCA_NATIVE_COLLECTOR until the bridge exists
  hostMemory: { totalBytes, freeBytes, availableBytes, usedPercent },
  tier: 'HEALTHY' | 'PRESSURED' | 'CRITICAL' | 'EMERGENCY',
  admission: {
    newFullSuiteTests: 'ADMIT' | 'DELAY' | 'REFUSE',
    newBrowserPilots: 'ADMIT' | 'DELAY' | 'REFUSE',
    newResearchWorkers: 'ADMIT' | 'DELAY' | 'REFUSE',
    reason: <string>
  },
  protectedProcesses: [ { ownerMission, kind, reason } ],  // e.g. active
    // Dataset Research / NWR / Web Acquisition missions -- never proposed
    // for reclaim regardless of tier
  reclaimCandidates: [ {
    kind: 'COMPLETED_PLANNER_SESSION' | 'STALE_PILOT_SERVER' | 'DUPLICATE_TEST_PROCESS',
    ownerMission, createdAt, lastActiveAt,
    estimatedReclaimBytes, confidence: 'HIGH'|'MEDIUM'|'LOW'
  } ],  // EMPTY today -- populating this list truthfully requires the
    // ORCA_CORE_GAP bridge (§1); until then this array is always [],
    // never fabricated
  missionsWaitingForResources: [ { missionId, waitingSince, blockedOn } ]
}
```

Honesty constraint carried forward from the Resource Auditor review's own
production trust boundary: **`reclaimCandidates` must stay empty and
`evidenceSource` must stay `'TSF_OS_MODULE'`** until the Orca-core bridge
in §1 is built and authorized — a caller must never be told a specific
session/process is reclaimable based on evidence TSF cannot actually
verify from outside Orca's main process. This is the same fail-closed
discipline `resource-auditor.mjs`'s classifier already enforces for
`DISPOSABLE_CANDIDATE`, applied to a new evidence dimension.

## 4. Session/worker/pilot lifecycle (design only, not built)

- **Planner lifecycle**: `ACTIVE → checkpoint → successor claims lease →
  RETIRED → eligible for safe closure`. Maps directly onto the existing,
  real `plannerSessions`/session-affinity binding
  (`domain/session-affinity.mjs`, confirmed real and wired in the
  Zero-Relay reconciliation) — a `RETIRED` state is a new value on an
  already-durable record, not a new store. Closing a retired planner
  process is explicitly **not** equivalent to deleting its worktree —
  worktree/repository state is untouched by this lifecycle.
- **Worker/pilot/test-process ownership**: every TSF-launched process
  needs an ownership record (owner mission, kind, PID/process tree,
  created time, active-testing state, safe-to-close state) — this does
  not exist as a generic concept anywhere in TSF today (confirmed:
  `grep`-checked, no such registry found); a real gap, not yet built.
- **Full-suite test scheduling**: a lease/reservation so two HQs don't
  unknowingly run large suites simultaneously under low memory — directly
  motivated by this exact session's own repeated experience today
  (multiple full-suite runs across different worktrees competing for the
  same host RAM). Not built; the concept is recorded here for whoever
  implements it.

## 5. V0 boundary (unchanged, reinforced)

Everything in §2–§3 that is actually buildable today (host-tier
classification, admission recommendation, `WAITING_FOR_RESOURCES`
surfacing, the always-empty-until-bridged `reclaimCandidates` shape) stays
strictly read-only and non-destructive, extending — not weakening — the
Resource Auditor V0 boundary already reviewed
(`tsf/ORCA_RESOURCE_AUDITOR_V0_MAIN_TSF_REVIEW.md`). Automatic process
retirement/termination is V1, explicitly not attempted here.

## 6. Status and next step

**Superseded by implementation.** §2's host-tier classifier, admission
policy, and the heavy-task lease from §4 are now built — see
`tsf-resource-pressure-governor-v0` (branched from this commit,
`fec9bf3275`, per this doc's own base) and
`tsf/docs/tsf/TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md` for the full record.
Built as its own standalone module rather than inside
`resource-auditor.mjs`'s worktree as originally suggested here, because
`ORCA_RESOURCE_AUDITOR_V0`'s code had not actually landed on this base at
implementation time (only its Main TSF review doc had) — the host-tier
classifier has no runtime dependency on that module, so no coupling was
lost. The Orca-core bridge proposal for `reclaimCandidates`/session
attribution remains exactly as deferred here — not built, not duplicated,
still gated on separate authorization.
