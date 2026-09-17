# TSF Condensing V1

## Goal

Minimum owner cognitive load, with all real capability preserved. Per-surface
classification: KEEP PRIMARY / MERGE / MOVE TO ADVANCED / HIDE / DEPRECATE /
REMOVE / AMBIGUOUS -- PRESERVE.

## Headline finding: this is largely already done

A prior pass -- referenced inline as "Operator IA consolidation V1"
(`tsf/ui/src/components/AppShell.tsx:14-19`, `tsf/ui/src/App.tsx:25-32`,
`tsf/ui/src/pages/MorePage.tsx`) -- already reduced primary nav to four
destinations and explicitly, deliberately demoted five real, reachable
surfaces to Advanced. No dedicated doc existed for it before this one; this
doc is that record, plus a full audit confirming it holds up and covering
what it left open.

Method: two real, independent read-only inventory passes over every page
under `tsf/ui/src/pages`, every Project Detail tab, and every component under
`tsf/ui/src/components` (including a full orphan sweep -- grepped every
`.tsx` file under `components/` for any reference to it anywhere else in
`tsf/ui/src`), plus tracing the real backend route each Advanced page and
each Project Detail tab actually calls (`tsf/ui/src/lib/api.ts`), plus a
grep of `tsf/domain` and `tsf/server` for any fleet-wide activity/history
aggregator.

## Classification

### Primary nav (`AppShell.tsx:20-25`) -- all KEEP PRIMARY

| Surface | Route | Real content |
|---|---|---|
| HQ | `/` | The coherent operator snapshot (`api.operatorSnapshot()`); also where cross-source Needs You (PROJECT/RESEARCH/PLANNER/self-improvement) surfaces as cards -- no separate Needs You page exists, and it should not: folding it into HQ is *fewer* real destinations for the same real attention-worthy facts, not a missing feature. |
| Work | `/work` | Mission command center -- "what's happening to" the Work Set (`api.work()`). Deliberately distinct from Fleet (below): Work is the day-to-day view, Fleet is the specialized overnight-scheduling tool that happens to read the same `api.work()` data as one input among others, not a duplicate display. |
| Projects | `/projects` | The repository list; `/projects/add` (`AddProjectPage.tsx`) is the real onboarding flow, reachable from here. |
| More | `/more` | This literally *is* the mission's own "Inspect / Advanced" node -- `ADVANCED_ROUTE_PREFIXES` in `AppShell.tsx` names it "Advanced" internally. Not a second thing to reconcile against "More"; they are the same node under two names. |

Always-mounted, not nav items (by design -- global chrome, not a destination
to navigate to): `GlobalCommandDock` (Command, persistent on every screen),
`GlobalRunStatusIndicator`, `SystemStatusIndicator`, `CapacityIndicator`.

### Advanced (`MorePage.tsx`) -- all correctly MOVE TO ADVANCED already

| Surface | Route | Real content | Overlap check |
|---|---|---|---|
| Command (full page) | `/command` | Same conversation as the dock, full-width (`App.tsx`'s own comment: two mounts, one state) | Not overlap -- by design, disclosed in code. |
| Fleet | `/fleet` | Real overnight-schedule builder: concurrency/priority/capacity across the Work Set (`api.fleetSchedule`, reads `api.portfolio`/`api.work` as inputs) | Confirmed non-redundant with Work (see above). |
| Agents | `/agents` | Raw per-project agent session/worktree debug data (`api.agents` -> `AgentEvidence { sessions, worktrees, note }`) | Confirmed non-redundant with Flight Recorder: different route (`/agents/:id` vs `/projects/:id/flight-recorder`), different granularity -- raw session/worktree debug data vs. a curated timeline. |
| Evaluation | `/evaluation` | Eval-pack runs, quality-regression checks (`api.evalPacks/evalHistory/runEvalPack/evalRegressionCheck`) | No other surface reads these routes; not overlap. |
| Health Repair Center | `/health-repair` | Fleet-wide health scan + bulk repair (`api.healthRepairScan/Selected/Repair/Baseline`) | Explicitly disclosed in-product (`MorePage.tsx`) as the fleet-wide counterpart to the per-project Health tab -- intentional split, not accidental duplication. |

### Project Detail tabs (`ProjectDetailPage.tsx`) -- all KEEP PRIMARY as a group

Overview, Keep Going, Research, Health, Estimate, Flight Recorder, Adoption,
Evidence, Receipts. This is the mission's own "Project" node's real
substance -- none of these belong at top-level nav (they're already
correctly scoped one level down), and none is redundant with another:
Evidence and Receipts render two different slices (`resultCapsules` vs.
`receipts.chain`) of the *same* already-fetched `api.project()` payload --
sharing a fetch is not the same defect as showing the same fact twice from
two independently-maintained sources (the kind of overlap this mission
actually cares about); no case of that second, real kind of overlap was
found anywhere in this audit.

Planner Chat (`PlannerChatPanel`) is permanently docked below the tabs on
every Project Detail page, not a switchable tab -- also correctly scoped:
it doesn't need its own nav slot or tab slot, and adding one would be *more*
navigation for the same capability, working against this mission's own goal.

### AMBIGUOUS -- PRESERVE (real, disclosed gap, not a defect to silently fix)

**History / Recent Activity.** The mission's own target nav model names this
as a destination. It does not exist -- not as a UI surface, and not as
backend data: no fleet-wide activity feed, audit log, or timeline aggregator
exists anywhere in `tsf/domain` or `tsf/server` today (confirmed by grep;
the closest real analogs are each scoped to one project or one subsystem --
Flight Recorder per project, Evaluation's own run history per eval pack,
each Keep Going run's own `checkpoints`/`transitions` arrays). Building a
fleet-wide History page would be new capability (both a new backend
aggregator and a new UI surface), not a consolidation of something that
already exists in scattered form. Per this mission's own instruction ("the
goal is NOT fewer features for its own sake" / "reconcile actual
capabilities before changing navigation"), this is flagged as an open
product-direction question for the owner, not something to build
unilaterally under a "condensing" mandate.

### Dead/orphaned UI -- none found

Full sweep of every `.tsx` file under `tsf/ui/src/components/` (top-level
and every subdirectory) for zero references anywhere else in `tsf/ui/src`:
zero orphans found. Every built component is reachable from a real nav path.

## Conclusions

- `TSF_CONDENSING_V1_COMPLETE = YES` for the existing surface area: every
  real, reachable surface was inventoried and classified; the prior
  "Operator IA consolidation V1" pass's own choices all check out under
  this audit's own independent verification (no real overlap found, no
  orphaned UI found, every "similar-sounding" surface confirmed to read a
  genuinely distinct route or to explicitly disclose its own split).
- `NO_IMPORTANT_CAPABILITY_LOST = YES` -- nothing was removed or hidden by
  this pass; every previously-reachable surface remains reachable exactly
  as before. This pass is a verification + written record, not a
  restructuring, because the restructuring already happened and holds up.
- One open item, explicitly not resolved by this pass: whether the owner
  wants a real, new fleet-wide History/Recent Activity destination built.
  Left for an explicit owner decision.
