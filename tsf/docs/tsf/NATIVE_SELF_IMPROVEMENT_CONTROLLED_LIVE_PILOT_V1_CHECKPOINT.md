# TSF — Native Self-Improvement Controlled Live Pilot V1 — Durable Checkpoint

Owner directive: run the first controlled live pilot of the just-completed
Native Self-Improvement Loop V1 against genuine, naturally-occurring TSF
platform findings (not the disposable golden-proof fixture), with
autonomous adoption kept firmly disabled throughout.

## Baseline (pilot start)

- Canonical `tsf/main` SHA: `51a8d2b2162a8628c83bf8f3286f9d8301f63ac2`
  (includes the fully adopted Native Self-Improvement Loop V1 -- Waves
  A-D, real golden proof GREEN, adoption gate closed, autonomous-driver
  flag never persisted)
- Fork checkpoint (`fork/tsf/main`): matches exactly
- Working tree: clean
- Worktrees at pilot start: only `dataset-research-engine-v0` (held,
  untouched)
- Free memory at pilot start: ~1.67GB / 15.85GB

## Explicit, direct, present-tense human authorization for this pilot

The user sent "TSF — NATIVE SELF-IMPROVEMENT CONTROLLED LIVE PILOT V1"
directly in the live conversation, immediately after being shown Wave D's
real golden-proof GREEN result. This is genuine authorization for running
the native loop against real findings -- explicitly bounded: adoption gate
stays CLOSED, Cleanup V1 real authority stays DISABLED, no NWR, no deploy,
no new spend, eligibility policy not to be weakened, real repair-mission
count not to be inflated for volume's own sake.

## Hard constraints (verbatim, must be preserved)

Adoption gate = CLOSED. Cleanup V1 real destructive authority = DISABLED.
Unbounded self-modification = FORBIDDEN. NWR = out of scope. No deploy. No
new spend. Do not weaken eligibility merely because few findings qualify.
Do not inject fake bugs merely to create work. Do not manually override
the classifier merely to increase pilot volume. Do not manually start
child repair missions (the native loop's own real polling/eligibility/
origination logic must be what does this). Do not optimize for number of
fixes -- a small number of clean repairs is better than autonomous
busywork. Do not broaden eligible finding classes. Any authority escape
found during Phase 7's live security re-review is P0 -- stop autonomous
origination until fixed.

## Explicit resource bound (coordinator's own addition, not weakening the mission)

Each real repair-mission origination costs a real, bounded, subscription-
covered LLM-CLI dispatch (observed 20-40 min wall-clock in Wave D's own
golden proof). Cap real repair-mission origination at a small number this
pilot (recommend 2-3) even if more findings are eligible -- report the
full eligible set honestly, but stop originating live missions once the
cap is reached, and say so explicitly rather than letting the pilot run
unbounded.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 (Live Finding Intake) | DONE | Real bounded sweep, 195/195 tests pass, 0 real findings |
| 2 (Automatic Eligibility) | DONE (vacuous) | 0 findings to classify -- honest, valid outcome |
| 3 (Real Zero-Relay Repair) | DONE (vacuous) | 0 AUTO_FIX_ELIGIBLE findings -- no mission originated, cap of 2 not needed |
| 4 (Adoption Remains Closed) | DONE | Gate confirmed closed (grep-verified, unchanged) |
| 5 (Failure Behavior) | DONE (vacuous) | No dispatch occurred, so no failure path exercised |
| 6 (Pilot Quality Metrics) | DONE | See below |
| 7 (Security Review) | DONE | No live dispatch occurred; static properties re-confirmed unchanged |
| 8 (Operator Experience) | DONE | Built `command-self-improvement-bridge.mjs` (real gap found: Command had no way to answer any of the 6 named questions) |
| 9 (Pilot Verdict) | DONE | See report |

## Phase 1: real live detector sweep (executed directly by the coordinator, not delegated)

Ran the actual canonical detector test suites in the pilot worktree
(`node --test`, sequential, memory checked before/after each batch:
~2.5-3.3GB free throughout, HEALTHY/PRESSURED tier, no CRITICAL reading
observed). No fixture was injected; no test was modified before running
it.

| Detector class | Files run | Real tests | Pass | Fail |
|---|---|---|---|---|
| TSF_PLATFORM_GOLDEN_PATH_EVAL | platform-golden-path-eval-runner.test.mjs | 3 | 3 | 0 |
| TSF_RESEARCH_GOLDEN_PATH_EVAL | research-golden-path-eval-runner.test.mjs | 3 | 3 | 0 |
| UI Dogfood | ui-dogfood-contract/-finding/-surface-catalog.test.mjs | 27 | 27 | 0 |
| Command dogfood | command-dogfood-bridge/-sequences.test.mjs | 16 | 16 | 0 |
| Resource Pressure Governor | http-resource-pressure-governor/resource-pressure-collector/-governor/-lease-host-wide.test.mjs | 46 | 46 | 0 |
| Durability/restart + resource interaction | golden-path-operator-flow/research-cost-governance-restart-survival/research-resource-pressure-interaction.test.mjs | 11 | 11 | 0 |
| Command authority/adversarial | command-adversarial-corpus/-authority-regression-matrix.test.mjs | 65 | 65 | 0 |
| Self-improvement authority envelope + self-repair authority | self-improvement-authority-envelope.test.mjs, self-repair-authority.test.mjs | 13 | 13 | 0 |
| HTTP command authority e2e | http-command-authority-e2e.test.mjs | 3 | 3 | 0 |
| Security health | security-health.test.mjs | 8 | 8 | 0 |
| **Total** | | **195** | **195** | **0** |

Zero real findings emerged. This is treated as a valid, honest outcome
(explicitly allowed by the mission brief), not a shortfall to compensate
for by loosening scope or inventing a finding. The bounded sweep does NOT
cover every existing test in the repo (thousands of tests, many
platform-development-in-progress rather than reflecting a shipped
capability) -- it covers exactly the canonical detector classes the
mission named.

## Phase 8: real operator-experience gap found and closed

Checked whether Command could currently answer the 6 named questions
("What did TSF find?", "What is it fixing?", "What fixed itself
successfully?", "What is ready for adoption?", "Why wasn't this
auto-fixed?", "What failed verification?") from real durable truth.
Grepped `tsf/server/` for any existing self-improvement-aware Command
bridge -- none existed; `command-responder.mjs` never imported
`self-improvement-finding-store.mjs` at all. This is a real, genuine gap,
not a hypothetical.

Built ONE small, bounded, read-only bridge
(`tsf/server/command-self-improvement-bridge.mjs`), mirroring
`command-dogfood-bridge.mjs`/`command-research-bridge.mjs`'s own shape
exactly (classify -> respond, deps-injectable `readAllFindings` for
tests, wired into `command-responder.mjs` at the same early layer as the
other two message-shaped bridges, checked ahead of project-fleet intent
classification). It never mutates a finding, never sets
`TSF_SELF_IMPROVEMENT_LOOP_ENABLED`, and has no adoption authority --
purely a reader over the existing durable store. Distinguishes "why
wasn't this auto-fixed" (eligibility-level `NEEDS_OWNER`, transition
reason `AUTOFIX_ELIGIBILITY_CLASSIFIED`) from "what failed verification"
(retry-budget-exhausted `NEEDS_OWNER`, transition reason
`REPAIR_RETRY_BUDGET_EXCEEDED`) using the finding contract's own real
transition history -- not a guess.

New test file `tsf/test/command-self-improvement-bridge.test.mjs` (6
tests, built with real `createFinding`/`transitionFinding`/
`applyAutofixEligibility` fixtures, never hand-typed finding objects) --
6/6 pass. Full regression: `command-responder.test.mjs` (30/30),
`command-dogfood-bridge.test.mjs` + `command-dogfood-sequences.test.mjs`
(16/16), `command-research-bridge.test.mjs` (25/25) -- all still pass after
the shared-file (`command-responder.mjs`) edit. `npx oxlint` on all 3
touched/new files: 2 real `unicorn(prefer-at)` findings, fixed
(`.transitions[i]` -> `.transitions.at(-1)`), then clean.

## Phase 6: pilot quality metrics (real)

- Real findings detected: 0
- Real findings verified: 0 (nothing to verify)
- False positives: 0
- AUTO_FIX_ELIGIBLE: 0
- NEEDS_OWNER: 0
- Repair missions originated: 0 (cap was 2; not reached because 0 findings were eligible)
- Successful fixes: 0
- Verifier rejections: 0
- Redogfood resolved/reopened: 0/0
- Regressions introduced by this pilot's own Phase 8 work: 0 (full regression sweep above)
- Duplicate dispatches: 0 (none dispatched)
- Resource waits: 0 (memory stayed HEALTHY/PRESSURED throughout, 2.5-3.3GB free)
- Worker failures: 0 (no worker dispatched)
- Avg repair scope: n/a
- Unnecessary changes: 0 (Phase 8's own diff is 3 files, additive only, no touched production logic beyond the new import + routing block)
- Provider usage: 0 real LLM-CLI dispatches this pilot (detector sweep uses only deterministic/stubbed paths, same convention the canonical tests themselves already use)

## Phase 7: live security re-review

No live repair-mission dispatch occurred (0 eligible findings), so most
of the 9 named properties have nothing new to exercise this run. Re-
confirmed unchanged/still true by inspection: `TSF_SELF_IMPROVEMENT_LOOP_ENABLED`
was not set anywhere (grep-verified, including this pilot's own new
files); the adoption-authorization marker string
(`OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1`) does not appear
anywhere in this pilot's diff; the new Command bridge is read-only (no
write path into `self-improvement-finding-store.mjs`, no import of
`self-improvement-fleet-driver.mjs`/`-worker-dispatch.mjs`/`-adoption.mjs`);
no NWR path touched; no Cleanup V1 path touched. No P0 found.

## Next intended action

None remaining for this pilot beyond writing and delivering the final
`TSF_NATIVE_SELF_IMPROVEMENT_CONTROLLED_LIVE_PILOT_V1_REPORT`, adopting
this worktree's Phase 8 change into canonical `tsf/main`, and reporting
the recommended next authority level to the user.
