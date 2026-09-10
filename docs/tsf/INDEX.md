# TSF docs (historical/foundational) — index

This directory holds the **original TSF build-out record**: the
foundation architecture and the milestone-by-milestone design docs
(`M2`–`M14`) that took Thousand Sunny Fleet from concept to a working
Orca overlay. It's historical in the sense that these milestones are
done and superseded by the current codebase — not in the sense that
they're stale or wrong; several (especially the architecture docs) are
still the best available explanation of *why* the system is shaped the
way it is.

**For current/ongoing work** (later programs, overnight missions,
checkpoints, adoption receipts), see [`tsf/docs/tsf/`](../../tsf/docs/tsf/)
instead — see that directory's own `README.md` for why the split exists.

## Foundation & architecture

Read these first to understand the overall design:

- [`FOUNDATION_IDENTITY.md`](FOUNDATION_IDENTITY.md) — what TSF is, at the root
- [`TSF_OVERLAY_ARCHITECTURE.md`](TSF_OVERLAY_ARCHITECTURE.md) — how TSF layers onto Orca
- [`STATE_OWNERSHIP_MAP.md`](STATE_OWNERSHIP_MAP.md) — who owns which state
- [`PROVIDER_ROLE_REGISTRY.md`](PROVIDER_ROLE_REGISTRY.md) — provider-neutral role model
- [`LEGACY_CODE_REUSE_MANIFEST.md`](LEGACY_CODE_REUSE_MANIFEST.md) — what was reused vs. built new
- [`MIGRATION_WAVE_PLAN.md`](MIGRATION_WAVE_PLAN.md) — the original migration sequencing

## Milestones (M2–M14, chronological build-out)

- [`M2_KEEP_GOING_DESIGN_V1.md`](M2_KEEP_GOING_DESIGN_V1.md) — the Keep Going run/dispatch model
- [`M3_CHAT_DISPATCH_LIVE_WORK_FEED_V1.md`](M3_CHAT_DISPATCH_LIVE_WORK_FEED_V1.md) — chat-driven dispatch + live feed
- [`M4_RUN_JOURNAL_RECOVERY_V1.md`](M4_RUN_JOURNAL_RECOVERY_V1.md) — durable run journal / crash recovery
- [`M5_CAPACITY_AWARE_ROUTING_V1.md`](M5_CAPACITY_AWARE_ROUTING_V1.md) — capacity-aware provider routing
- [`M6_DESKTOP_TSF_V1.md`](M6_DESKTOP_TSF_V1.md) — TSF as a real Orca desktop plugin
- [`M7_PROJECT_MEMORY_V2_V1.md`](M7_PROJECT_MEMORY_V2_V1.md) — project memory v2
- [`M8_PROJECT_ESTIMATOR_DELIVERY_PLANNER_V1.md`](M8_PROJECT_ESTIMATOR_DELIVERY_PLANNER_V1.md) + [handoff](M8_PROJECT_ESTIMATOR_DELIVERY_PLANNER_HANDOFF_V1.md) — the delivery planner
- [`M9_M13_PROGRAM_EXTENSION_HANDOFF_V1.md`](M9_M13_PROGRAM_EXTENSION_HANDOFF_V1.md) — M9–M13 combined handoff
- [`M14_DESKTOP_LAUNCH_REMEDIATION_V1.md`](M14_DESKTOP_LAUNCH_REMEDIATION_V1.md) — desktop launch fixes

## Programs & pilots

- [`TSF_DAILY_DRIVER_AUTONOMY_PROGRAM_V1.md`](TSF_DAILY_DRIVER_AUTONOMY_PROGRAM_V1.md)
- [`TSF_FIRST_REAL_PROJECT_PILOT_V1.md`](TSF_FIRST_REAL_PROJECT_PILOT_V1.md), [`_SECOND_`](TSF_SECOND_REAL_PROJECT_PILOT_V1.md), [`_THIRD_`](TSF_THIRD_REAL_PROJECT_PILOT_V1.md) — the first three real-project onboarding pilots
- [`TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_RUN_V1.md`](TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_RUN_V1.md)
- [`TSF_ORCA_NATIVE_RUNTIME_BRIDGE_V1.md`](TSF_ORCA_NATIVE_RUNTIME_BRIDGE_V1.md)
- [`TSF_ORCA_OPERATOR_UI_V1.md`](TSF_ORCA_OPERATOR_UI_V1.md) — the operator UI architecture (linked from `tsf/README.md`)
- [`TSF_MOBILE_COMPANION_V1.md`](TSF_MOBILE_COMPANION_V1.md)
- [`TSF_WEIRD_TALENT_MATCHER_CAPABILITY_DESIGN_V1.md`](TSF_WEIRD_TALENT_MATCHER_CAPABILITY_DESIGN_V1.md)

## Reports & provenance

- [`DOGFOOD_REPORT.md`](DOGFOOD_REPORT.md)
- [`HEALTH_COMPATIBILITY_REPORT.md`](HEALTH_COMPATIBILITY_REPORT.md)
- [`SOURCE_HARVEST_LEDGER_V1.md`](SOURCE_HARVEST_LEDGER_V1.md)

## Why this directory is here (a real repo-hygiene note)

This directory sat outside `.gitignore`'s allow-list for a while (the
root `.gitignore` blocks new files under `docs/**` by default, with an
explicit per-directory allow-list) — every file already here was
grandfathered in before that rule existed, but any *new* file would
have silently needed `git add -f`. That's now fixed (`docs/tsf/` is
allow-listed), but it's also why newer TSF work moved to
`tsf/docs/tsf/` instead partway through the project. Both locations
are real and tracked; there was never a mandate to consolidate them,
and moving 25+ actively-linked historical files carries real risk of
breaking source-code comments that reference them by path, so they
stay where they are.
