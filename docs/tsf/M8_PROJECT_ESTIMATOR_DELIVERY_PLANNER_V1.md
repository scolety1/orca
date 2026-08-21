# M8: Project Estimator + Delivery Planner — Wave 1 Research

Tim's own message (recorded verbatim in
`docs/tsf/M8_PROJECT_ESTIMATOR_DELIVERY_PLANNER_HANDOFF_V1.md`) already
completed the external source-harvest research — this doc does NOT
repeat that. This is the research-first pass over TSF's own existing
code, per the same discipline validated across M4-M7, before writing
any M8 implementation.

## What already exists (read directly from source, not assumed)

1. **No existing estimation/scheduling/WBS engine anywhere.** Searched
   `tsf/domain`, `tsf/contracts`, `tsf/server` for
   estimate/effort/duration/deadline/percentile/Monte Carlo — every hit
   was incidental (a lock-timeout comment mentioning "duration", a
   provider-role field literally named `effortClass`). M8's original
   `"gaps": ["everything -- not started"]` stub was accurate.

2. **`tsf/domain/routing.mjs`'s role system is the real, existing
   "provider role hint" concept** Tim's own WBS field spec names:
   `TSF_EXECUTION_ROLES` (`PLANNER_DEEP`/`PLANNER_BALANCED`/
   `WORKER_CHEAP`/`WORKER_BALANCED`/`WORKER_DEEP`/`VERIFIER_INDEPENDENT`)
   and `resolveRole`'s `effortClass` (a provider-model-tier
   classification, e.g. cheap/balanced/deep) — **not** task-level work
   effort, but the exact vocabulary a WBS task's own "provider role
   hint" field should reference, so a task can say "this needs
   WORKER_DEEP" without inventing a second role taxonomy.

3. **`tsf/domain/capacity-policy.mjs` (M5, adopted)** is the real,
   existing provider-capacity/cost-signal policy Tim's spec explicitly
   requires M8 to reuse rather than reimplement
   ("M8 must consume the already-adopted M5 Capacity/Expiry/Cost-Aware
   Routing data. Do not implement another provider-capacity system.").
   `decideCapacityAction`'s `PROCEED`/`DOWNGRADE_WORKER`/
   `REDUCE_CONCURRENCY`/`PAUSE_AND_CHECKPOINT` actions and its
   `assurance: 'OBSERVED'|'UNKNOWN'` honesty discipline are the direct
   precedent M8's own provider-forecast wave (wave 3) should extend, not
   duplicate.

4. **`tsf/domain/keep-going.mjs`'s run/wave history (M2/M4)** is the
   real, existing settled-run evidence Tim's calibration wave (wave 6)
   needs: `run.waves[].waveResult.outcomes`, checkpoints, and
   `recentCheckpointTrail` already durably record what actually
   happened per wave. No new "actuals" storage needed there either —
   confirmed by reading M4's own already-adopted design.

5. **`tsf/domain/project-memory.mjs` (M7, just adopted)** provides
   Facts/Preferences/Experiences — Tim's own spec is explicit that
   "deterministic calibration should live in appropriate estimator/run
   data rather than arbitrary memory prose," so M7's memory system is
   NOT the calibration data source; it may still hold qualitative
   lessons ("this integration is slow") as EXPERIENCE records feeding a
   WBS's own assumptions, distinct from the numeric calibration this
   milestone's wave 6 will build.

## Real, remaining gap (confirmed, matching M8's original stub)

Everything computational — the WBS contract, three-point-estimate
normalization, the seeded Monte Carlo engine, percentile outputs,
deadline-probability calculation — needs to be built from scratch as a
new, pure, deterministic domain module. This is genuinely additive work,
not a false gap.

## Wave 1 scope decision

Following Tim's own proposed wave 1 ("Contracts + pure deterministic
estimation engine: WBS normalization, three-point estimates, seeded
Monte Carlo, percentiles, deadline probability, tests"), implemented as
this program's own **wave 2** (wave 1 being this research pass, matching
the established M2-M7 numbering convention where wave 1 is always
research-only).

Scope for wave 2, deliberately bounded:
- `tsf/contracts/project-estimate.schema.v1.json`
  (`TSF_PROJECT_ESTIMATE_V1`) — WBS task shape (id, title, stage/epic,
  category, dependencies, min/expected/max effort, clarity, confidence,
  risk, provider role hint, human review range, external wait range,
  assumptions, evidence, blockers, direct-cost items) and the overall
  estimate result shape (percentiles, deadline probability, per-clock
  breakdown).
- `tsf/domain/estimation.mjs` (pure, no I/O): WBS validation/
  normalization; a three-point-to-distribution mapper (clarity/
  confidence-weighted, per Tim's own EstimatorX-harvested concept); a
  deterministic-seeded Monte Carlo simulator (10,000+ runs, per Tim's
  own spec); percentile extraction (P10/P50/P80/P95); deadline-hit
  probability given a target date; the three distinct clocks (active
  engineering effort, human/operator effort, wall-clock delivery) kept
  as separate distributions throughout, never collapsed into one
  number.
- Real tests: same fixed input + seed produces byte-identical output
  (Tim's own #1 acceptance requirement); percentile monotonicity
  (P10 ≤ P50 ≤ P80 ≤ P95); deadline probability sanity (an impossible
  deadline yields near-0%, a generous one near-100%); the three clocks
  never conflated.

Explicitly NOT in wave 2's scope (later waves, per Tim's own sequence):
planner WBS integration (wave 3), provider/cost forecasting (wave 4),
delivery scheduling (wave 5), UI (wave 6), calibration (wave 7),
adversarial real proof (wave 8) — renumbered by one throughout to
account for this research wave being wave 1.
