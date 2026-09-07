# TSF — Autonomous Reliability + Operator Experience Hardening Overnight V1 — Durable Checkpoint

Owner directive: "AUTONOMOUS RELIABILITY + OPERATOR EXPERIENCE HARDENING
OVERNIGHT V1" (ZERO TIM RELAY). This file is the durable memory of record
for this program — updated after every adopted fix/checkpoint, not just
held in chat.

## Baseline (program start)

- Canonical `tsf/main` SHA: `46682022e7e8ef69f5380bbbcd474756bcfe1569`
  (includes the just-completed Autonomous Post-Cleanup Upgrade Program V1
  and the Cross-Provider Research Worker Reconciliation V2)
- Fork checkpoint (`fork/tsf/main`): matches exactly
- Working tree: clean
- Active TSF subagents at program start: none (`ListAgents` — only
  interactive NWR sessions and offline Remote-Control peers)
- Worktrees at program start: only `dataset-research-engine-v0` (held,
  `NWR_HISTORICAL_EVIDENCE_PRESERVATION_HOLD`, untouched by this program
  per hard project isolation)
- Free memory at program start: ~2.34GB / 15.85GB
- Provider capabilities (`provider-capabilities.v1.json`, observed
  2026-08-17, advisory-only): Codex `AVAILABLE`/subscription-backed;
  Claude-code `UNAVAILABLE_ON_VALIDATION_HOST` as a launch profile on
  this host (the live Claude session directing this program is unrelated
  to that launch-profile status)
- Known pre-existing bug/requirement filings found at program start:
  `tsf/programs/tsf-operator-stabilization-v1/bug-ledger.json`,
  `tsf/docs/tsf/DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`
  (already fully reconciled in the prior program)

## Hard project isolation (verbatim, must be preserved)

Do not modify NWR model code, datasets, validation, historical research,
active candidates, or holdouts, or any other project repository. The 2025
NWR sealed holdout is completely out of scope. Inspect project state only
where necessary to prove generic TSF orchestration behavior. Use
disposable TSF pilot projects/fixtures wherever possible.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. Post-Upgrade Gap Reconciliation | IN_PROGRESS | Audit agent dispatched |
| 2-17 | NOT_STARTED | Ranked and sequenced after Phase 1's gap matrix |

## TSF_POST_UPGRADE_GAP_MATRIX

(populated once Phase 1's audit agent reports)

## Adopted SHAs

(none yet this program)

## Owner Gates Outstanding

(carried forward from the prior program, not this program's to clear
unless a concrete dependency is discovered)
1. NWR preservation remediation (push `dataset-research-engine-v0` to a
   durable remote; preserve 57 unique + resolve 29 uncertain artifacts)
2. Cleanup V1 real activation gate (deliberately never set)
3. Phase 3's 3D real authenticated-download bridge (product/UI decision)
4. Astra: still unavailable/unproven — not to be added based on
   speculation, per this program's own explicit instruction

## Next intended action

Await Phase 1 gap-audit agent's report, then rank findings and begin
the AUDIT → RANK → REPRODUCE → FIX → TEST → REVIEW → DOGFOOD → ADOPT →
CHECKPOINT → CONTINUE loop.
