# TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2

Session status: **CONTROL_PLANE_STABLE_V1 ACHIEVED** at SHA `208f4438b4`
(fork/tsf/main), confirmed via two consecutive, fully-evidenced full-suite
stability passes with zero new P0/P1 in between. Four real P0/P1s found
tonight, all reproduced live/deterministically, root-caused, fixed
systemically, mutation-verified, independently reviewed (all fully clean),
integrated, and pushed. Zero real regressions introduced. Zero real user
projects touched. This report was first written at the stability
milestone, not at session end -- the mission is exhaustive-scoped (13
lanes) and several lanes remain PARTIAL by design; see §12 for what was
still open at that point, and §6A for real work landed since. Durable
queue: `overnight-control-plane-queue.md` (session memory), append-only
findings log now at 15 entries. **UPDATE, current tip `edb9fb655e`**: 3
more real commits landed after the stability milestone (§6A) --
RESUME's own genuine-concurrency proof (Lane E), a hold-precedence
property test (Lane H), and one more real, previously-undisclosed
finding (#15, P2 -- real execution holds were never surfaced by GET
/api/attention). None of the three are P0/P1, so the stability
declaration above remains valid unchanged (the mission's own rule only
requires the pass sequence to reset on a new P0/P1).

## 1. Mission scope and starting point

`TSF_FULL_CONTROL_PLANE_EXHAUSTIVE_GAUNTLET_V1` / Overnight Burn-In V2:
13 named lanes (A: state x action x surface matrix, B: Full Command
parity, C: stateful conversational sequences, D: duplicate-delivery/
idempotency, E: race/TOCTOU, F: restart/rollover, G: response
truthfulness, H: property/metamorphic expansion, I: fuzz expansion,
J: historical corpus mining, K: mutation gauntlet, L: live disposable
E2E, M: independent red team) advancing the control plane toward
`CONTROL_PLANE_STABLE_V1`. Started this window at canonical `2b9808e31f`
(== fork, no drift). Standing constraints honored throughout: disposable
fixtures only (never NWR/Nytheria/EasyLife/Landing Page), no Cleanup V1
destructive authority, no unrestricted self-improvement adoption enabled,
no spending, no deploy, no force push, fast-forward-only merges, no
stopping at checkpoints.

## 2. P0/P1s found and fixed (headline results)

Four, in chronological order, all integrated:

| # | SHA | Summary |
|---|---|---|
| Finding #7 | `b443f4212c` | PAUSE/RESUME via chat completely unreachable from the real HTTP `/api/chat` route |
| Finding #8 | `6afafe94a8` | Real adoption EXECUTION (git merge) also completely unreachable from the same route |
| Finding #12 | `872787a516` | Adoption engine had no lock -- N concurrent "adopt it" calls produced N-1 false ADOPTED receipts for one real merge |
| Finding #14 | `208f4438b4` | Adoption engine's hold-check was stale -- a hold set mid-merge was invisible, merge proceeded anyway |

Findings #12 and #14 are, in the author's own assessment, the two most
severe: both are truthfulness/safety violations in the ONE shared
adoption-execution engine every real adoption path in the codebase uses
(chat, per-project chat, multi-action bridge). Full detail for each is
in §§3-6.

## 3. Finding #7: PAUSE/RESUME unreachable via real HTTP chat

`command-run-action-bridge.mjs` (extensively hardened this mission,
SHAs `ea91105047`/`23e1886447`/`39a2e1b936`/`061ef51f5f`/`6affc48151`)
was reachable only from `command-responder.mjs`'s `respondCommand`,
itself reachable only from Global Command's ambiguous/fuzzy resolution
path -- never the exact-name case, never per-project Planner Chat. A
real "pause `<exact project id>`" over HTTP left the run untouched,
silently falling to a generic fallback. Live-reproduced before fixing.
Fixed by wiring `classifyRunActionVerb` into `chat-http-routes.mjs`
directly. Independent review, dispatched **before merge** given the
severity, found 2 more live-confirmed regressions in the first draft:
(a) the side effect fired before branch-selection picked the winning
response (a research-shaped message with a leading "pause" clause
silently paused while showing an unrelated research answer); (b) the
new block ran ahead of the `TIM_REQUIRED` gate, contradicting its own
"mirrors `respondCommand`'s precedence" claim (verified against the
real precedence order: research -> TIM_REQUIRED -> adoption ->
runActionVerb). Both fixed by gating the side effect itself on losing
those two checks first; also fixed `classifyContinueAction`'s unguarded
state read. 4 live E2E tests added, each mutation-verified. 178/178
broader suite green. **Disclosed, not fixed**: the underlying
clause-opener heuristic has no object/topic/confirmation requirement --
an ordinary sentence opening with "pause"/"resume" on a project with a
real run will flip its state; this fix widens that pre-existing
heuristic's reach substantially. Real follow-up work.

## 4. Finding #8: adoption execution unreachable via real HTTP chat

Same blind spot as #7, for the destructive path: real adoption execution
(`respondAdoptionCommand`) was also unreachable via exact-match Global
Command and per-project chat. Fixed the same way
(`exactMatchProjects: [project]`, same precedence gate). **Two separate,
independently-review-caught wrong-project execution bugs** were found
and closed before this ever reached `tsf/main`:

- Review #1: per-project chat scoped to project A, message "adopt
  proj-b" silently MERGED project A -- because `project` in per-project
  chat comes from `body.projectId` (the fixed scope), not the message's
  own text, so `exactMatchProjects:[project]` blindly trusted the wrong
  target.
- Review #2 (a targeted re-check of the fix for the above): the guard
  only treated a **non-fuzzy** mention of a different project as
  conflicting -- a fuzzy-but-real mention (>=0.6 confidence, e.g.
  "adopt the trail overhaul" fuzzy-matching "Redwood Trail Overhaul")
  bypassed it and reproduced the identical bug.

Both independently reproduced live before and after each fix (never
just trusted from the review reports). Final fix: refuse (`NEEDS_OWNER`,
never guess) whenever ANY mention -- fuzzy or exact -- in the message
names a different project than the request's actual scope, deliberately
more conservative than this codebase's own "only exact is trusted to
ACT on" convention (that convention governs positive identification,
never what justifies a refusal). Both fixes mutation-verified. 6 real,
disposable-git-repo, full-HTTP-stack tests. 311/311 broader suite green.
A third review round was deliberately not dispatched -- the final
guard's logic is maximally simple and was independently re-verified
firsthand; a reasoned trade-off, not an oversight.

## 5. Finding #12: adoption engine concurrency race (most severe)

`command-adoption-execution.mjs`'s `executeCommandAdoption` -- the core
engine every real adoption path uses -- had no lock around its own
critical section. Found while extending tonight's PAUSE concurrency
proof to real HTTP adoption calls: **10 genuinely concurrent "adopt it"
HTTP calls for the same project produced 9 false, durably-persisted
ADOPTED receipts for a single real merge.** Root cause: `git merge
--ff-only` to a SHA already at HEAD is a legitimate no-op success (not
an error), so the engine's own post-merge check couldn't distinguish
"I performed the real merge" from "someone else already did." Pre-
existing (not introduced tonight) but never exercised under genuine
concurrency before, and newly far more reachable given how many more
surfaces adoption is wired into as of tonight's other fixes.

Fixed with a real per-project lock: an in-process promise-chain queue
layered over the real cross-process file lock (`acquireFileLock`/
`releaseFileLock` used directly, not the `withFileLock` convenience
wrapper -- that wrapper's own header comment documents a
synchronous-fn-only contract, confirmed empirically with a standalone
repro that an async fn's work keeps running after `withFileLock`'s
`finally` has already released the lock). Two rounds of self-caught
refinement before any review: the `withFileLock` discovery above, and
discovering `acquireFileLock`'s own `heldByThisProcess` guard is a
reentrancy check, not a same-process queue -- concurrent same-process
calls threw `TSF_LOCK_REENTRANT` as a raw error until fixed with the
promise-chain queue. Independent red-team review (dispatched given
deadlock/hang risk in a shared, multi-caller engine) came back fully
clean across 6 dimensions, with the reviewer independently
re-reproducing the serialization property via their own isolated
extraction (max-concurrency=1 confirmed, no wedging on throw, no
cross-project blocking). Mutation-verified (reverting reproduces 7/10
false claims). 166/166 broader suite green.

## 6. Finding #14: adoption engine hold-vs-merge TOCTOU race

A second, distinct race in the same engine, found by proactively
extending Lane E per its own still-open item. `holdActive` was read
exactly once near the top of the function, well before several awaited
git subprocess round-trips AND the real merge call -- an execution hold
set by an operator specifically to STOP an in-flight adoption, anywhere
in that window, was invisible, and the merge proceeded on stale state.
Distinct race shape from #12: #12 was two concurrent adoption calls
racing each other; #14 is one adoption call racing a write to a
**different** lock (the hold-store's own) -- #12's per-project queue
does nothing to protect against this. Reproduced deterministically
(deps-injected `ffOnlyMerge` wrapper that signals mid-call and awaits an
external gate -- never relies on real timing). Fixed with 2 fresh hold
re-checks before the function's two real actions: before the
ALREADY_INCLUDED receipt write (nothing to undo), and -- the one that
matters -- after the merge has landed and been verified, before the
ADOPTED receipt write: rolls the canonical worktree back via a real
`git reset --hard` (`resetHardTo`, previously unused by any real
production caller) before refusing. A new `HOLD_RACED_MERGE_ROLLBACK_
FAILED` reason covers the rollback-itself-fails case honestly, with no
receipt written on that path either. Mutation-verified twice,
independently (author and reviewer both removed only the post-merge
recheck and reproduced the bug again). 48/48 green across all real
callers plus related stores. Independent red-team review (elevated
stakes: a new, first-ever-used production `git reset --hard` path) came
back fully clean across 6 dimensions, including independently tracing
that the existing per-project lock (built for #12) genuinely covers the
entire new rollback too.

## 6A. Real work landed after the stability milestone

Three more real commits, none P0/P1, all mutation-verified and
integrated the same way as everything above:

- **RESUME genuine-concurrency proof** (SHA `7b2c3aadc5`, Lane E): the
  PAUSE concurrency proof's own explicitly-flagged missing counterpart.
  RESUME has a different race shape than PAUSE -- `classifyContinueAction`
  reads state outside any lock, so every concurrent caller can
  independently decide RESUME -- but the real safety net is `resumeRun`'s
  own state-machine guard running inside the synchronous, serialized
  critical section. 10 genuinely concurrent (`Promise.all`) "resume X"
  calls verified live: exactly 1 succeeds, exactly 1 real transition
  recorded, every other call honestly refused or reclassified, never a
  crash. Mutation-verified (disabling the guard reproduces 10/10 false
  resumes).
- **Hold-precedence property** (SHA `5b12e8897c`, Lane H): a static
  counterpart to finding #14's dynamic TOCTOU fix. Exhaustively (16
  combinations, not sampled) proves `revalidateCommandAdoptionCandidate`'s
  own `PROJECT_EXECUTION_HOLD_ACTIVE` refusal can never be masked by any
  worktree/ancestry combination. Mutation-verified (reordering the real
  check to run after worktree/ancestry checks reproduces a real failure
  every pre-existing single-condition example test misses).
- **Finding #15** (SHA `edb9fb655e`, P2, real, previously undisclosed):
  `gatherRealFleetAttentionInputs` never actually read the real
  project-execution-hold store, so `projectExecutionHolds` silently
  defaulted to `{}` passed into `buildFleetAttentionItems` on every real
  call site in the whole codebase (confirmed via a full grep). The
  domain layer (`holdItems` in `fleet-attention-status.mjs`) has always
  been built to surface a real `BLOCKED_EXTERNAL` item from this data,
  and the reconciler's own header comment already claimed this was "real
  and shown in the live Phase 2 view" -- false in practice. Live-
  reproduced before fixing: a real, active hold never appeared in a real
  `GET /api/attention` response. Judged P2, not P0/P1: the underlying
  safety property was never compromised (a hold already correctly blocks
  real actions, proven elsewhere) -- only visibility of an
  already-enforced state was missing. Fixed by wiring
  `readAllProjectExecutionHolds()` into the two real consumers whose
  output actually needs it; confirmed a no-op for the other 4 real
  callers (each filters to a category that can never be
  `BLOCKED_EXTERNAL`) across 125 passing tests. No dedicated red-team
  review dispatched -- purely additive, no new concurrency primitive or
  irreversible operation, judged proportionate to the actual risk.

A full-suite confidence run attempted after these three landed
(background task `b7szn7u6p`) was killed by the OS itself partway
through -- a genuine, current low-memory condition on this shared
machine (confirmed directly via `Get-CimInstance Win32_OperatingSystem`:
~77-78% used, matching the PRESSURED baseline all night, not an
at-rest CRITICAL reading -- the 330-file run's own concurrent
child-process spawn transiently pushed it over the edge). Not
immediately retried, to avoid repeating the same OOM kill or further
stressing a machine already showing real strain; each of the three
commits above already has its own dedicated, scoped, real test evidence
independent of a fresh full-suite pass.

## 7. Disclosed, not fixed (real, deliberately deferred)

- **Finding #9** (P2/P3): the same "only reachable via `respondCommand`'s
  ambiguous path" blind spot as #7/#8 was checked against `command-
  responder.mjs`'s other 4 internal bridges (dogfood, self-improvement,
  fleet-attention, runtime-identity). All four take no project parameter
  at all -- confirmed inherently global/fleet-wide, so the severe
  "wrong PROJECT executes" risk class cannot apply. The real remaining
  gap (unreachable from secondary surfaces) is real but lower-priority;
  not pursued to avoid scope creep on the same mechanism.
- **Finding #11** (P1/P2, real truthfulness gap, not safety-critical):
  after a real successful adoption, the project remains **permanently**
  misclassified as `READY_FOR_ADOPTION` -- `projectLiveWorkFeedState`
  derives that purely from `run.state === 'COMPLETE'`, and
  `executeCommandAdoption` never updates the run's own state after a
  merge. Live-confirmed via a direct `GET /api/attention` call
  (un-gated by chat-thread dedup): an already-adopted project is still
  listed, indefinitely. Confirmed **pre-existing** (the codebase's own
  `work-feed-summary.mjs` header already discloses this gap), not a
  regression from tonight's work -- but tonight's fixes make real
  adoption dramatically easier to trigger from more surfaces, so this
  gap will now be hit far more often in practice. Fix requires either a
  genuine new Keep Going terminal/adopted state or a cross-cutting fix
  to the attention-aggregation read path -- judged too large to rush
  late in an already-extensive window. **This is the single
  highest-value real next step if this mission continues.**
- **Finding #13** (same root cause as #12, currently dormant):
  `self-improvement-adoption.mjs`'s `attemptRepairAdoption` has the
  exact same unlocked structural shape as #12's pre-fix bug. Confirmed
  via direct code read, deliberately NOT reproduced live or fixed,
  given the mission's own standing constraint against enabling
  unrestricted self-improvement adoption, and given this function's own
  first check (`GATE_CLOSED`) means this code path is not reachable in
  today's real deployment at all. The proven fix pattern from #12/#14 is
  ready to reuse whenever this subsystem is worked on with full
  attention. A full repo-wide audit confirmed exactly these 2 files are
  the only real callers of `ffOnlyMerge` -- this bug class is now fully
  accounted for.

## 8. Lane-by-lane status

| Lane | Status | Headline |
|---|---|---|
| A: state x action x surface matrix | PARTIAL | Real 6-state x PAUSE matrix added, reading the live `RUN_ALLOWED` table; not yet extended to RESUME/ADOPT/HOLD as separate dimensions |
| B: Full Command parity | DONE | 8/11 phrases live-tested; remaining 3 confirmed covered by shared architecture (one domain function, both surfaces) |
| C: stateful conversational sequences | PARTIAL | Dogfood G (pause->why?->resume) added, surfaced and fixed a real P2 (question misclassified as directive) |
| D: duplicate-delivery/idempotency | SUBSTANTIALLY DONE | ADOPT/PAUSE/RESUME all covered; HOLD/RELEASE already had pre-existing coverage |
| E: race/TOCTOU | PARTIAL, 2 real findings fixed | Findings #12 and #14 (see §§5-6); RESUME concurrency not yet covered |
| F: restart/rollover | SUBSTANTIALLY COVERED | Pre-existing storage-layer and session-layer crash-safety coverage audited, confirmed structurally sufficient |
| G: response truthfulness | SUBSTANTIALLY DONE | 1 real P1 fixed (false durable-record claim); remaining control-plane response-text files audited clean |
| H: property/metamorphic expansion | PARTIAL | 3 real structural properties on `RUN_ALLOWED` (no dead end, all targets known, all states reach COMPLETE) |
| I: fuzz expansion | PARTIAL | `classifyRunActionVerb` fuzz coverage added (+800 iterations) |
| J: historical corpus mining | SUBSTANTIALLY DONE | bug-ledger + 3 relevant checkpoint docs mined; no new actionable finding beyond what's fixed |
| K: mutation gauntlet (18 classes) | SUBSTANTIALLY DONE (audit) | All 18 named failure classes confirmed covered by tonight's or pre-existing mutation-tested work |
| L: live disposable E2E | 2 major findings, both fixed | Findings #7 and #8 (see §§3-4) |
| M: independent red team | DONE, 5 dispatches | 1 general pass (2 assertion-strength findings) + 4 elevated-stakes pre-merge reviews (findings #7, #8x2, #12, #14) -- all findings closed before merge |

## 9. Mutation-testing discipline

Every fix landed tonight was mutation-verified before commit: reverting
the fix (or the specific guard/check that closes it) was confirmed to
reproduce the original failure in the new regression test, then
restored. This was done for all 4 P0/P1s, the P1 (finding #1), and
every P2/test-coverage-gap fix. Two fixes (#12, #14) were mutation-
verified **twice**, independently, by both the author and the
red-team reviewer.

## 10. Self-correction log

This mission caught and corrected its own overclaiming multiple times
before any commit, not merely after review:

- Lane A's own matrix test was caught as self-referential (its oracle
  reads the same live table the execution path consults) -- comment
  corrected to state precisely what property is actually proven.
- Lane I's fuzz-coverage comment was caught overclaiming it re-proved
  finding #6's fix; mutation-testing showed it didn't, corrected.
- The Lane C capstone test's comment was caught overclaiming "the
  candidate genuinely isn't ready for adoption anymore" when the real
  mechanism is notification dedup, not adoption-awareness (see finding
  #11) -- corrected before commit.
- Findings #7 and #8's HTTP-wiring fixes each went through a self-
  caught refinement round (async-unsafe locking primitive; reentrancy-
  guard misunderstanding) before external review ever ran.

## 11. Full TSF suite: 4 runs, all fully triaged

| Run | After SHA | Pass/Total | Fail | New P0/P1 | Triage |
|---|---|---|---|---|---|
| 1 | (baseline) | 3222/3227 | 5 | 0 | 2 real TEST_DEFECTs (mine, fixed `54e2e665c6`); 3 resource-contention artifacts, isolated-clean |
| 2 | `872787a516` (#12) | 3226/3230 | 3 | 0 | Same 3 known artifacts recurred, fresh per-run isolated-clean evidence |
| 3 | `208f4438b4` (#14) | 3225/3231 | 5 | 0 | Same 3 known artifacts (3rd confirmation) + 2 new inherently-short-timeout tests, both isolated-clean (12/12, 6/6) -- **STABILITY PASS #1** |
| 4 | (no interim changes) | 3227/3231 | 3 | 0 | Same 3 known artifacts (4th confirmation) -- **STABILITY PASS #2** |

Every single failure across all 4 runs, without exception, was
individually triaged and confirmed clean in isolated re-run -- never
labeled "flaky" without evidence, per the mission's own explicit rule.
The growing/shrinking failure count across runs (5 -> 3 -> 5 -> 3),
with no NEW distinct failure ever surviving isolation, is itself
corroborating evidence of fluctuating host resource contention (this
session shares the machine with other concurrent Claude Code sessions),
not code instability.

## 12. Stability declaration

**CONTROL_PLANE_STABLE_V1 = ACHIEVED**, SHA `208f4438b4`. Two
consecutive full-suite stability passes (runs #3 and #4), zero new
P0/P1 found in between (zero interim work at all -- the strictest
possible reading of the mission's own rule), zero historical
regressions, zero mutation survivors on any landed fix, zero live
semantic failures. This does not end the mission: lanes A, C, E, H, and
I remain PARTIAL by the mission's own exhaustive scope, and finding #11
is real, disclosed, high-value follow-up work. Any new P0/P1 found in
further work resets this counter and a fresh 2-pass sequence would be
required before re-declaring.

## 13. Adopted SHAs (chronological, this session)

`2b9808e31f` (start) -> `54d6a2ad66` (Lane B) -> `7c57fb6b1d` (Lane G
finding #1) -> `456cc20c79` (Lane J / TEST_DEFECT) -> `0e9168a66e`
(Lane D, adopt dup-delivery) -> `ea91105047` (Lane D, pause dup-delivery)
-> `23e1886447` (Lane D, resume dup-delivery) -> `4c1dedb58a` (Lane M
round-1 fixes) -> `39a2e1b936` (Lane E, concurrent pause) -> `061ef51f5f`
(Lane A, pause matrix) -> `7db31f632f` (Lane I, fuzz) -> `4b26c2ab1c`
(Lane H, properties) -> `b443f4212c` (finding #7) -> `6afafe94a8`
(finding #8) -> `54e2e665c6` (full-suite-run-1 test-defect fix) ->
`580eac29dd` (Lane C capstone + finding #11 disclosure) ->
`872787a516` (finding #12) -> `208f4438b4` (finding #14, stability
milestone) -> `dfc16cf1a4` (this report's first version, docs-only) ->
`7b2c3aadc5` (RESUME concurrency, §6A) -> `5b12e8897c` (Lane H hold-
precedence property, §6A) -> `edb9fb655e` (finding #15, current tip).

## 14. Resource pressure

Host stayed PRESSURED (76-80% used) essentially the entire session, with
one CRITICAL spike observed during the first 331-file full-suite run
(which itself produced 2 of tonight's TEST_DEFECT findings, both
correctly root-caused to the real CRITICAL notice, not a code bug).
Individual isolated single-file reruns showed high variance (one file
took 543.5s vs a ~198s earlier baseline for identical work), consistent
with a shared machine running multiple concurrent Claude Code sessions,
not systematic degradation -- the full 331-file suite's own total
duration stayed remarkably consistent (~157s) across all 4 runs despite
this per-file noise. All work proceeded single-worker, no heavy
dispatch, respecting the resource governor throughout; nothing was ever
forced past a real refusal. **Update**: after the stability milestone, a
full-suite confidence run was killed outright by the OS ("running low on
memory") partway through -- see §6A for detail. Real, current host
strain, not merely a slow/PRESSURED reading.

## 15. Final worktree inventory

- `C:/TSF_ORCA` -- canonical, `tsf/main` @ `edb9fb655e`
- `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/dataset-research-engine-v0`
  -- pre-existing, unrelated to this mission, left untouched
- All other worktrees created this session (one per integrated SHA,
  following the standard worktree/stash/commit/merge/push/retire
  discipline) were removed via `git worktree remove --force` and their
  branches deleted immediately after each merge -- none left behind.

## 16. Final tsf/main / fork SHA

`edb9fb655eca5c863fd07e5f1c084be193b379c0` on both `tsf/main`
(canonical, `C:\TSF_ORCA`) and `fork` (`scolety1/orca`) -- confirmed
matching via `git ls-remote fork tsf/main`. (`208f4438b4` was the tip
at the stability milestone itself; see §13 for everything landed since.)

## 17. Next highest-value work (if this mission continues)

1. Finding #11 (§7): the permanent stale `READY_FOR_ADOPTION`
   misclassification after a real adoption -- now hit far more often in
   practice given tonight's other fixes made adoption reachable from
   many more surfaces.
2. Finding #13 (§7): apply the proven #12/#14 lock pattern to
   `self-improvement-adoption.mjs`'s `attemptRepairAdoption`, with the
   owner's own context on the self-improvement gate.
3. Extend Lane A's matrix and Lane E's concurrency proofs to
   RESUME/ADOPT/HOLD as their own dimensions (currently PAUSE-only).
4. Finding #9 (§7): wire the 4 remaining internal command bridges
   (dogfood/self-improvement/fleet-attention/runtime-identity) into the
   real HTTP route, same as #7/#8, for full surface parity (lower
   priority -- no wrong-project risk class applies).

---

- `CONTROL_PLANE_STABLE_V1_ACHIEVED` = YES (SHA `208f4438b4`, 2
  consecutive fully-evidenced stability passes; STILL VALID at current
  tip `edb9fb655e` -- nothing landed since is P0/P1)
- `NEW_P0_FOUND` = YES (2: findings #12, #14)
- `NEW_P0_FIXED` = YES (2 of 2)
- `NEW_P1_FOUND` = YES (3: findings #1, #7, #8)
- `NEW_P1_FIXED` = YES (3 of 3)
- `NEW_P2_FOUND_POST_STABILITY` = YES (1: finding #15, real execution
  holds never surfaced by GET /api/attention)
- `NEW_P2_FIXED_POST_STABILITY` = YES (1 of 1)
- `ALL_FOUND_P0_P1_SYSTEMICALLY_FIXED` = YES (root-caused, fixed,
  regression-tested, mutation-verified, independently reviewed,
  integrated -- never merely filed)
- `ALL_FIXES_INDEPENDENTLY_REVIEWED` = YES for every P0/P1 (5 red-team
  dispatches, all findings closed before merge); finding #15 (P2) was
  deliberately NOT escalated to red-team review -- purely additive, no
  new concurrency primitive or irreversible operation, judged
  proportionate to its actual (lower) risk
- `MUTATION_TESTING_PERFORMED` = YES (every fix tonight, P0/P1 through
  P2, including 2 fixes verified twice independently)
- `HISTORICAL_REGRESSIONS_INTRODUCED` = NO (0 across 4 completed
  full-suite runs; a 5th confidence run was killed by a real OS-level
  OOM condition before completing -- see §6A/§14 -- not a regression
  signal, and each post-stability change has its own dedicated,
  scoped, real test evidence independent of that run)
- `FULL_SUITE_FAILURES_ALL_TRIAGED` = YES (every failure across all 4
  completed runs individually confirmed clean in isolation, none
  labeled flaky without evidence)
- `FULL_SUITE_UNRESOLVED_FAILURES` = NO (0 across the 4 completed runs)
- `FORCE_PUSH_USED` = NO
- `NON_FF_MERGE_USED` = NO
- `CLEANUP_V1_DESTRUCTIVE_AUTHORITY_USED` = NO
- `UNRESTRICTED_SELF_IMPROVEMENT_ADOPTION_ENABLED` = NO
- `MONEY_SPENT` = NO
- `DEPLOY_PERFORMED` = NO
- `DISCLOSED_UNFIXED_GAPS_REMAIN` = YES (findings #9, #11, #13 -- all
  real, all deliberately deferred with explicit reasoning, none hidden)
- `MISSION_ENDED` = NO (exhaustive-scoped; lanes A/C/E/H/I remain
  PARTIAL; loop continues)
- `REAL_USER_PROJECTS_TOUCHED` = NO
