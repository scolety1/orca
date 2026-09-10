# TSF docs (active) — index

This is where **current and ongoing** TSF documentation lives: later
programs, overnight missions, active specs referenced directly from
source code, and adoption receipts. For the original foundation
architecture and the `M2`–`M14` build-out milestones, see the
historical corpus at [`docs/tsf/`](../../../docs/tsf/) (repo root,
outside `tsf/`) — its own `INDEX.md` explains why the two locations
exist.

## Start here

- **[`TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2_FINAL_REPORT.md`](TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2_FINAL_REPORT.md)**
  — the current, actively-maintained status of the control-plane
  hardening mission: every real finding found/fixed, current stability
  state, and next-highest-value work. The single best "what's actually
  going on right now" document in this repo.

## Active specs (referenced directly from source code)

These describe subsystems that exist in the current codebase — read
them alongside the code, not as history:

- [`TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md`](TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md) — `domain/resource-pressure-governor.mjs`
- [`TSF_RESOURCE_AUDITOR_V0.md`](TSF_RESOURCE_AUDITOR_V0.md) — `domain/resource-auditor.mjs`
- [`TSF_SAFE_UPDATE_MANAGER_V1.md`](TSF_SAFE_UPDATE_MANAGER_V1.md)
- [`ORCA_CORE_NOTIFICATION_BRIDGE_REQUIREMENT_PACKET.md`](ORCA_CORE_NOTIFICATION_BRIDGE_REQUIREMENT_PACKET.md)
- [`TSF_KEEP_GOING_AUTONOMY_V1.md`](TSF_KEEP_GOING_AUTONOMY_V1.md) — the autonomous dispatch loop
- [`WEB_TABLE_SOURCE_ADAPTER_V0_5.md`](WEB_TABLE_SOURCE_ADAPTER_V0_5.md)
- [`DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`](DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md) — active backlog for the Dataset Research surface (see `tsf/feature/dataset-research-engine-v0`, unmerged)

`TSF_USER_INTERACTION_REGRESSION_CORPUS_V1.json` is data, not a doc —
the real regression corpus `test/user-interaction-regression-corpus.test.mjs`
runs against.

## Program checkpoints & final reports

Each numbered program usually has a `_CHECKPOINT.md` (in-progress
state) and sometimes a superseding `_FINAL_REPORT.md`/`_RECONCILIATION.md`
— where both exist, read the final one:

- Fleet Dispatch Readiness + Codex Throughput: [checkpoint](FLEET_DISPATCH_READINESS_CODEX_THROUGHPUT_OVERNIGHT_V1_CHECKPOINT.md) → [**final report**](FLEET_DISPATCH_READINESS_CODEX_THROUGHPUT_OVERNIGHT_V1_FINAL_REPORT.md)
- Dataset Research Engine V0: [**final reconciliation**](DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md)
- Native Self-Improvement Loop: [checkpoint](NATIVE_SELF_IMPROVEMENT_LOOP_V1_CHECKPOINT.md), [controlled live pilot checkpoint](NATIVE_SELF_IMPROVEMENT_CONTROLLED_LIVE_PILOT_V1_CHECKPOINT.md)
- Multi-Project Command Orchestration: [checkpoint](MULTI_PROJECT_COMMAND_ORCHESTRATION_OVERNIGHT_V1_CHECKPOINT.md)
- Operator Attention + Proactive Notifications: [checkpoint](OPERATOR_ATTENTION_NOTIFICATIONS_V1_CHECKPOINT.md)
- Operator Polish / Tech-Debt Closeout: [checkpoint](OPERATOR_POLISH_TECH_DEBT_CLOSEOUT_V1_CHECKPOINT.md)
- Autonomous Reliability Hardening: [checkpoint](AUTONOMOUS_RELIABILITY_HARDENING_OVERNIGHT_V1_CHECKPOINT.md)
- Autonomous Post-Cleanup Upgrade: [checkpoint](AUTONOMOUS_POST_CLEANUP_UPGRADE_PROGRAM_V1_CHECKPOINT.md)
- Zero Babysitting Productization: [report](ZERO_BABYSITTING_PRODUCTIZATION_V1_REPORT.md)
- Real Fleet Throughput / Codex Utilization: [report](REAL_FLEET_THROUGHPUT_CODEX_UTILIZATION_V1_REPORT.md)
- Cross-Provider Research Worker: [reconciliation V2](CROSS_PROVIDER_RESEARCH_WORKER_RECONCILIATION_V2.md)
- Planner Context Lifecycle: [reconciliation](PLANNER_CONTEXT_LIFECYCLE_RECONCILIATION.md)
- Zero-Relay Resource-Aware Candidate Freeze: [design](ZERO_RELAY_RESOURCE_AWARE_CANDIDATE_FREEZE.md)
- Astra Larger Benchmark V2: [design](ASTRA_LARGER_BENCHMARK_V2_DESIGN.md)
- Hands-On Round 3 Research Continuity: [report](HANDS_ON_ROUND3_RESEARCH_CONTINUITY.md)

## `adoption-receipts/`

Real, durable receipts recorded when a candidate is actually adopted —
evidence, not documentation prose. Do not delete or edit these by hand.
