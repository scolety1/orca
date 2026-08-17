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
