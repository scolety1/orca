# Zero-Relay Resource-Aware Unified Candidate — freeze record

**Status:** `ZERO_RELAY_RESOURCE_AWARE_UNIFIED_CANDIDATE_READY_FOR_TIM`, frozen
by explicit instruction.

**Frozen exactly at:** `c2074e8e57f07ee5f1b6aad83749d6bf2915c35e`
**Worktree:** `tsf-zero-relay-resource-aware-candidate-v1`

This commit is never amended, rebased, or advanced. This record lives on
the ongoing `tsf-overnight-platform-v1` development lineage instead —
committing it there, not to the frozen branch, is what keeps the frozen
SHA exactly where it is while still durably recording the freeze and its
known debt.

## What this candidate preserves (verified, not assumed)

- Command V1 (frozen functional candidate `16c8b7e530`, confirmed a real,
  untouched ancestor of this HEAD via `git merge-base --is-ancestor`).
- Resource Pressure Governor V0, including the universal dispatch-loop
  admission gate (every real heavyweight-worker dispatch caller, not just
  chat) and the ESCALATE-priority fix.
- Host-wide heavyweight leases (`resource-pressure-lease-store.mjs`),
  adversarially verified: cross-kind independence, real-crash TTL
  self-heal, corrupt-file fail-closed, genuine two-process race, real
  restart-resume.
- ResearchMission Autonomy Driver V0, including the zero-relay
  correction/retry behavior (bad evidence → independent verification →
  automatic redispatch to an independent provider) and restart/resume
  behavior (a fresh driver call resumes correctly with no duplicate
  dispatch, since the driver holds no in-memory state of its own).
- Zero Orca-core delta (`foundation-health.mjs`: `upstreamCoreDeltaCount: 0`,
  `status: PASS` at this exact HEAD).
- Zero NWR delta (structural — no NWR repository content exists in this
  repo).

## Current debt — recorded here, NOT implemented in this pass

1. **`HEALTH_REPAIR_SECURITY_SCANNER_RESOURCE_ADMISSION`** — `health-repair.mjs`'s
   `runBaselineVerification` (real npm test/build/lint execution) and
   `security-scanner-adapter.mjs` (real external scanner spawn, up to
   120s) are genuinely heavyweight but operator-triggered, not
   autonomous/unattended — a different risk profile than the two
   self-ticking loops (Keep Going, Research) already gated. Not yet
   wired to the Resource Pressure Governor's admission check.
2. **`RESEARCH_NODE_STALL_TIMEOUT`** — a research node stuck in
   `DISPATCHED` (a provider that never returns a terminal result) polls
   forever; there is no stall/timeout mechanism anywhere in the
   research-mission domain analogous to Keep Going's
   `TICK_LOCK_TIMEOUT_MS`-style stall detection. Pre-existing, not
   introduced by this candidate's own work.
3. **`PLANNER_CONTEXT_LIFECYCLE` / `AUTOMATIC_SESSION_ROLLOVER`** — see
   `PLANNER_CONTEXT_LIFECYCLE_RECONCILIATION.md` for the read-only
   reconciliation already on record. **Classified as the next major Main
   TSF platform phase** (see below), not incidental debt.

## Next Main TSF platform phase

**`PLANNER_CONTEXT_LIFECYCLE_V0`** — contingent on Tim's hands-on pilot of
this frozen candidate passing. Built in a new isolated worktree branched
from this verified candidate lineage (this commit, or later on this same
`tsf-overnight-platform-v1` line if further verified work lands first) --
never inside the frozen candidate itself.

Objective: automatic planner rollover — durable checkpoint → fresh Claude
planner → continuity verification → planner lease transfer → old planner
retirement → mission continues without Tim. Reuses
`domain/session-affinity.mjs`'s existing `createSessionBinding`/
`assertAffinity`/`replaceSessionBinding` primitives and
`cross-process-file-lock.mjs` for the lease, per the prior reconciliation's
own findings — not started here.
