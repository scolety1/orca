# Current Health and Compatibility Report

## Foundation

- Orca baseline: `v1.4.184` / `2307f2ebbe1c1e737c0b12d920bb0a208332db2c`
- Upstream ancestry: required and checked by `tsf/health/foundation-health.mjs`
- Orca core files modified: 0
- Overlay roots: `tsf/`, `docs/tsf/`
- Plugin API: v1, experimental, contract-tested
- Plugin capabilities: bounded `workspace:read`, private `storage`, `events:subscribe`
- Dangerous provider bypass in TSF profiles: prohibited by tests
- Real project work: first bounded pilot authorized; one real source repository registered read-only and one isolated Upgrade candidate completed

## Implemented Health facts

The TSF Health projection can report repository availability, worktree health, stuck worker, stale session, test failure, provider unavailability, blocked Upgrade, unresolved human decision, upstream drift and overlay compatibility. Findings are advisory and never authorize remediation.

## Known limitations

- Plugin API v1 does not publicly expose all Run/task/dispatch state required for a complete in-panel control plane.
- Claude Code availability and cross-provider planner/worker reversal are not proven in this successor.
- Orca-native browser snapshot, click/select/fill, offline failure, reload persistence, console inspection, and desktop/mobile viewport checks are proven on the first real-project candidate.
- Provider cache/rate/reset telemetry remains unknown unless observed.
- High Assurance runtime is reserved and not implemented.
- Windows long-path, alternate-owner, Unicode/CRLF and crash-fault corpus remains a later wave.
- One real project has been registered for the bounded pilot. Its accepted source checkout remained clean and unchanged; all mutation stayed in Orca worktrees.
- Native runtime discovery, task/dispatch, worker completion, restart recovery, and browser attachment are GREEN when the installed production CLI and canonical `ORCA_USER_DATA_PATH` are used.
- Compact capsule schema validation does not yet prove that `repository.tree` belongs to `repository.head`; the first real pilot exposed this semantic admission gap.

## Final checkpoint evidence

- TSF overlay Node tests: 16 passed, 0 failed.
- Orca upstream plugin manifest/host/storage tests: 18 passed, 0 failed across 3 files.
- Successor manifest validation through Orca's real plugin parser: 1 passed, 0 failed.
- Foundation Health: PASS; 111 unique capability IDs; zero uncovered dispositions.
- Deterministic overlay dogfood: GREEN; two work items, two results, independent GREEN verifier, exact fixture adoption, four valid receipts.
- Stable and Published: unchanged by worker completion and local fixture adoption.
- Direct legacy reuse hashes: both byte-for-byte matches verified.
- `git diff --check`: clean.
- Successor worktree: clean after four local milestone commits.
- First real-project candidate: 41/41 serialized tests, lint, typecheck, build, independent verifier, and Orca-native browser QA GREEN.
- Stable real-project source remained unchanged at `6b8790bedfd56c0c75e71e9edef14e475f3211c3`; Upgrade `50f9ce1fc5a462e168b1490391a02aa44ea63690` is `READY_FOR_ADOPTION`.

## Readiness

The first carefully bounded real-project pilot is GREEN and stopped at Tim's adoption gate. Broader rollout should wait for Tim's decision on the exact candidate and should add semantic head-to-tree capsule validation, reusable project-profile discovery, and a first-class adoption review surface.
