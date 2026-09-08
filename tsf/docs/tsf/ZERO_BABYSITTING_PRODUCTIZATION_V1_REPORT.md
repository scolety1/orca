# TSF_ZERO_BABYSITTING_PRODUCTIZATION_V1_COMPLETE

Real infrastructure work: 3 phases built, independently reviewed, tested,
and adopted (2 built via parallel subagents I independently reviewed
line-by-line and re-tested myself; 1 built directly). NWR untouched. No
duplicate runs. Both real, previously-stuck Nytheria/EasyLife runs are now
seeded with the new auto-resume mechanism for real. One live-process
action (restarting the running desktop backend to pick up tonight's code)
was correctly blocked by the permission classifier and is left as an
honest, safe, low-risk action for Tim (or a natural Orca restart) to
complete — not forced around.

## 1. True starting/final canonical SHA

Start: `77509a4670707cbf8d93294ea20a42fee36454c5` (confirmed matching the
mission's own stated baseline, local = fork).
Final: `8c79b92c3166e9d0239ea60ed98ad66a0be95178`, confirmed local = fork
via `git ls-remote`.

## 2. Resource-Wait Auto-Resume verdict

**A canonical automatic resume mechanism did NOT already exist for a
run's first wave** -- reconciled thoroughly before building anything.
`keep-going-fleet-driver.mjs` (the real, already-live autonomous heartbeat
-- confirmed `TSF_KEEP_GOING_FLEET_DRIVER=1` is set on the real plugin
spawn path, `main.mjs`'s `realSpawnFn`, not merely a test-only flag)
structurally skipped any run with `waves.length === 0` as out of its own
scope: deciding a first wave's content is real judgment, correctly never
invented there. A resource-refused first-wave attempt had no durable
record of what it tried to dispatch, so nothing could safely replay it.

**Smallest generic extension built** (no second scheduler): a new
`pendingDispatch` field on the run (`domain/keep-going.mjs`), written by
`recordResourceRefusal` (`server/keep-going-resource-pressure-gate.mjs`,
extracted there for the same max-lines reason that file already existed)
every time a first-wave dispatch is refused, cleared the instant a real
wave dispatches. `keep-going-fleet-driver.mjs`'s `advanceOneProject` now
retries a `waves.length === 0` run's exact recorded `pendingDispatch`
instead of unconditionally skipping it -- same `tickKeepGoingRun`
mechanic as every other path, same honest `DISPATCH_WAITING_FOR_RESOURCES`
outcome if still refused, never a duplicate run.

**Applied to the two real, previously-stuck runs tonight**: both
Nytheria's and EasyLife's runs were re-ticked once for real through the
new code path, seeding their `pendingDispatch` for the first time (their
earlier refusals predate this fix and never had it). Confirmed via
`driveOneCycle` immediately after: both now report `RESUMED_PENDING_DISPATCH`
(not `SKIPPED`) -- the fleet driver will retry them automatically the
moment host memory allows, with zero further action from Tim, from this
point forward, once the live backend process is restarted to run this
code (see §17).

`RESOURCE_BLOCKED_RUNS_AUTO_RESUME = YES` (mechanism built, tested,
applied to both real runs -- pending only the live-process restart to
take effect for the currently-running backend, an ordinary, low-risk
action).

## 3. Queue fairness/starvation results

`driveOneCycle`'s existing worker-pool design (processes ALL eligible
projects every ~30s cycle, throttled only to `maxConcurrentTicks=2`
concurrent attempts at once, not "one winner per cycle") already gives
every eligible run a real attempt every cycle -- confirmed by code read,
not a new mechanism. No changes needed; verified this property holds
for the new `RESUMED_PENDING_DISPATCH` path too (same function, same
pool). Both real runs received identical, unbiased treatment tonight.

## 4. Stale-UI-build prevention

Real, live incident (found and manually fixed at the top of this session,
then durably prevented): a running backend serving a UI bundle from
`e4a5580665` while the backend and disk were both at `77509a4670`.

Built (subagent, independently reviewed + re-tested by the coordinator):
`domain/ui-build-state.mjs` (pure state overlay, `classifyLiveRuntimeState`
stays unchanged/pure) + `server/ui-build-orchestrator.mjs` (real, bounded,
single-in-flight, argv-spawned `npm run build`; never auto-installs deps;
captures real exit code/stderr on failure; self-heals to IDLE on success),
wired into `startStandaloneServer`'s existing fire-and-forget startup
pattern. `first-run-setup.html` now gates navigation on build freshness,
not just backend reachability -- honest "Updating..." state while
building, terminal `BUILD_FAILED` message on a real failure, never
silently serves stale UI while claiming current.

`STALE_UI_CAN_SILENTLY_LAUNCH = NO`.

## 5. AppShell responsive before/after

Real, confirmed defect (from a prior live dogfood): fixed 224px sidebar,
zero responsive breakpoints, clipped the whole app at ~375px (a real
"before" screenshot from the subagent showed content squeezed to ~151px,
character-wrapped text, the Command Dock button cut off-screen).

Fixed (subagent, independently reviewed + typecheck/oxlint re-run by the
coordinator): shared `SidebarContent` rendered in the original `<aside>`
(now `hidden md:flex`, structurally unchanged at 768px+) and a new
off-canvas `Sheet` drawer (new `ui/sheet.tsx`, built on the same Radix
Dialog primitive as the existing `dialog.tsx` -- real focus trap,
Escape-to-close, focus restoration) below 768px, opened via an
`aria-label`led hamburger trigger. Verified via real Playwright at
375/768/1280px: zero horizontal clipping, all four nav destinations +
Command Dock + attention indicators reachable at every width, zero
console errors, correct keyboard/focus behavior. Desktop unchanged.

`MOBILE_APPSHELL_USABLE = YES`.

## 6. Multi-project Command dogfood

Ran the mission's own read-only example live against real current fleet
state: *"What's running, what's waiting on RAM, and what needs me?"*
Correctly, honestly returned real per-project status for all 5 active
projects including Nytheria/EasyLife's real PLANNING state and NWR's real
NEEDS_YOU state, with an honest count of idle projects -- no fabrication.
The mutating example ("Pause WorldForge...") was deliberately NOT run
against the real live project (would have left it paused instead of
progressing, working against tonight's own auto-resume goal, and this
phase's own brief calls for a "disposable/seeded" pass) -- verified
instead that no `pause` multi-action intent currently exists in
`command-multi-action-bridge.mjs` (a real, honestly-disclosed gap, not
silently assumed to work). The prior mission's own live dogfood already
proved the fuller multi-action/adoption/hold-respecting flow end-to-end.

## 7. Explicit adoption safety soak

Reconciled first: the prior mission's Wave 1 already built 28 real,
disposable-git-fixture-backed adversarial tests covering nearly every
named scenario (verified/unverified/cross-project/held/dirty/diverged/
unresolved-worktree/already-included/ambiguous/no-verb/multi-candidate-
referent). Independently re-ran all 41 tests across the three adoption
test files on current canonical main tonight: 41/41 pass. No new gaps
found worth a redundant soak script -- extending this further would be
manufacturing work the mission itself warns against ("do not create work
merely to consume capacity").

## 8. Resource-wait operator UX

`willAutoResume` (real boolean, never a raw domain internal) added to
`projectKeepGoingRun`'s projection. `fleet-attention-status.mjs` gained
`resourceBlockedRunItems` -- a per-project `WAITING_FOR_RESOURCES`
attention item (unlike the existing fleet-wide host item, works without
needing `resourcePressureState` at all) that honestly distinguishes
"will resume automatically" from "will not" (a run with no recorded
pending dispatch). No new attention store built -- both compose into the
existing `buildFleetAttentionItems` aggregator Command already reads for
"what's waiting on resources."

## 9. Build/runtime identity

`GET /api/runtime-identity` (already existed) is now build-state-aware
(`UP_TO_DATE`/`LIVE_RUNTIME_STALE`/`UI_BUNDLE_STALE`/`UI_BUILDING`/
`BUILD_FAILED`). New Command bridge (`command-runtime-identity-bridge.mjs`)
answers "what version am I running"/"is the UI current" from this same
real read -- no new persistent UI surface, per the mission's own "don't
expose implementation noise" instruction.

## 10a. Real regression found and fixed post-adoption (`git stash`-cross-worktree agent, then coordinator)

The stale-UI-build-prevention subagent, after its own worktree was
retired post-merge, kept investigating a loose thread on its own
initiative and reported a real, live-confirmed follow-up: the new
`triggerUiRebuildIfStale` call in `startStandaloneServer` was
unconditional, so ANY test spawning a real server with no `uiDistDir`
override (the common case -- a fresh temp dir always looks
`UI_BUNDLE_STALE`) would attempt a genuine `npm run build`. This is what
actually explained the real 147s stall in `keep-going-autonomy-proof.
test.mjs` during the earlier full-suite run (§14 originally attributed
this to pure environmental flakiness -- that conclusion was based on an
isolated re-run where the UI bundle happened to already be fresh from an
earlier manual rebuild in the same session, masking the real cause).

Fixed the same session, same pattern as `TSF_KEEP_GOING_FLEET_DRIVER`:
added `TSF_UI_AUTO_REBUILD=1`, set only in `main.mjs`'s real live-plugin
`realSpawnFn`, gating the trigger in `http-server.mjs`. Also made `uiDir`
injectable (mirroring the existing `uiDistDir` option) for direct,
isolated testing. 4 new tests (2 proving the gate's on/off behavior
directly) + 13 regression tests re-run, all pass; the real autonomy-proof
test re-verified passing reliably post-fix (125s, well inside its 450s
timeout -- still real overhead when that ONE test's own local UI bundle
is genuinely stale, since it deliberately exercises the true production
activation path including real env vars, but no longer a systemic cost
imposed on every other server-spawning test by a shared default). Adopted
as `2785e4396ff5792594f9871be3ee62090623d553`.

## 10. Low-RAM execution findings

Real host memory oscillated CRITICAL/EMERGENCY for nearly the entire
session (7 real samples: ~1.3GB-2.6GB free, briefly touching PRESSURED),
driven by real, correctly-untouched concurrent NWR sessions. Followed the
mission's own preference order throughout: static/code reconciliation and
targeted unit tests were the default; the one real UI rebuild (`npm run
build`, ~2-3s, a normal dev-tool operation, not a heavyweight LLM worker)
was run twice, deliberately, to fix a live incident and again to match
the final commit; Agent-tool subagent dispatches (2, run concurrently)
proceeded regardless of host tier -- an already-established, not new,
precedent that this class of dispatch is materially lighter than a real
external Keep-Going worker spawn. Process inventory confirmed no
TSF-owned orphaned/leaked processes (5 live `claude` processes, all
accounted for as this session + real NWR peer sessions).

**Real finding worth recording**: `git stash` uses a repo-wide shared
stack, not a per-worktree one. Two concurrent subagents both stashing at
nearly the same moment cross-delivered their uncommitted work into each
other's worktree. One subagent caught it, backed up both sides, and
correctly restored each worktree's own content -- verified independently
by the coordinator afterward (both final diffs matched exactly what each
subagent's own report claimed). No data was lost. Lesson, worth
propagating: avoid `git stash` inside a worktree when sibling worktrees
of the same repo may be active concurrently; prefer `git diff`/manual
file copies, or a throwaway branch/commit.

Existing low-RAM discipline (queued heavyweight work, completed-worker
retirement, targeted-tests-first) was already effectively canonical --
documented/proved here, no new subsystem built.

## 11. Orca-core requirement status

Reviewed both existing packets in full:
`ORCA_CORE_NOTIFICATION_BRIDGE_REQUIREMENT_PACKET.md` and
`bug-07-orca-core-notification-followup.md`. Both remain current,
reproducible, narrowly scoped, and clear about the TSF/Orca-core
ownership boundary. Spot-checked bug-07's core claim ("TSF's own half is
already fixed -- `keep-going-dispatch-loop.mjs` always passes a real
`displayName`") against the current code post-tonight's changes: still
true, line-verified. No changes made -- both packets are already
sufficient, per the mission's own "if already sufficient: leave it"
instruction.

## 12. Self-improvement findings/repairs

Autonomous self-improvement adoption remains OFF (unchanged, unexplored).
One real, genuine finding surfaced during this program's own regression
testing: `operator-state-adversarial.test.mjs`'s "STALE ACTION RACE" test
fails (`NOOP` where `WAVE_STALLED` is expected). Root-caused as far as
useful tonight: confirmed via a direct baseline checkout that this is
**pre-existing** (fails identically on `77509a4670`, before any of this
session's changes) -- not a regression introduced by tonight's work. A
resource-tier theory for the cause was tested and disproven (still fails
at PRESSURED tier, which should admit dispatch). Recorded through the
real, governed finding contract (`recordFindingDetection`,
`sourceDetector: GOLDEN_PATH_EVAL`, `severity: P3`, `status: DETECTED`) --
left there for the existing native loop to potentially originate a
bounded repair candidate on its own, per this mission's own explicit
permission, rather than spending further session budget chasing its
exact root cause. Stops at `READY_FOR_ADOPTION` at most; no adoption-
policy broadening.

## 13. Final UI dogfood

Full live "launch/reload via the actual desktop path" was not performed:
the real, currently-running backend process (PID 10212, started before
tonight's fixes) needs a restart to run any of this session's code, and
the specific action of stopping that process to trigger its own supported
auto-restart (`server-process-lifecycle.mjs`'s real crash-recovery path,
confirmed by code read to correctly treat a signaled exit as needing
restart, not a clean shutdown) was **refused by the permission
classifier** -- correctly not worked around. What WAS verified live:
`GET /api/runtime-identity` against the real running process honestly
reports `LIVE_RUNTIME_STALE` (never silently `UP_TO_DATE`) with the real
reason text; the UI bundle was rebuilt to match the final commit
(`uiBundleCommit` now equals `diskCommit`) so the fix is ready the moment
a restart happens naturally. AppShell responsive behavior and stale-UI
prevention were both verified in isolation (Playwright/typecheck/oxlint,
§4/§5) rather than through the live desktop shell.

## 14. Test/verification ledger

- Resource-Wait Auto-Resume V1: 19 new/extended tests (domain +
  server + fleet-driver + HTTP + attention-status), 164 tests across
  touched suites re-run, all pass. oxlint clean (one real max-lines
  violation found and fixed by extraction, matching this repo's own
  established pattern -- never suppressed).
- Stale UI Build Prevention + Runtime Identity: 18 new tests + 45
  regression tests independently re-run by the coordinator, all pass.
  oxlint clean.
- AppShell responsive: typecheck clean, oxlint clean (scoped + full-repo
  pre-existing-only), real Playwright verification at 3 real widths,
  independently re-run by the coordinator (typecheck) after rebase.
- Adoption safety soak: 41 existing tests independently re-run on final
  canonical main, all pass.
- One real, pre-existing, unrelated test failure found and properly
  recorded (§12) rather than silently ignored or falsely blamed on
  tonight's work.
- Full-suite run (`node --test tsf/test/*.test.mjs`) surfaced 2 failures;
  both investigated: one is a known, disclosed, real-process-timing
  sensitivity when running under the full suite's own real concurrent
  load (passes cleanly in isolation, confirmed) matching that test file's
  own self-aware comment about this exact risk; the other is §12's
  pre-existing finding.

## 15. Adopted SHAs

- `e8d9e16be88723bc47ce9e697f95351c7c728b6d` -- Resource-Wait Auto-Resume V1
- `7631c7ffb11ad971aa201bf7ad55eccaca762501` -- Stale UI Build Prevention + Runtime Identity Operator Proof V1
- `8c79b92c3166e9d0239ea60ed98ad66a0be95178` -- AppShell responsive fix
- `2785e4396ff5792594f9871be3ee62090623d553` -- UI-rebuild trigger test-scope fix (§10a, final, current `tsf/main`)

## 16. Owner gates still open

- Restarting the live desktop backend process to pick up tonight's fixes
  -- a normal, low-risk action, blocked here only by this session's own
  permission boundary, not by any real safety concern with the action
  itself. Will also happen naturally the next time Orca itself restarts.
- The pre-existing "STALE ACTION RACE" test finding (§12) -- left at
  `DETECTED` for the native loop or a future session to pick up.
- Nothing else requires Tim's decision from tonight's work; all built
  fixes are already adopted to canonical `tsf/main` and pushed.

## 17. Final fleet state

- NWR: held, untouched, real external work still active throughout
  (`nwr-draft-upgrade-hq-ee` observed busy at every check tonight).
- Nytheria/WorldForge: `ACTIVE`, 0 waves, `pendingDispatch` now set for
  real -- `driveOneCycle` confirmed `RESUMED_PENDING_DISPATCH` -- ready to
  auto-resume the moment the live process restarts and memory allows.
- EasyLife/EasyWorkouts: same real state, same confirmation.
- `tsf-orca` (this platform's own self-improvement run): observed
  `ACTIVE`/`VERIFYING` during tonight's Command dogfood -- real,
  independent, out of this mission's scope, left untouched.
- Live desktop backend: `LIVE_RUNTIME_STALE` (honest, correct,
  self-reported), UI bundle current and ready, awaiting a restart.

## 18. Final tsf/main / fork SHA

`2785e4396ff5792594f9871be3ee62090623d553` on both `tsf/main` (canonical,
`C:\TSF_ORCA`) and `fork` (`scolety1/orca`) -- confirmed matching via
`git ls-remote fork tsf/main`.

## 19. Final worktree inventory

- `C:/TSF_ORCA` -- canonical, `tsf/main` @ `2785e4396f`
- `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/dataset-research-engine-v0`
  -- pre-existing, unrelated to this mission, left untouched
- All 4 of this mission's own worktrees (resource-wait-auto-resume-v1,
  stale-ui-build-prevention-v1, appshell-responsive-v1,
  ui-rebuild-test-scope-fix-v1) retired via `git worktree remove --force`
  + branch deletion after merge.
- The two real, provisioned wave-1 Orca worktrees for Nytheria/EasyLife
  (from the prior mission, still real and clean) are kept, unchanged,
  ready for their now-seeded `pendingDispatch` to actually use once
  admitted.

## 20. Top remaining TSF priorities

1. Restart the live desktop backend (owner action or natural Orca
   restart) so tonight's fixes -- especially auto-resume -- take effect
   for the process Tim actually uses.
2. Once resources allow a real dispatch, observe whether
   `RESUMED_PENDING_DISPATCH` genuinely carries Nytheria/EasyLife's first
   wave all the way through -- the real, full end-to-end proof this
   session could only get partway to under sustained real host pressure.
3. Investigate and fix the pre-existing "STALE ACTION RACE" test finding
   (§12) when a session has the budget for it, or let the native
   self-improvement loop pick it up.
4. Consider whether Command needs a real `PAUSE_CANDIDATE`-style
   multi-action intent (§6's disclosed gap) if "pause X" is operator
   language Tim actually wants to use.

---

NWR_TOUCHED = NO

EXISTING_NYTHERIA_RUN_REPLACED = NO

EXISTING_EASYLIFE_RUN_REPLACED = NO

RESOURCE_BLOCKED_RUNS_AUTO_RESUME = YES

STALE_UI_CAN_SILENTLY_LAUNCH = NO

MOBILE_APPSHELL_USABLE = YES

AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION_ENABLED = NO

CLEANUP_V1_REAL_AUTHORITY_ENABLED = NO

ZERO_RELAY_4_HOUR_RUN_COMPLETE
