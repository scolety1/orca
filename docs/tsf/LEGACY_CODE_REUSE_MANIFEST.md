# Legacy Code Reuse Manifest

## Source identity

- Legacy path: `C:\TSF_V1`
- Legacy HEAD inspected: `c702a373b39ea6b2e451788da82ed0437811dfc3`
- Archaeology baseline: `b6a79ac1e0d2441942b85cc6cac08734ae8a20a5`
- Authorization: owner-authorized local migration by Tim
- Public-license assertion: none made; copied material remains local in Tim's successor
- Legacy authority: legacy remains the reference implementation until a future parity/cutover decision

## Direct reuse

| Legacy path | Successor path | Capability IDs | Classification | Changes | Tests retained | Dependencies removed | Legacy authoritative? |
|---|---|---|---|---|---|---|---|
| `tools/interactive-hq-v1/operator-action-lifecycle.mjs` | `tsf/domain/operator-action-lifecycle.mjs` | MSN-005, AUT-008, UI-007 | `REUSE_DIRECTLY` | None; byte-for-byte copy | New successor idempotency, duplicate-pending, duplicate-success and interrupted-action tests | Interactive HQ server/UI and filesystem state | Reference for parity; successor copy is overlay implementation |
| `fleet/control/project-context-capsule.schema.v1.json` | `tsf/contracts/project-context-capsule.schema.v1.json` | CTX-005 | `REUSE_DIRECTLY` | None; byte-for-byte copy | Schema presence plus migration coverage test | PowerShell capsule writer and legacy role runtime | Reference for parity; successor schema is overlay contract |

## Adapted logic and schemas

| Legacy path | Successor path | Capability IDs | Classification | Changes made | Tests retained | Dependencies removed | Legacy authoritative? |
|---|---|---|---|---|---|---|---|
| `fleet/control/model-routing-alias-policy.v1.json` | `tsf/routing/provider-role-mappings.v1.json`; `tsf/domain/routing.mjs` | RTE-001, RTE-007 | `PORT_LOGIC_ONLY` | Replaced model-surface aliases with stable planner/worker/verifier roles and requested/observed assurance | Role completeness and configuration tests | OpenAI-only surface resolution | Reference for outcome, not successor mapping |
| `tools/project-routing/tsf-model-effort-policy-v1.json` | `tsf/routing/provider-role-mappings.v1.json`; `usage-modes.v1.json` | RTE-003, RTE-004 | `REUSE_WITH_SMALL_ADAPTATION` | Preserved cost/effort intent; added autonomy, trust mode, verifier depth, parallelism and retry budget | Routing and Usage Mode tests | Legacy dispatch scripts and model names | Reference for behavior |
| `fleet/control/mission-envelope.schema.v1.json` | `tsf/contracts/plan-capsule.schema.v1.json` | CTX-003, LEG-003 | `PORT_SCHEMA_ONLY` | Reduced to bounded decisions, exact Git/worktree identity, allowed scope, prohibitions, tests and stop conditions | Capsule positive/negative validation tests | Legacy queue, policy fingerprint and executor invocation plumbing | Reference for preservation invariants |
| `fleet/control/result-envelope.schema.v1.json` | `tsf/contracts/result-capsule.schema.v1.json` | CTX-004, MSN-007 | `PORT_SCHEMA_ONLY` | Reduced to compact worker identity, exact repository identity, tests/evidence, blockers and next step | Prose-only success rejection and dogfood result admission tests | Legacy admission/runtime packet generations | Reference for preservation invariants |
| `tools/interactive-hq-v1/daily-operator-service.mjs` | `tsf/domain/portfolio.mjs`; `release-state.mjs` | PRJ-006, PRJ-007, GIT-013, GIT-014 | `PORT_LOGIC_ONLY` | Reimplemented small domain transitions; no server, UI, queue or process code copied | Active Fleet/Work Set and release isolation tests | Interactive HQ runtime and duplicated execution plumbing | Legacy remains parity reference |
| `tools/interactive-hq-v1/health-center.mjs` | `tsf/domain/health.mjs` | HLT-001 | `REFERENCE_PATTERN_ONLY` | Actionable finding concepts mapped over Orca/Git/provider facts | Health severity and non-authority tests | Legacy process probes, caches and HQ projections | Legacy remains parity reference |

## Explicitly not ported

- Custom Codex app-server runtime and PowerShell worker launchers: `ORCA_ALREADY_BETTER`.
- Mirror execution engine, worktree ownership and process recovery: `ORCA_ALREADY_BETTER`.
- Interactive HQ server and large UI: `REJECT_LEGACY_IMPLEMENTATION`; capabilities remain in the 111-capability manifest.
- Browser runner and low-level sandbox setup: `ORCA_ALREADY_BETTER` in architecture, pending Windows parity proof.
- Research ZIP/manual transport and parked plugin catalog: `REFERENCE_PATTERN_ONLY` or `REJECT_LEGACY_IMPLEMENTATION` per the preservation ledger.

## Follow-up bounded harvest audit

This runway re-read a deliberately small set of legacy implementation files at legacy HEAD `c702a373b39ea6b2e451788da82ed0437811dfc3`. No file was copied during this follow-up and legacy TSF remained read-only.

| Legacy path | Capability outcomes inspected | Classification | Successor decision | Reason |
|---|---|---|---|---|
| `tools/interactive-hq-v1/daily-operator-service.mjs` | Work Set scoping, safe continuation recommendations, bounded batches, stale candidate invalidation | `PORT_LOGIC_ONLY` | Retain the smaller `portfolio.mjs` dispatch guard, sticky-planner continuation, and release transitions | The useful outcomes are now proven over Orca; copying the service would import queue, server, and UI coupling. |
| `tests/test-tsf-active-fleet-usage-modes-v1.mjs` | Outside-fleet denial, Work Set membership, Usage Mode defaults and fail-closed recommendations | `PORT_TEST_ONLY` | Preserve scenarios in successor domain and long-run tests, adapted to Orca dispatch facts | The assertions are valuable; their legacy harness is runtime-specific. |
| `tools/interactive-hq-v1/validation-repair-policy.mjs` | Failure classification, retry bounds, authority and stale-baseline stops | `PORT_LOGIC_ONLY` | Preserve bounded same-owner revision and stop-condition outcomes in capsules and verifier admission | The compact policy ideas remain useful, but embedded model names and legacy repair states should not become a second Orca scheduler. |
| `tools/interactive-hq-v1/local-commit-finalization.mjs` | Exact-path commit binding, clean-tree proof, idempotent receipt recovery, publication prohibition | `ORCA_ALREADY_BETTER` | Let Orca own worktree/commit mechanics; retain TSF exact adoption binding and Receipt Lite | Direct reuse would duplicate Orca Git execution and import legacy trust plumbing. |
| `tools/interactive-hq-v1/health-remediation.mjs` | Ownership-grounded remediation, exact-file scope, revalidation, idempotent receipts | `REFERENCE_PATTERN_ONLY` | Keep Health read-only/actionable in this foundation; defer mutation/remediation | The safety pattern is strong, but remediation is outside this runway and depends on legacy persistent-state internals. |

### Harvest conclusion

- Directly reused in this follow-up: **0 files**.
- Adapted/copied in this follow-up: **0 files**.
- Outcomes newly proven without legacy runtime import: Work Set dispatch gating, bounded continuation/repair, exact candidate admission, and native browser verification.
- Deferred intentionally: Health remediation and full validation failure taxonomy. Their capability IDs remain present in the 111-capability manifest.
