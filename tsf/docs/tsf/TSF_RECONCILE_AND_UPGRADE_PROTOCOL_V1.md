# TSF Reconcile & Upgrade Protocol V1

A reusable development discipline for improving TSF (or a real user
project), formalized from the pattern this project's own overnight
hardening/productization missions have already used repeatedly.

## Core philosophy

**Understand before building. Prove before trusting. Improve what
exists before replacing it.**

The most common real failure mode in an autonomous or semi-autonomous
development session is not writing bad code -- it's writing *unnecessary*
code: a second system next to a working first one, a new abstraction
duplicating an existing primitive, a "fix" for something that already
works, or a claim of completion nobody re-checked. This protocol exists
to make the alternative the default path.

## Lifecycle

```
RESEARCH -> RECONCILE -> TRACE -> CLASSIFY -> COMPARE -> PATCH -> VERIFY -> ADOPT -> DOGFOOD -> REPEAT
```

- **RESEARCH**: gather real evidence -- current code, tests, docs,
  history, prior missions. Old docs/chats/branches/plans are *evidence*,
  never *truth*; git HEAD + the durable stores are truth.
- **RECONCILE**: for the capability under review, ask "does this project
  already know how to do this somewhere?" before writing anything.
  Real outcomes include `ALREADY_SOLVED`, `PARTIALLY_SOLVED`, `MISSING`,
  `BROKEN`, `STALE`, `DUPLICATED`, `SUPERSEDED`, `UNKNOWN`.
- **TRACE**: follow the real path end to end -- owner intent -> entry
  surface -> interpretation -> domain contract -> execution -> durable
  state -> status/attention -> UI -> restart/recovery -> test coverage.
  A capability is not "done" because one backend function exists.
- **CLASSIFY**: assign a real finding class (see below) with severity,
  confidence, evidence, and a proposed patch strategy.
- **COMPARE**: only after codebase reconciliation, optionally compare
  against external prior art -- always as a *child* of a software-
  engineering mission, never as a route into an unrelated research
  mission (see "Owner triggers" below).
- **PATCH**: choose a strategy in order of preference --
  `REUSE > EXTEND > CONNECT > REPLACE > NEW`. `REPLACE`/`NEW` require
  explicit evidence that reuse/extension/connection genuinely can't work.
- **VERIFY**: proof is preregistered *before* patching (what test/eval/
  live-check will prove this), not invented afterward to match whatever
  was built. For a bug: reproduce RED, fix, confirm the SAME case GREEN.
- **ADOPT**: fast-forward integration through the project's own existing
  adoption machinery (isolated worktree, independent verifier,
  fast-forward merge, push, verify remote equality) -- never a shortcut.
- **DOGFOOD**: re-trace the real, live behavior after adoption. A merge
  is not the same as a confirmed fix.

## Finding classification

Canonical classes: `BUG`, `FUNCTIONAL_GAP`, `RELIABILITY_GAP`,
`UX_PROBLEM`, `INFORMATION_ARCHITECTURE_PROBLEM`, `PRODUCTIZATION_GAP`,
`STALE_CODE_OR_DOC`, `UPGRADE_OPPORTUNITY`, `ALREADY_SOLVED`, `NOT_A_BUG`.

**No code is a valid result.** `ALREADY_SOLVED`, `NOT_A_BUG`, and
`WORKING_AS_DESIGNED` are all first-class, successful outcomes of a
reconciliation pass -- never something to second-guess into inventing
work just to have shipped *something*.

## Durable lifecycle: reuse, don't reinvent

This protocol does **not** introduce a second findings database. A
finding produced by following it is a real
`domain/self-improvement-finding.mjs` record
(`sourceDetector: 'RECONCILE_AUDIT'`), going through the exact same
durable store, lock, transition table, adoption path, and receipt chain
every other self-improvement finding already uses. Two small, precedented
extensions were made to that existing lifecycle to make it honest for
this broader use:

| Protocol status | Maps to |
|---|---|
| FOUND | `DETECTED` |
| RECONCILED / ACCEPTED | `VERIFIED` -> `ELIGIBLE_FOR_AUTOFIX` / `NEEDS_OWNER` |
| PATCHING | `FIX_MISSION_CREATED` / `FIX_IN_PROGRESS` |
| VERIFYING | (inside `FIX_IN_PROGRESS`, the real verifier step) |
| READY_FOR_ADOPTION | `READY_FOR_ADOPTION` (identical name) |
| ADOPTED alone | *(deliberately not a distinct status -- see DONE below)* |
| LIVE_VERIFIED / DONE | `RESOLVED` (only reached via a real post-adoption redogfood pass) |
| ALREADY_SOLVED | `ALREADY_SOLVED` **(new status, added this mission)** |
| NOT_A_BUG / WORKING_AS_DESIGNED | `REJECTED_FALSE_POSITIVE` with reason `'WORKING_AS_DESIGNED'` (reused, not a new status -- see below) |
| SUPERSEDED | `REJECTED_FALSE_POSITIVE`/`ALREADY_SOLVED` with reason `'SUPERSEDED_BY:<findingId>'` |
| DEFERRED_WITH_REASON | `NEEDS_OWNER` with a specific reason |
| BLOCKED_EXTERNAL | the existing fleet-attention `BLOCKED_EXTERNAL` category (project execution holds already surface this way -- see `domain/fleet-attention-status.mjs`) |
| OWNER_DECISION_REQUIRED | `NEEDS_OWNER` (identical concept, already real) |
| DISMISSED_BY_OWNER | `DISMISSED_BY_OWNER` (already existed, prior mission) |

**Why `ALREADY_SOLVED` is a real, new status** (not reused from an
existing one): `REJECTED_FALSE_POSITIVE` means "this was never a real
defect" (the detector was wrong). `RESOLVED` means "a real defect, fixed
by THIS lifecycle's own verified patch." Neither honestly describes "the
claim was real, but something else already fixed it" -- conflating that
with either would mischaracterize the finding's own history. Legal from
`DETECTED`/`VERIFIED`/`ELIGIBLE_FOR_AUTOFIX`/`NEEDS_OWNER`/`REOPENED` (the
exact same states `REJECTED_FALSE_POSITIVE` is legal from -- they are
sibling "no fix mission needed" outcomes), terminal, never reachable once
a real fix mission is already underway.

**Why `NOT_A_BUG`/"working as designed" is NOT a new status**: it
genuinely IS the same "this finding's claim doesn't represent a real
defect" bucket `REJECTED_FALSE_POSITIVE` already occupies -- just
discovered by design-intent review rather than a detector being wrong
from the start. The distinction is carried honestly in the transition's
own `reason` field, not by growing the status enum for every nuance.

**`RECONCILE_AUDIT`** was added to `SOURCE_DETECTORS` -- a directed,
protocol-driven audit is a genuinely different kind of originator than
the 7 existing automated/mechanical detectors (an eval pack, a runtime
assertion, a dogfood scan).

## Proof: two existing engines, route correctly, never a third

- **Mechanical reproduction** (a real code defect with a runnable
  reproduction command): the existing `self-improvement-verifier-
  dispatch.mjs` / `self-improvement-redogfood.mjs` chain, unchanged.
- **Everything else** (UX, information architecture, stale docs, upgrade
  opportunities -- no mechanical reproduction command): `domain/
  evaluation-pack.mjs`'s generic, provider-agnostic assertion engine
  (`scoreAssertion`/`scoreCase`), already reused by research verification
  and every eval pack. Express the proof as `{input, assertions}` against
  real production output.

Never build a third verification engine.

## Owner triggers / planner routing

Natural-language triggers ("Research this area and upgrade it.",
"Dogfood this.", "Make this production-ready.", "Figure out what we
already have and finish it.", "Find what's weak here.", "Audit this
workflow.", "Compare this part against the best systems and improve
it.", "Fix anything objectively wrong here.") resolve as
`SOFTWARE_PRODUCT_ENGINEERING` -- a MODE of the existing software-
engineering planner, never Dataset Research, never a new top-level
orchestration runtime.

This is enforced by `domain/reconcile-upgrade-classification.mjs`
(`classifyReconcileUpgradeIntent`), wired into the existing, already-
proven `domain/parent-mission-intent-classification.mjs`'s
`shouldSuppressResearchCreation` at the **highest priority** -- ahead of
even the dataset-construction-shape check. This closes a real,
reproduced risk: several of the brief's own trigger phrases (most
notably "Research this area and upgrade it.") contain the bare word
"research" with no nearby software vocabulary, and would otherwise fall
through to the classifier's own bare `/\bresearch\b/` default and
reproduce the exact class of bug `parent-mission-intent-
classification.mjs` was originally built to prevent. Regression-tested
against all 8 literal example phrases in `test/parent-mission-intent-
classification.test.mjs`.

## DONE definition

`VERIFYING` is not DONE. `READY_FOR_ADOPTION` is not DONE. `ADOPTED`
(a real merge) alone is not necessarily DONE.

**DONE, for owner-facing behavior, means `LIVE_VERIFIED`** -- reached
only after a real post-adoption dogfood/redogfood pass confirms the
fix against the genuinely current, merged code. The existing self-
improvement lifecycle already enforces this structurally: a real git
merge (`attemptRepairAdoption`) never itself transitions a finding's
status; only a real post-merge redogfood re-check does. This protocol
inherits that guarantee for free by reusing the same lifecycle.

## No-endless-audit rule

Convergence matters. Stop a reconciliation pass when: no locally-fixable
P0/P1 remains, the accepted requirements are verified, the owner's real
flow is coherent, and remaining work is enhancement-level only. A clean,
`ALREADY_SOLVED` result is a valid, complete outcome -- never a reason to
invent work to justify the pass.

## Example: the execution-hold surfacing pilot (2026-09-12)

Target: "does a project execution hold get respected/surfaced everywhere
it should?" Traced 9 real paths. Result: 6 `ALREADY_CORRECT` (each with
real, passing test evidence -- write/release wiring, the Keep Going
dispatch gate, the self-improvement adoption path's own existing double-
check, "why is it stuck?" honesty, restart/reload durability), 3 real
`GAP`s: (1) self-improvement's own worker-dispatch branch
(`self-improvement-repair-cycle.mjs`'s `runRepairAttempt`) had zero hold
awareness -- **patched**: checked first, before the retry/escalate
decision, mirroring `keep-going-dispatch-loop.mjs`'s own
`DISPATCH_BLOCKED_BY_HOLD` convention, mutation-verified; (2) the shared
`planner-session-lifecycle.mjs`'s `dispatchWorkerForTask` primitive has
no hold concept at all, documented as an architectural finding for a
future cycle rather than patched immediately given its broader blast
radius (many callers, different project-context assumptions); (3) the UI
rendered a hold nowhere at all, not even the generic `BLOCKED_EXTERNAL`
attention card -- **patched**: `home-needs-you-items.ts`'s
`buildOtherNeedsYouItems` now includes the server's already-real
`PROJECT_EXECUTION_HOLD` attention item (read-only card -- releasing a
hold is already a real Command chat action, not a new button), mutation-
verified. Only the two real, boundedly-fixable gaps were patched --
nothing was invented to "find" more bugs than the trace actually
surfaced, and the third (real, but architecturally larger) gap was
recorded rather than rushed.
