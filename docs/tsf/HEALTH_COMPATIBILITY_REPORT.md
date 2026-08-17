# Current Health and Compatibility Report

## Foundation

- Orca baseline: `v1.4.184` / `2307f2ebbe1c1e737c0b12d920bb0a208332db2c`
- Upstream ancestry: required and checked by `tsf/health/foundation-health.mjs`
- Orca core files modified: 0
- Overlay roots: `tsf/`, `docs/tsf/`
- Plugin API: v1, experimental, contract-tested
- Plugin capabilities: bounded `workspace:read`, private `storage`, `events:subscribe`
- Dangerous provider bypass in TSF profiles: prohibited by tests
- Real project work: prohibited for this runway

## Implemented Health facts

The TSF Health projection can report repository availability, worktree health, stuck worker, stale session, test failure, provider unavailability, blocked Upgrade, unresolved human decision, upstream drift and overlay compatibility. Findings are advisory and never authorize remediation.

## Known limitations

- Plugin API v1 does not publicly expose all Run/task/dispatch state required for a complete in-panel control plane.
- Claude Code availability and cross-provider planner/worker reversal are not proven in this successor.
- Browser snapshot/click/screenshot/console parity is not proven.
- Provider cache/rate/reset telemetry remains unknown unless observed.
- High Assurance runtime is reserved and not implemented.
- Windows long-path, alternate-owner, Unicode/CRLF and crash-fault corpus remains a later wave.
- No real project has been registered or accessed.
- Native dogfood runtime discovery is blocked: the headless server reached ready state, but the production CLI remained on a stale bootstrap and could not attach.

## Readiness

The foundation is suitable for continued fixture integration. It is not yet ready for a real-project pilot until native Orca Run/task dispatch, restart recovery, browser verification, and the first bounded Windows reliability subset are GREEN.
