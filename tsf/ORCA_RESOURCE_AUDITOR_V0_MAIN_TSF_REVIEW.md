# Orca Resource Auditor V0 — Main TSF Review

Review only, per instruction — no merge, adopt, push, deploy, Orca-core
change, or destructive resource action performed or authorized. The
Orca-Cleanup-Resource-Management worktree was read-only inspected and left
exactly as handed off, at `4b5a45d030`.

## Independent verification (not just the handoff packet's own numbers)

- **Containment/diff**: confirmed directly. `2613be403c` (base) is a real
  ancestor of `4b5a45d030`; diff-stat matches the handoff exactly (11 files,
  3017 insertions, 20 deletions). Only `server/http-server.mjs` touches an
  existing file — read the diff line by line: it registers the new route
  and merges two pre-existing `if` blocks into one short-circuiting check
  to stay under this file's own max-lines budget (matching this codebase's
  own "never disable max-lines" rule) rather than reordering or changing any
  existing route's behavior.
- **No destructive operation anywhere**: grepped every new file for
  delete/kill/exec/gc/prune/purge patterns. The only hits are comments and a
  field name (`prunePackable`, a metric parsed from `git count-objects`
  output, not an action) explicitly stating what the code does *not* do.
  `execFile` is called exactly once, for `git count-objects -v -H` via an
  argument array (no shell), read directly.
- **Caller-supplied evidence cannot produce DISPOSABLE_CANDIDATE**: read
  `resource-auditor-http-routes.mjs`'s `/classify` handler directly —
  `provenance.source` is unconditionally overwritten to `CALLER_SUPPLIED`
  before classification, and `applyProductionTrustBoundary` (read directly)
  only ever *demotes* an all-clear `DISPOSABLE_CANDIDATE` to `REVIEW` for
  non-production-trusted provenance; it structurally cannot raise or trust a
  classification. Confirmed by its own regression tests.
- **Registry/path enforcement and Windows path identity fail closed**: read
  `resource-auditor-path-identity.mjs` directly. `resolveCanonicalPath`
  returns `null` (never a literal-path fallback) on any resolution failure;
  Windows comparisons are case-insensitive; `containsOtherRegisteredWorktree`
  correctly checks strict-prefix nested containment. `classifyWorkspaceResource`'s
  `ternaryCheck` helper (read directly) has exactly three outcomes per
  signal: `true`→`PROTECTED`, `false`→pass, anything else→`UNKNOWN` — there
  is no code path where an unresolved/missing signal becomes a pass.
- **Canonical/main workspace blocking at every layer**: `isMainWorktree`/
  `isFolderRepo`/`isPinned`/`isLocked` all block at `PROTECTED` when true;
  `passesFinalRemovalSafetyBoundary` (the modeled final boundary)
  independently re-checks `evidence.isMainWorktree !== false` — i.e. missing
  evidence fails closed too, not just an explicit `true`.
- **Focused suite**: independently re-ran (not trusted) — **116/116 pass**,
  matching the handoff exactly.
- **Full suite**: independently re-ran **twice**. Second run matched the
  handoff exactly: 1084 total, 1082 pass, 1 fail
  (`keep-going-autonomy-proof.test.mjs`, the same pre-existing,
  already-documented shared-machine timing flake this session has seen
  repeatedly across multiple unrelated worktrees today), 1 skip
  (`plugin-real-load-proof.test.mjs`, self-guarded on an occupied port,
  correctly not stopping the live process). Disclosing honestly: the FIRST
  run also hit a second, different failure
  (`onboarding-orca-resilience.test.mjs`'s own "transient timeout recovers
  via bounded retry" test) that did not reappear on the second run — its own
  name describes a real-wall-clock timing race, consistent with the same
  contention pattern as the other known flake, not a defect introduced by
  this candidate.
- **ORCA_CORE_GAP / GENERIC_GAP classifications**: both independently
  confirmed accurate. No code anywhere in this candidate (or in Main TSF)
  bridges Orca's real `workspaceCleanup:scan`/PTY/session evidence to an
  external consumer — `DISPOSABLE_CANDIDATE` is structurally unreachable via
  any HTTP-supplied evidence today, exactly as claimed. Renderer
  row/bulk-selectability recomputation is outside this candidate's diff and
  was not independently re-verified here (correctly left as a tracked,
  disclosed open question, not silently assumed fine).

## Architecture decisions requested

**1. Which modules/interfaces belong in the generic TSF platform?**
All five: `domain/resource-auditor.mjs` (pure classifier, zero I/O),
`domain/resource-auditor-evidence.mjs` (evidence shaping + registry
extraction), `server/resource-auditor-path-identity.mjs`,
`server/resource-auditor-git-object-store.mjs`, and
`server/resource-auditor-http-routes.mjs`. All five are genuinely
domain-neutral, zero-dependency, and carry no Orca-Cleanup-lane-specific
coupling — they are copy-ready into a Main TSF worktree exactly the same
way the Web Table Source Adapter's own generic modules were, whenever
adoption is authorized (not done here — this review did not build an
integration worktree, per the "review only" instruction).

**2. Does the missing trusted Orca scan/session bridge warrant a narrowly
scoped Orca-core proposal?** Yes, in principle — it is the only path that
ever makes a live `DISPOSABLE_CANDIDATE` production-legitimate. But this
review does not draft that proposal: it would touch Orca core, and this
platform's own foundation-health gate treats zero upstream core delta as a
hard invariant this session has protected all day. That proposal needs its
own explicitly-authorized mission with its own reconciliation, not a
byproduct of this review.

**3. How should the read-only capability surface through Command/Home/Fleet
without creating a second scheduler or cleanup authority?** Command should
gain a new read-only advisory intent (structurally identical to the
existing `GLOBAL_ADVISORY`/`NEEDS_YOU_QUERY` pattern already in Command V1)
that calls `/api/resource-auditor/classify` or `/git-object-store` and
relays the result conversationally — never as a dispatch-worthy action.
V0 has zero destructive capability by design; Command must not become the
first thing that makes it feel actionable. No new scheduler, no new
dispatch path — TSF's existing Needs You / TIM_REQUIRED gates remain the
only route to any future destructive action, preserving exactly the stated
boundary (Orca owns execution infrastructure; TSF owns intent, durable
policy, governance, confirmation, consequences).

## Which gaps must close before any V1 design begins

Per the handoff's own §9 list (trusted live Orca evidence, immediate
pre-action revalidation, independently enforced final execution blockers,
owner confirmation of an exact action set, reversible quarantine/restore,
graceful shutdown before hard termination, partial-failure recovery,
verification/cleanup receipts, human-controlled permanent purge) — all
correctly identified, none built here, none should be started without a
separate, explicitly-authorized destructive-capability mission.

## Decision

**`ORCA_RESOURCE_AUDITOR_V0_READY_FOR_ADOPTION`**

Ready to be adopted (integrated into a Main TSF worktree, the same governed
way the Web Table Source Adapter was) whenever that is separately
authorized — not performed in this review. No correction required.
