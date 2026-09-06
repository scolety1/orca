# Orca Resource Auditor V0 — Reconciliation, Design, and Handoff

Read-only evidence/classification layer only. Nothing in this feature deletes a
worktree, kills a process, runs Git GC, or purges a cache — see Hard Boundaries below.

## Phase 0 — Local reconciliation checkpoint

**Local Orca repository/version.** This worktree's own remotes: `upstream` =
`stablyai/orca`, `fork` = `scolety1/orca`. The installed, currently-running Orca
desktop app (confirmed live via process inspection during this mission) is
`C:\TSF_FOUNDATION_EVAL\installed\orca\Orca.exe`, product version `1.4.197`
(Electron `43.4.1`) — a separately-installed build, not built from this worktree.
`tsf/server/http-server.mjs`'s own `FOUNDATION.upstreamVersion` constant records
`v1.4.184` as the pinned upstream baseline TSF's overlay contract targets.

**TSF cleanup worktree/branch/HEAD.** Branch `Orca-Cleanup-Resource-Management`,
HEAD `2613be403c` at mission start (tracking `tsf/main`), clean tree, one of 14
worktrees sharing this repo's object database (`git worktree list`). All sibling
`tsf-*`/`nwr-*`/`dataset-research-*`/`web-source-*` worktrees are confirmed
externally owned by other live sessions (`ListAgents`) and were not modified.

**Differences from the researched upstream Orca `b025367`.** The prior research
was upstream-only. The actual local checkout already ships a real, tested
workspace-cleanup feature the upstream-only research did not have visibility
into at this depth: `src/main/ipc/workspace-cleanup*.ts` (scan, candidate,
git-evidence, activity, disconnected-ssh, scan-primitives) plus
`src/shared/workspace-cleanup.ts` (the shared type/tier/blocker vocabulary) and
`src/main/worktree-removal-safety.ts` / `src/main/workspace-space-analysis.ts`
(the independent, execution-time deletion guard and the `du`-based disk-size
measurement, neither of which lives inside the cleanup-named files). This
changes the correct implementation strategy from "build worktree/git evidence
collection from scratch" to "wrap and extend Orca's own, already-tested
evidence" — see Integration Point below.

**Reusable evidence collectors and APIs** (full detail in the reconciliation
survey this doc summarizes):
- `src/main/ipc/workspace-cleanup-candidate.ts` `buildWorkspaceCleanupCandidate` —
  main-worktree/folder-repo/pinned hard-blockers, fingerprinting.
- `src/main/ipc/workspace-cleanup-git-evidence.ts` `readWorkspaceCleanupGitEvidence` —
  git clean/dirty, ahead/behind, unpushed-commit fallback via
  `git rev-list --count HEAD --not --remotes`.
- `src/main/ipc/workspace-cleanup-activity.ts` — mtime/reflog-based
  inactivity evidence, with a documented WSL-UNC false-ENOENT hazard.
- `src/main/ipc/workspace-cleanup.ts` `hasKillableProcesses` — Orca's own
  PTY/terminal-liveness probe (`boolean | null`, `null` = unknown, never a
  false negative).
- `src/main/worktree-removal-safety.ts` `findRegisteredDeletableWorktree` /
  `isDangerousWorktreeRemovalPath` — the independent, execution-time guard
  (see NWR conclusion below).
- `tsf/server/repository-identity.mjs` `resolveRepositoryIdentity` — real
  root/HEAD/tree/branch resolution TSF already uses elsewhere; reused as this
  feature's own git-identity source where Orca's candidate isn't available.
- `tsf/server/repo-inspector.mjs` `snapshotRepository`,
  `boundedUntrackedDirectorySizes` — full git snapshot + a non-`du` bounded
  disk-size heuristic already feeding `domain/health.mjs`.
- `tsf/domain/health.mjs` — the `{schemaVersion, status, findings,
  observedAt, authority: 'ADVISORY_ONLY'}` shape and `TIM_REQUIRED`-style
  gating convention this feature's classifier deliberately mirrors.

**Missing evidence** (confirmed absent from Orca core and, until the
trust-boundary hardening pass below, TSF too): a `locked` worktree concept
(does not exist in Orca's `workspace-cleanup` vocabulary at all, always
caller-supplied/unknown here); live RAM/CPU/PID-to-session correlation from
outside a process (Windows exposes no cwd via WMI; confirmed directly during
the live emergency audit — PID→session-name mapping for CLI agent processes
is not derivable without the session self-reporting). Windows junction/
reparse-point resolution was initially assessed as a shared gap with Orca
core and left undone — that assessment was **wrong**: `fs.realpath` resolves
junctions/reparse points natively on Windows with no Orca-core dependency,
and V0 now implements this for real (see Windows Path Identity below).

**Selected TSF-layer integration point.** `tsf/domain/resource-auditor-evidence.mjs`
`mapOrcaWorkspaceCleanupCandidateToEvidence(candidate, extra)` — a pure
function that takes a real Orca `WorkspaceCleanupCandidate` (as returned by
`workspaceCleanup:scan`; its `blockers` array already carries Orca's own
tested main-worktree/folder-repo/pinned/git-evidence/PTY-liveness facts) and
maps it into this feature's stricter evidence shape, with `extra` supplying
what Orca's cleanup feature does not carry (locked state, active-agent/
mission-reference/editor/volatile-context evidence, path-identity
verification, resource usage). This matches the operating model exactly:
Orca owns execution-infrastructure evidence, TSF adds governance/
classification on top rather than re-implementing PTY or git tracking.

**Existing tests/contracts reused.** `src/main/ipc/workspace-cleanup.test.ts`'s
`isMainWorktree: true` fixture pattern (mirrored, not duplicated, in this
feature's own adversarial matrix); `tsf/domain/health.mjs`'s
`ADVISORY_ONLY`/finding-array/severity-rollup shape; `tsf/server/*-http-routes.mjs`'s
`handle<Feature>Route(parts, req, res, ctx, {json, notFound, readBody})`
registration convention (see `tsf/server/health-repair-http-routes.mjs`).

**Confirmation: no Orca-core, Main TSF, NWR, Dataset Research, or Web Source
Acquisition writes were required or made.** Every new/changed file is under
this worktree's own `tsf/` tree (this doc included — see packaging note
below); `git status` at hand-off shows changes confined to
`tsf/server/http-server.mjs` (one route-registration addition) plus new files
under `tsf/domain/`, `tsf/server/`, `tsf/test/`, `tsf/docs/tsf/`. No file
under `src/` was touched.

**Packaging note.** This doc was initially written to the top-level
`docs/tsf/` directory, which is gitignored by default (`docs/**` in
`.gitignore`, allowlisting only a specific set of paths that does not
include `docs/tsf/`) — new files placed there would silently never be
tracked. Moved to `tsf/docs/tsf/`, which is not ignored and already holds
precedent (`TSF_KEEP_GOING_AUTONOMY_V1.md`, `TSF_SAFE_UPDATE_MANAGER_V1.md`).

## Canonical NWR investigation (code + synthetic fixtures only)

Per instruction, `C:\NWR\Niners-War-Room` itself was never touched, probed, or
even listed by this mission. The investigation is entirely code- and
fixture-based, using the real Orca core policy functions read during
reconciliation.

**Visible.** Yes. `listCleanupGitWorktrees` lists every worktree from
`git worktree list` (including the main one); `buildWorkspaceCleanupCandidate`
unconditionally builds a candidate row for it (pushing the `'main-worktree'`
blocker rather than omitting the row). `shouldResolveBroadWorkspaceCleanupActivity`
skips the *extra* activity-resolution sub-step for it as a performance
optimization once it's already known-protected — this does not remove the row.

**Row-selectable.** No. `canSelectWorkspaceCleanupCandidate` requires zero hard
blockers; `'main-worktree'` is in `WORKSPACE_CLEANUP_HARD_BLOCKERS` and is
always pushed when `worktree.isMainWorktree`, so `applyWorkspaceCleanupPolicy`
can never assign it `tier: 'ready'` — `selectedByDefault` is structurally
`false`.

**Bulk-selectable.** Same policy-layer gate applies (tier is never `'ready'`);
this feature did not independently re-verify the renderer's bulk-select-all
click handler re-derives selectability from `canSelectWorkspaceCleanupCandidate`
rather than trusting a stale prop — flagged as a narrow, cheap follow-up
below rather than assumed.

**Admitted to confirmation / final removal.** No — and this is the important
finding: even setting the UI/policy layer aside entirely, the *actual*
deletion call path has its own **independent, second** main-worktree guard at
execution time: `src/main/worktree-removal-safety.ts`'s
`findRegisteredDeletableWorktree` throws `Refusing to delete protected
worktree path` whenever `worktree.isMainWorktree` — before any real `git
worktree remove` runs. This is a separate function, in a separate file, not
shared code with the UI-layer policy that gates selection.

**Conclusion.** A canonical/main workspace being *visible* in a cleanup
inventory (matching the reported NWR incident) is not evidence of a
destructive-safety defect — it is confirmed, from source, to be structurally
blocked from both selection and actual removal by two independent,
non-bypassable checks. This is a **display/UX observation, not a destructive-
safety defect**. The one open item is whether the renderer's own click
handlers correctly *reflect* that non-selectability everywhere (a UI-polish
question), tracked as `GENERIC_GAP` below, not `ORCA_CORE_GAP` — the safety
boundary itself does not depend on the UI getting this right.

**TSF-layer five-layer contract proof (synthetic fixtures only).** To
independently verify this contract at the classifier layer this feature
actually owns — not merely cite Orca's code — `domain/resource-auditor.mjs`
adds `isRowSelectable`, `isBulkSelectable`, `isAdmittedToDestructiveConfirmation`,
and `passesFinalRemovalSafetyBoundary` (the last one deliberately re-reads
`evidence.isMainWorktree` directly rather than trusting the already-computed
classification, mirroring `findRegisteredDeletableWorktree`'s own non-shared
guard). `resource-auditor-adversarial.test.mjs`'s `[nwr-contract]` tests
prove, against a synthetic main-workspace fixture (never the real
`C:\NWR\Niners-War-Room`) with every *other* signal deliberately set
maximally safe: (1) **visible** — a real classification result is produced,
not omitted; (2) **not row-selectable**; (3) **not bulk-selectable**; (4)
**not admitted to destructive confirmation**; (5) **rejected again,
independently, at the final removal-safety boundary**. A control test proves
these four functions are not simply hardcoded `false` — a genuinely safe,
non-main fixture passes all five layers.

## Evidence model

See `tsf/domain/resource-auditor.mjs` and
`tsf/domain/resource-auditor-evidence.mjs` for the full, exact shape. Summary:
identity (main-worktree/folder-root/pinned/locked/path-identity), Git safety
(clean/conflicted/stash/submodules/active-operation/ahead-behind/unpushed-
local-commit fallback), runtime ownership (active workspace/agent/terminal,
PID+matched-session, editor buffer, volatile context, TSF mission reference,
SSH connectivity), and resource usage (workspace/process bytes, CPU sample —
never presented as guaranteed reclaimable).

## Classifier behavior

`classifyWorkspaceResource(evidence, clock)`: every check is ternary — `true`
forces a `PROTECTED`-tier blocker, `false` records a passed check, and
`null`/`undefined` (missing/unverifiable) forces an `UNKNOWN`-tier blocker.
`PROTECTED` wins over `UNKNOWN` if both are present. `DISPOSABLE_CANDIDATE`
requires zero blockers of either tier **and** an explicitly-confirmed
inactivity threshold (`inactivity.thresholdMet === true`) — age/size/branch
name never gate or override on their own; they are documented as
ranking-only signals among already-`DISPOSABLE_CANDIDATE` rows. 97 unit +
adversarial tests (70 in `resource-auditor.test.mjs`, 27 in
`resource-auditor-adversarial.test.mjs`) cover every blocker branch, the
fail-closed default paths (including the 3 paths an independent adversarial
review found and fixed — see Tests below), and 27 named adversarial fixtures
matching the mission's required matrix and this round's hardening additions
(canonical main workspace, nested-worktree masquerade, case-different Windows
path, unresolved junction alias, clean+unpushed, dirty tree, ignored private
data, stash, in-progress Git operation, unknown remote state, Git-status
failure, pinned, locked, active agent, live terminal, stale terminal evidence,
PID-reuse/start-time mismatch, unknown process owner, active TSF mission
reference, old-but-safe, huge-but-protected, contradictory evidence, evidence
drift between scan-time and dry-run-time, canonical-main case-alias,
unexpected-root via git-common-dir mismatch, and the full five-layer NWR
contract proof plus its control case). A further 12 real-filesystem tests
(`resource-auditor-path-identity.test.mjs`, including a genuinely-created
Windows junction) and 7 real-server HTTP-route tests
(`resource-auditor-http-routes.test.mjs`) bring this feature's own total to
**116/116 passing**.

## Dry-run plan

`buildResourceAuditDryRunPlan` — stable shape with `resourceId`, `hostId`,
`canonicalPath`, `processIdentity`, `repository`, `evidenceObservedAt`/
`evidenceExpiresAt`, `classification`, `passedChecks`, `blockers`,
`recommendedAction` (`NO_ACTION` / `GATHER_MORE_EVIDENCE` /
`OWNER_REVIEW_SUGGESTED[_LOW_RISK]` — never a destructive verb),
`expectedBenefit` (`guaranteedReclaim: false`, always), `snapshotHash`
(`sha256`/`canonicalJson` from `domain/canonical.mjs`), `confirmationToken:
null` (V0 executes nothing; a token is never carried as authority),
`authority: 'ADVISORY_ONLY'`, `executionAuthorized: false`.

Example (abbreviated) for a `DISPOSABLE_CANDIDATE`:
```json
{
  "schemaVersion": "TSF_RESOURCE_AUDIT_DRYRUN_V1",
  "resourceId": "ws-1",
  "classification": "DISPOSABLE_CANDIDATE",
  "blockers": [],
  "recommendedAction": "OWNER_REVIEW_SUGGESTED_LOW_RISK",
  "expectedBenefit": { "ramBytesApprox": null, "diskBytesApprox": null, "confidence": "MEDIUM", "guaranteedReclaim": false },
  "confirmationToken": null,
  "authority": "ADVISORY_ONLY",
  "executionAuthorized": false
}
```

## Evidence provenance and the production trust boundary

`classifyWorkspaceResource` stays a pure function of evidence *fields* — it
has no opinion on who collected that evidence, and is used directly (with no
trust ceiling) by every fixture/adversarial test so `DISPOSABLE_CANDIDATE`
stays assertable in tests. Production callers get a second, separate gate on
top: `EVIDENCE_PROVENANCE_SOURCES` = `TRUSTED_LOCAL_COLLECTOR` |
`ORCA_NATIVE_SCAN` | `CALLER_SUPPLIED` | `SYNTHETIC_TEST` | `UNKNOWN`, and
`applyProductionTrustBoundary(classificationResult, evidence)` demotes any
`DISPOSABLE_CANDIDATE` down to `REVIEW` — adding blocker
`EVIDENCE_PROVENANCE_NOT_PRODUCTION_TRUSTED` — whenever
`evidence.provenance.source` is not `TRUSTED_LOCAL_COLLECTOR` or
`ORCA_NATIVE_SCAN` (including when `provenance` is absent entirely). It never
raises a classification the field-level checks already found unsafe.

Critically, **a caller cannot simply claim a trusted source to bypass this**:
`POST /api/resource-auditor/classify` (`resource-auditor-http-routes.mjs`)
unconditionally overwrites every evidence item's `provenance.source` to
`CALLER_SUPPLIED` server-side, before classification runs, regardless of what
the request body claims. Since no real server-side collector is wired to
this route yet (see the `ORCA_CORE_GAP` below), **no evidence reaching this
route can currently be legitimately more trusted than `CALLER_SUPPLIED`** —
so in practice, today, this route can never return `DISPOSABLE_CANDIDATE`.
Proven end-to-end over a real running server in
`resource-auditor-http-routes.test.mjs` (forged `ORCA_NATIVE_SCAN` and
`TRUSTED_LOCAL_COLLECTOR` claims on otherwise-perfect evidence both come back
`REVIEW`, with `evidenceProvenance.source: 'CALLER_SUPPLIED'` in the
response proving the overwrite happened; a genuinely `PROTECTED` forged item
still comes back `PROTECTED`, proving the boundary only ever demotes).

The GET `/git-object-store` route is different: the evidence it returns
really was collected by this server process itself (`git count-objects`),
so it legitimately qualifies as `TRUSTED_LOCAL_COLLECTOR` — but that route
only ever produces `DISK_USAGE_UNKNOWN_RECLAIMABLE` disk evidence, which is
never fed through `classifyWorkspaceResource` at all, so the trust boundary
doesn't apply to it; its own hazard (an unrestricted path) is closed by the
registry gate below instead.

Every dry-run plan carries an `evidenceProvenance` block explaining `source`,
`productionTrusted`, `productionTrustCeilingApplied`, `collectedAt`,
`fresh`, and (when the evidence collector supplied them)
`directlyObservedChecks` vs `assertedChecks` — so a reader never has to infer
trust level from the classification alone.

## Windows path identity

Initially assessed (incorrectly) as unsolvable without an Orca-core change.
It isn't: `fs.realpath` follows symlinks **and Windows junctions/reparse
points** to their true target natively (via `GetFinalPathNameByHandle`), so
`tsf/server/resource-auditor-path-identity.mjs` implements real, read-only
identity verification:
- `resolveCanonicalPath(path)` — the OS-resolved real path, or `null` (never
  a guess) if it doesn't exist or can't be resolved.
- `verifyWorkspacePathIdentity(candidate, expected)` — case-insensitive
  match on win32, fails closed to `matchesExpected: null` if either side is
  unresolvable.
- `resolveGitCommonDir(worktreePath)` — real, read-only
  `git rev-parse --git-common-dir`, giving repository-root/common-dir
  identity (an "unexpected root" hazard: a candidate whose real common dir
  doesn't match the repo it claims to belong to).
- `collectPathIdentityEvidence(...)` — composes all of the above plus
  real-path containment against a registered-worktree list into the exact
  `pathIdentity` shape the classifier consumes.

Proven with a **real, actually-created Windows junction** in
`resource-auditor-path-identity.test.mjs` (`fs.symlinkSync(target, path,
'junction')`, not mocked): the junction resolves to its true target and is
correctly treated as a path-identity match, and a dangling junction (target
deleted after creation) resolves to `null`, never a stale match. Also
covers: case-different aliases, real git-common-dir resolution/mismatch
against an actual repo, and nested-containment detection.
`classifyWorkspaceResource` gained a matching `gitCommonDirMatches` check
(present-and-optional, like `connectivity`): `true` passes,
`false` blocks `UNEXPECTED_GIT_COMMON_DIR` (`PROTECTED`), `null`/ambiguous
blocks `GIT_COMMON_DIR_UNKNOWN` (`UNKNOWN`), field absent entirely = not
checked (not an SSH/common-dir-tracked resource).

## Disk usage — Git object store

`tsf/server/resource-auditor-git-object-store.mjs` runs exactly one read-only
command, `git count-objects -vH`, via `execFile` with an args array (no
shell, no command-string construction — confirmed no injection surface
regardless of path content) and a 15s timeout, distinguishing
`GIT_COMMAND_TIMEOUT` from `GIT_COMMAND_FAILED` in its structured error
result. A 2-slot concurrency semaphore (mirroring Orca core's own
`WORKTREE_SCAN_CONCURRENCY=3` pattern) bounds how many `git count-objects`
subprocesses this diagnostic tool can spawn at once — deliberately, since a
RAM/CPU-pressure diagnostic must never itself become a source of unbounded
subprocess load. `classifyGitObjectStoreDiskUsage` records every parsed
field verbatim under classification `DISK_USAGE_UNKNOWN_RECLAIMABLE` —
`reachabilityVerified: false` always, and an explicit note that the number
must not be presented as reclaimable. Smoke-tested live (read-only) against
this repo's real object store during this mission:
`size-garbage: 26.35 GiB` recorded as raw evidence, not acted on.

**Path authority (hardened this round).** `GET
/api/resource-auditor/git-object-store?worktreePath=...` no longer accepts
an unrestricted path. The query path is first resolved to its real,
canonical path (`resolveCanonicalPath` — closing any junction/alias
workaround), then checked against `trustedRegistryRootsFromOperatorState(opState)`
— TSF's own, already-existing trusted registry: the `repoPath` of every
onboarded project (the same registry `health-repair.mjs` already trusts to
run baseline commands against). `isPathWithinRegisteredRoots` requires an
exact real-path match or real nested containment under a registered root;
an **empty registry rejects everything** (fails closed, not open — proven in
`resource-auditor-http-routes.test.mjs`), and a path outside the registry
gets `403 PATH_NOT_IN_TRUSTED_WORKSPACE_REGISTRY` even when it is a real,
existing git repository on disk (proven against a second, genuinely-real but
never-onboarded temp repo in the same test file).

## HTTP routes (request/response schemas)

**`GET /api/resource-auditor/git-object-store?worktreePath=<string>`**
Response `200 {ok:true, evidence: <DISK_USAGE_UNKNOWN_RECLAIMABLE shape>}` on
success; `200 {ok:false, reason, detail}` for a resolvable-but-failed git
call; `403 {ok:false, reason:'PATH_NOT_IN_TRUSTED_WORKSPACE_REGISTRY', detail}`
outside the registry; `422 {ok:false, error}` for a missing query param.

**`POST /api/resource-auditor/classify`** Request
`{evidence: [<evidence shape>], contentionSignals?: [...]}`. Response
`200 {ok:true, plans: [<dry-run plan shape, including evidenceProvenance>], recommendations: <ram/disk/cpu/contention grouping>}`.
Every evidence item's `provenance.source` is server-overwritten to
`CALLER_SUPPLIED` before classification, unconditionally.

## Tests and independent verification

This feature's own 4 test files total 116/116 passing (see exact per-file
counts above). Full TSF suite runs (`node --test test/*.test.mjs`) were
otherwise green across multiple runs; the only failures observed
(`keep-going-autonomy-proof.test.mjs` — a stall-detection timeout, and
separately an EPERM cross-process-lock rename race) were confirmed
pre-existing contention flakiness, not a regression from this feature — the
autonomy-proof test passed cleanly in 4.7s in isolation against the
unmodified baseline (verified via a tagged `git stash push -u`/`apply
<sha>`/`drop`, never a bare stash command, per this box's shared-stash-stack
rule), and both failure modes are exactly the class of shared-machine
contention this mission's own live RAM-pressure audit diagnosed on this box
(`cross-process-file-lock.mjs` even documents a Windows AV/indexer
file-lock retry path for this exact EPERM shape). See the mission's final
return for the exact, current full-suite pass/fail/skip/todo accounting.

An independent adversarial-verifier agent reviewed all new files, attempted
to construct evidence inputs that reach `DISPOSABLE_CANDIDATE` while a real
hazard is present, checked the HTTP routes and git-object-store collector for
any mutating/injectable path, and re-ran the test suite itself.

**Findings, all fixed and re-verified.** Three fail-open gaps shared one root
cause — a `null`/unknown evidence value read the same as an explicit `false`
(confirmed-safe) value, with no ternary "unknown" branch:
`pathIdentity.containsOtherRegisteredWorktree`, `git.conflicted`, and
`connectivity.sshReachable` when a `connectivity` object is present but
ambiguous. Each reproducibly reached `DISPOSABLE_CANDIDATE` with zero
blockers despite an unverified hazard. Fixed in `classifyWorkspaceResource`
(explicit `UNKNOWN`-tier branches: `CONTAINS_REGISTERED_WORKTREE_UNKNOWN`,
`GIT_CONFLICTED_UNKNOWN`, `SSH_REACHABILITY_UNKNOWN`), with 4 new regression
tests added (75/75 now passing) — including one confirming a genuinely absent
`connectivity` object (a non-SSH-backed resource) correctly stays
not-applicable rather than forcing UNKNOWN.

The one accepted-at-the-time item from round 1 — `GET
/api/resource-auditor/git-object-store` taking an unrestricted
`worktreePath` with no registry check — is now closed by the trust-boundary
hardening pass above (the registry gate), not merely re-accepted.

**Round 2 (trust-boundary hardening) — independent adversarial review,
PASS on all 7 checked items.** A second verifier actively tried, against a
real running server, to: get `/classify` to return `DISPOSABLE_CANDIDATE`
via 13 forged request bodies (no provenance, claimed trusted sources,
provenance nested at wrong keys, `__proto__`/prototype-pollution-shaped
keys, an injected `classification` field directly on an evidence item,
non-array `evidence`, 500-item batches, malformed JSON) — none succeeded,
confirmed structurally un-bypassable in-language (the literal
`source: 'CALLER_SUPPLIED'` key is written *after* the spread in the object
literal, so it always wins regardless of what the caller supplies); read
`/git-object-store` outside the registry via prefix-collision siblings
(`RepoEvil`, `Repo.evil`), `..`-traversal, trailing/double slashes, mixed
case, and `\\?\` long-path form — every attempt correctly rejected, or
correctly allowed only because it resolved to a genuinely registered real
path; confirmed the 2-slot concurrency semaphore fully drains after mixed
success/failure/timeout load (drain probes completing in single-digit ms
after 15 and 12 concurrent calls, script-verified, not just read); confirmed
no `fs.realpath` failure can escape its `try/catch` to crash the process;
confirmed only `count-objects` and `rev-parse --git-common-dir` ever appear
as git subcommands in either new server file; confirmed nothing outside
`tsf/` was touched. Two minor, non-blocking notes were raised and addressed:
a raw JSON `null` request body threw inside the route (caught by the outer
handler as a `500`) instead of a clean response — fixed with optional
chaining (`body?.evidence`), regression test added
(`resource-auditor-http-routes.test.mjs`, now 7 tests); and a real TOCTOU
window between path resolution and use is accepted, documented in-code, not
fixed, given the route only ever discloses aggregate object counts/sizes,
never file content.

## Known limitations / V1 prerequisites

- **No live evidence bridge from Orca into this feature's production route**
  (the central limitation this round's hardening pass responds to instead of
  overclaiming around): `POST /api/resource-auditor/classify` has no
  server-side collector wired to it, so every evidence item arriving there is
  forcibly stamped `CALLER_SUPPLIED` and can never reach `DISPOSABLE_CANDIDATE`
  — see the `ORCA_CORE_GAP` below. V0 is therefore an honest evidence/
  classification *library plus a disk-evidence collector*, not yet a live
  auditor that can autonomously certify a workspace disposable.
- Live process/session ownership correlation (PID → TSF session name) is not
  derivable from outside; V0's evidence shape requires the caller to supply
  `matchedSessionId`, failing closed to `PROCESS_OWNERSHIP_UNKNOWN` otherwise.
- A `locked` worktree concept does not exist in Orca's `workspace-cleanup`
  vocabulary at all — always caller-supplied/unknown here.
- V1 (destructive executor) prerequisites, per mission spec: immediate
  pre-action revalidation (never trust this V0's `snapshotHash`/evidence as
  still current), owner confirmation, reversible quarantine/restore,
  graceful process shutdown, partial-failure recovery, cleanup receipts,
  human-controlled permanent purge, and an execution-boundary blocker check
  independently enforced from this classifier (mirroring
  `worktree-removal-safety.ts`'s pattern of a second, non-shared guard at the
  actual point of action) — plus, specifically, a real `TRUSTED_LOCAL_COLLECTOR`/
  `ORCA_NATIVE_SCAN` evidence bridge before `applyProductionTrustBoundary`
  can ever legitimately let a live classification reach `DISPOSABLE_CANDIDATE`.

## ORCA_CORE_GAP / GENERIC_GAP proposals (not implemented — Orca core untouched)

- **`ORCA_CORE_GAP` (primary, this round): no live evidence bridge exists
  from Orca's real `workspaceCleanup:scan`/PTY-liveness/active-session facts
  into any external consumer.** `mapOrcaWorkspaceCleanupCandidateToEvidence`
  is the TSF-side half of this integration (already built, tested); the
  missing half is Orca-core: an IPC/HTTP surface that lets a trusted local
  process request a real `workspaceCleanup:scan` result (or equivalent live
  facts: active-workspace/live-agent/terminal-liveness) without going through
  the Electron renderer. Until that exists, this feature's production route
  cannot legitimately mark anything `TRUSTED_LOCAL_COLLECTOR` or
  `ORCA_NATIVE_SCAN`, and per the hardening in this round, correctly refuses
  to pretend otherwise.
- `GENERIC_GAP`: verify the workspace-cleanup renderer's row/bulk-select
  click handlers always re-derive selectability from
  `canSelectWorkspaceCleanupCandidate` rather than a possibly-stale prop, for
  the main-worktree/folder-repo/pinned rows specifically (UI-polish scope;
  the real safety boundary is independently enforced regardless, per the NWR
  conclusion above).
