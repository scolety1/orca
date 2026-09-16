# TSF UI Finding & Design Ledger

Durable record of the owner-led UI review, opened 2026-09-12. Distinct
from `TSF_UI_REDESIGN_BASELINE.md` (a one-time, objective, browser-
dogfooded snapshot of current implementation) -- this ledger is the
**live log** of what the owner finds while dogfooding the real TSF UI
and sending screenshots, and where a finding sits until it's ready to
become a bounded implementation brief.

## Authority

The baseline doc is evidence. **The owner's own screenshots and
decisions in the review chat are the design authority.** This ledger
records the owner's calls; it does not second-guess them.

## Classification taxonomy

Every finding gets exactly one of these, assigned honestly (a subjective
taste call is `PERSONAL PREFERENCE`, not `UX PROBLEM`, even when it's a
real, valid preference):

- **BUG** -- the UI is factually wrong, broken, or lying (a broken
  control, an uncaught error, stale/untruthful status, a dead link).
- **UX PROBLEM** -- objectively harder to use than it should be for the
  owner's real job on that screen (confusing flow, unclear affordance,
  a real point of friction), independent of visual taste.
- **INFORMATION-ARCHITECTURE PROBLEM** -- the wrong thing lives in the
  wrong place, or internal/advanced machinery leaks into ordinary owner
  flow (see the plumbing-exposure rule below). Judge against the target
  organizing model: **Project · Goal · Work · Waiting · Needs You ·
  Done**, not against implementation structure.
- **VISUAL-POLISH ISSUE** -- objectively rough execution of an
  otherwise-right idea (misalignment, inconsistent spacing/weight,
  clipping) -- not a request for a different look.
- **PERSONAL PREFERENCE** -- a real, legitimate owner taste call with no
  objective defect underneath. Recorded and honored, never argued with.
- **GOOD AS-IS** -- reviewed, no change wanted. Recorded so it's never
  re-litigated or "fixed" by mistake later.

## Plumbing-exposure rule

Orca/worktree/worker/provider-level language and controls (branch
names, worktree paths, provider/agent ids, dispatch/verification
internals, receipt/checkpoint mechanics) do not belong in ordinary owner
UX. They are legitimate under an **Advanced / Inspect** surface, never
on the primary Project · Goal · Work · Waiting · Needs You · Done
path. Any finding where implementation machinery leaks into ordinary
flow is classified `INFORMATION-ARCHITECTURE PROBLEM` by default.

## Product target

Linear-level calmness + Devin/Factory-level orchestration + TSF-level
governance. Ordinary TSF should read as **Project · Goal · Work ·
Waiting · Needs You · Done**, not as implementation machinery.

## Workflow

1. Owner sends a screenshot (or several) with commentary.
2. Each real observation gets logged below as its own row: classified,
   described, evidence noted (screenshot description + baseline
   cross-reference if applicable). No implementation work starts from
   a single screenshot.
3. Findings accumulate under **Open** until the owner says the batch is
   coherent/settled (or asks to settle it).
4. On "make the fix prompt": the owner names which settled finding(s)
   to turn into a bounded implementation brief. That brief follows the
   real TSF Reconcile & Upgrade Protocol V1 (`TSF_RECONCILE_AND_UPGRADE_
   PROTOCOL_V1.md`) -- RESEARCH/RECONCILE what already exists before
   proposing a change -- and is delivered as its own artifact, not
   silently implemented here.
5. Once implemented and adopted, a finding moves to **Resolved** with
   the real commit SHA(s).

## Open

*(Round 2 real-owner dogfood findings #17/#18 -- and the legacy-held gap
Codex found while fixing them -- are now Resolved, below. #19-21 remain
open/deferred by explicit instruction. #22 is new, found live during the
`TSF_REAL_PROJECT_PILOT_READINESS_V1` mission's own rehearsal, and NOT
fixed -- see that mission's own section below the Resolved table for full
context on both.)*

| # | Screen/Route | Classification | Finding | Evidence |
|---|---|---|---|---|
| 19 | Projects grid `LifecycleBadge` | UX PROBLEM | When `primaryReasonLabel` is present, the badge shows only that reason text (e.g. "Ready for adoption," "Paused"), never the literal primaryState word -- correct by design, and correctly color-coded (verified against the API: a `NEEDS_YOU`-class item like `Landing Page` renders in the same warning color as a literal "NEEDS YOU" badge) -- but a card whose reason text doesn't itself say "needs you" relies solely on badge color to convey that urgency, a real scanability/color-reliance concern. | real owner instance (`Landing Page`), canonical `08a5023db6` |
| 20 | `/projects/niners-war-room?tab=keep-going` | VISUAL-POLISH ISSUE | Three related-but-different status labels appear in quick succession on one screen: the top `ProjectPrimaryStateBanner` ("WAITING / Execution hold"), the Keep Going section's own header badge ("PAUSED," the raw run state), and a nested "WORK FEED" card ("WAITING" + "run state is PAUSED" + a "Drill down" link). Not incorrect -- Keep Going is explicitly a deeper technical view -- but reads as mildly redundant. | real owner instance (NWR), canonical `08a5023db6` |
| 21 | Projects grid card title | VISUAL-POLISH ISSUE | A long display name truncates mid-word on the grid card title (e.g. "R2 Fixture: Done + Degr…") with no tooltip/full-name affordance observed in the screenshot evidence. | disposable fixture, worktree `77af424290` |
| 22 | Command (`/command`), any per-project conversational question about a held project | **BUG, P1** | Asking Command chat "Is `<project>` on hold?" or "Why is `<project>` waiting?" about a project under a REAL, active execution hold gets a confident, detailed, **false denial** ("No — it's not on hold... there's no blocker, escalation, or pause flag against it"), even though the same Command instance's own deterministic "what needs me?" answer correctly reports the hold for the identical project. Root cause (independently confirmed by a real, bounded Codex adversarial review, session id in the closure mission's own report below): a genuine, non-imperative question about a named project classifies as `GENERAL`/`QUESTION` and routes to a live-LLM call (`invokeLivePlanner`, `server/live-planner.mjs`) whose prompt-building (`buildProjectContextCapsule`/`operatorFacts`) never includes the project's execution-hold record or its own canonical `primaryState` -- the model is structurally unable to ground an answer in the real hold and confidently denies it. **Confirmed NOT a mutation-safety issue**: the dispatch-time safety gate (`chat-dispatch-bridge.mjs`, `keep-going-controller.mjs`, `keep-going-dispatch-loop.mjs`) is a separate, unconditional check that still correctly refuses to start/resume work on a held project regardless of what the conversation said -- verified by real, passing tests. Pre-existing (confirmed via `git diff` empty for every file in this code path across the closure mission's own commits), not introduced or worsened by that mission. Real, reproducible, live-verified on a disposable fixture with a real hold. **Not fixed** -- out of scope for the mission that found it (narrowly scoped to Findings #17/#18); flagged here as a genuine trust/safety concern for the next dedicated finding. | disposable fixture (`TSF-REHEARSAL-BETA`), worktree `tsf/readiness-closure-v1` |

**Re-confirmed GOOD AS-IS:** real, persisted Command chat history predating this closure work correctly still shows the pre-unification vocabulary (chat history is immutable by design, not a live bug) -- a returning owner scrolling back will see two vocabularies mixed across time; expected, not a defect.

## Settled (batch ready for a fix prompt, not yet requested)

*(none yet)*

## Resolved

| # | Screen/Route | Classification | Finding | Resolution |
|---|---|---|---|---|
| 1 | `/projects/niners-war-room` (Planner Chat) | BUG (safety-relevant) | See row 1's original text above (unmodified for the record). `TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1`: traced every real execution/dispatch path down to the domain layer -- most were already correctly hold-aware (`tickKeepGoingRun`, `chat-dispatch-bridge.mjs`, `chat-http-routes.mjs`'s `dispatchFromChat`, `RELEASE_HOLD`'s own narrow regex trigger, `live-planner.mjs`'s `--tools ""` pure-text-only conversational fallback -- the actual path most of the real incident's messages hit). Found and closed the real gap: `startKeepGoingRun`/`resumeKeepGoingRun`/`abandonKeepGoingStalledWave` had zero hold awareness, and confirmed it was live-reachable via ordinary phrasing ("Resume work.", "Continue the overnight product advance.") through `classifyRunActionVerb` -> the canonical action-executor -> `resumeProjectRun` -- a held project's paused run genuinely resumed end to end over the real `/api/chat` route before the fix (mutation-tested proof, not assumed). Fixed at the domain layer (`keep-going-controller.mjs`) plus 4 call sites that were building a fake opState missing the hold data. 405 targeted + ~3579 full-suite regression tests green. Real NWR hold/run independently reconfirmed untouched throughout. | commit `be8a341d05`, full record in `TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1.md` |
| 2 | HQ (`/`) | BUG | Needs You tile undercount -- `HQPage.tsx`'s headline omitted `researchNeedsYou.length` from the sum even though the rendered card list included it. Fixed: headline now sums all three real sources (`needsYouProjectCount + researchNeedsYou.length + otherNeedsYou.length`), proven equal to the rendered card count for multiple cross-source combinations. | worktree commit `a8d8d22f48` on `tsf/codex-ui-reconcile-upgrade` (not yet merged to canonical `tsf/main` -- see Adoption status below) |
| 3 | Command (`/command`) | BUG | Natural fleet-status phrasings ("what is everyone doing right now?" and close variants) now answer from the same canonical `fleetWorkStatus`/`fleetResearchStatus` data `WHAT'S RUNNING` already reads -- broadened `chat-responder.mjs`'s STATUS pattern and `command-scope-classifier.mjs`'s deterministic `GLOBAL_STATUS` fallback with the same regex alternative, and sharpened the live classifier's system prompt to stop confusing a plain status question with `GLOBAL_ADVISORY`. Live-confirmed in a real browser dogfood pass (isolated runtime): "What is everyone doing right now?" now returns a real, grounded fleet-status answer instead of a "couldn't tell which project" fallback. | worktree commit `a8d8d22f48` |
| 4 | Command (any project) | BUG / UX PROBLEM | Two-part fix. (a) Broadened `EXTERNAL_HOLD_SOURCE` (`domain/command-act-model.mjs`) to recognize "put X on hold" and subject-first "a separate process is working on it" -- live-confirmed: "Put Weird Talent Marketplace on hold, a separate process is working on it." now durably sets a real hold ("Held -- ... (recorded, releasable later)"), mirrored into `chat-responder.mjs`'s per-project STATUS pattern. (b) New honest "NO ACTION WAS TAKEN" fallback (`server/command-action-ambiguity-fallback.mjs`) for an action-shaped request (a stop/halt/kill/abort/terminate/quit verb, used as a genuine directive) that every real action classifier still declines -- live-confirmed: "Halt it." now returns `**NO ACTION WAS TAKEN.**` with an explicit ask for the project+action, instead of silently falling through to an unrelated status answer. Reuses `chat-responder.mjs`'s own genuine-directive judgment (generalized into `messageContainsGenuineDirectiveFor`), never a second parser. **Closure Gate 2**: `command-act-model.mjs`'s `VERB_REGISTRY` multi-action decomposer (a separate surface from `chat-responder.mjs`'s STATUS pattern above) previously had no genuine-directive/question-awareness at all -- a deliberative question ("Should I put X on hold?") could set a real, durable hold. Fixed via a new, position-anchored `isGenuineDirectiveAt(message, position)` (`chat-responder.mjs`) reused by `command-act-model.mjs`'s `finalIntentFor`, never a second parser/executor; a genuinely-authorizing DIRECT REQUEST still executes, a DISCUSSING/ADVISORY question never does. Live-confirmed twice (a deliberative "Should I put NWR on hold?" leaves the project untouched; the direct "Put NWR on hold." sets a real, durable hold) plus a fresh, previously-untested verb (RESUME) exercised live this closure pass with the same result. | worktree commits `5a54dad3c8`, `a8d8d22f48`; Gate 2 `a8c58c04a9`; canonical `77af424290` |
| 5 | HQ, Work, Projects, Command (`WHAT'S RUNNING`) | UX PROBLEM | New canonical `domain/owner-primary-state.mjs` (`WORKING`/`WAITING`/`NEEDS_YOU`/`DONE`, with an active execution hold always winning `WAITING`/`Execution hold` except against a genuinely-finished `DONE` item) is now the one collapse HQ (`operator-work-cards.ts`), Command (`fleet-work-status.mjs` and every `command-responder.mjs`/bridge caller), and Project Overview (`onboarded-project-projection.mjs`/`project-catalog.mjs`) all read. **Closure Gate 3A**: the Projects-page grid's own `LifecycleBadge` now reads `project.primaryState`/`primaryReasonLabel` directly (same canonical truth), never a separate mapping -- `classifyProjectLifecycle`/`project-lifecycle.ts` is kept only as internal filter/sort granularity for `LifecycleFilterBar`, no longer the grid's own owner-facing badge. Live-confirmed: a held project shows `EXECUTION HOLD` on the Projects grid, matching HQ/Command/Project Overview exactly; a fresh Working/Paused/Waiting-for-Resources/Done+Degraded fixture set (this closure pass) agrees identically across HQ, Work, Projects, and Command. | worktree commits `a8d8d22f48`, `64c16c2466` (Gate 3A); canonical `77af424290` |
| 6 | `/projects/:id` Overview tab | UX / IA PROBLEM | New `ProjectPrimaryStateBanner`, prominently rendered at the top of Overview (before the tab strip), showing the project's real `primaryState`/`primaryReasonLabel` -- the same canonical fields Findings #5/#7 wire everywhere else, never re-derived here. Live-confirmed: a held project's Overview now reads `WAITING` / `Execution hold`, matching this finding's own worked example format exactly. | worktree commit `7cc1d9f6f1` |
| 7 | HQ, Work "Active Work" bucket | UX PROBLEM | `operator-work-cards.ts`'s `ACTIVE_STATES` set included `PAUSED` (a legacy carry-over); active/waiting bucketing now derives from `primaryState` instead. Live-confirmed: the held `weird-talent-marketplace` project no longer appears under Active Work, correctly appears under a renamed, broadened "Waiting" section with an `Execution hold` reason badge. | worktree commit `a8d8d22f48` |
| 8 | Projects list, Project Detail Release section | UX PROBLEM | `ProjectCard.tsx`'s card footer now shows the real `release.stable.branch` (plain language) instead of a raw SHA prefix. Project Detail's Release card now leads with Branch/Testing/Adoption/Published in plain language; exact Stable/Previous Stable/Upgrade commit+tree identity moved into a new, reusable `AdvancedDisclosure` component (a collapsed native `<details>`) -- never deleted. Live-confirmed on two real projects: card footer reads a branch name, Overview's "Advanced: exact commit identity" disclosure expands to show the real SHA/tree with its existing copy button intact. | worktree commit `5a614bd376` |
| 9 | `/projects/niners-war-room` Overview tab | IA PROBLEM | Recent Decision card was already plain-language (unchanged). Onboarding card's Orca-registration-check and exact analysis timestamp (the two fields that read as engineering mechanics rather than owner summary) moved into the same `AdvancedDisclosure`. Maturity/Alignment/unfinished-summary/upgrade-backlog fields were already reasonably plain-language and are unchanged. | worktree commit `987c6717a3` |
| 10 | `/projects/niners-war-room?tab=keep-going` | IA PROBLEM | `KeepGoingTickForm.tsx`'s worktree/agent placement fields moved into the same `AdvancedDisclosure`, collapsed by default -- ordinary use of the "Run now" form (work item id, scope, optional spec) no longer requires engaging with placement at all. Worktree stays a real, required field with no fabricated default -- `hasExplicitPlacement`'s own safety history (a prior silent default resolved to the coordinator's own working directory, not the project's) is exactly why no default is introduced here either; the existing client-side validation error already tells an operator who forgets it to provide one. | worktree commit `5a614bd376` |
| 11 | HQ | IA PROBLEM | State (lifecycle) and Health are now two visually distinct elements everywhere Finding #6 touched: Project Overview's `ProjectPrimaryStateBanner` (state) sits separately from the existing `StatusChip` (health) in the header; HQ's own "Waiting"/"Project Health" sections were already visually separate and remain so. Live-confirmed: the held, `DEGRADED`-health `weird-talent-marketplace` project shows `WAITING` (state) and `DEGRADED` (health) as two independent, non-contradictory signals, both on HQ and on its own Overview page. **Closure Gate 3A** closed the same gap on the Projects grid: `LifecycleBadge` now shows only `primaryState`/`primaryReasonLabel`, with health shown as its own separate badge, never folded together. Re-verified live this closure pass with a `DONE`+`DEGRADED` fixture (state and health render as two independent badges on the Projects grid). | worktree commit `7cc1d9f6f1`; Gate 3A `64c16c2466`; canonical `77af424290` |
| 12 | HQ (disposable) | GOOD AS-IS | Re-verified live in this batch's own dogfood pass: empty states (`No active work`, `No active research`, `Nothing waiting`) still use icon + heading + helpful next-step subtext, including the two new/reworded ones this batch introduced. No regression. | re-verified against worktree commit `987c6717a3` |
| 13 | `/projects/tsf-ui-capability-check` | GOOD AS-IS | Re-verified live: the `FIXTURE` badge, "Not a real project" description, and "Fixture only: no repository exists on disk." / "Decisions here never touch a real project." restrictions all still render exactly as before. Not expanded, per this mission's own explicit instruction. | re-verified against worktree commit `987c6717a3` |
| 14 | Command (`/command`) | GOOD AS-IS | Re-verified live: `Targeting: [chips]` still renders under multi-project and resolved single-project answers (confirmed across several real chat turns this batch's own dogfood pass exercised). Command's own role explanation was not re-read verbatim this pass but its rendering code was not touched by this batch. | re-verified (Targeting chips) against worktree commit `987c6717a3`; role-explanation text not independently re-read this pass |
| 15 | HQ Needs You -> Research card (disposable) | GOOD AS-IS | **Not independently re-exercised in this batch's dogfood pass** (no active research mission existed in the disposable fixture data used) -- but no file in this batch's diff touches `command-research-bridge.mjs`, the research Needs You resolution route, or its own UI component, so no regression risk was introduced. Flagged honestly rather than claimed as re-verified. | not touched by this diff; not independently re-exercised |
| 16 | Project Detail Overview (real projects) | GOOD AS-IS | Re-verified live: the fixture project's own plain-language description ("Exercises the real Adopt / Request Revision / Reject code path...") still renders prominently under the title, unchanged position/styling, above the new `ProjectPrimaryStateBanner`. | re-verified against worktree commit `987c6717a3` |
| 17 | Command (`/command`) sidebar "What's running" panel | BUG | `ui/src/pages/CommandPage.tsx` now reads the canonical `primaryState`/`primaryReasonLabel` (added to `ui/src/lib/fleet-status-types.ts`'s `FleetWorkStatusItem`) instead of the raw `feed.state`/`feed.reason` -- the same values `fleetWorkStatus()` had always already computed, never a new derivation. `feed.reason` stays as the richer detail sentence underneath the primary badge. A real, bounded Codex adversarial review then found the SAME raw-vocabulary leak in a second, more prominent place this fix's own diff also touched (`GlobalRunStatusIndicator`, the always-visible app-shell widget I'd earlier mis-attributed to Orca's own shell chrome in the Round 2 entry above -- it is in fact `ui/src/components/GlobalRunStatusIndicator.tsx`, squarely TSF's own code) -- fixed the same way (optional `primaryState`/`primaryReasonLabel` on `GlobalRunStatusItem`, a new `globalRunStatusLabel()` helper, `state` untouched as the richer internal urgency-ranking signal). Live-verified on a disposable fixture set: Command's sidebar panel and chat text agree exactly ("WORKING", "WAITING (Paused)", etc). | worktree `tsf/readiness-closure-v1` commits `ac24a84354`, `8ed0b9054d` |
| 18 | Work (`/work`) "Active" section | BUG | `domain/work-feed-summary.mjs` gained a real `waiting` bucket; `projectExecutionHolds` now threads through `summarizeWork()`'s whole call chain (previously never passed to `GET /api/work` at all); an item `RUN_FEED_SECTION` still routes to `active` is redirected to `waiting` when its own already-computed `primaryState` (from the SAME `fleetWorkStatus()`/`keepGoingRunWorkItem()` call, hold-aware) isn't `WORKING` -- covers a fresh no-wave run, a paused run, a resource-wait, and a held run (even one still mechanically mid-wave, matching HQ's own already-shipped Finding #7 precedent exactly: "ANY run under a real execution hold, regardless of its own mechanical state... moves to waiting"). `WorkPage.tsx` gained a real "Waiting" section mirroring "Active"'s own card pattern. Real Codex adversarial review then found two more real gaps in the first pass of this fix (Fleet Planning's `work-feed-lookup.ts` losing status badges for everything moved out of `active`; the `GlobalRunStatusIndicator` leak noted under #17 above) -- both fixed. A second, final adversarial review then found one more: a run-LESS project (no Keep Going run at all) with legacy `mission.state` ACTIVE/PLANNING/REVIEW under a real hold still read `active` (`legacyActive`'s own bucketing never checked the hold) -- fixed by checking `isProjectExecutionHoldActive` directly and routing to a new `legacyWaiting` array. Live-verified end to end on a disposable 4-project rehearsal (Working/Execution-hold/Needs-You/Done+Degraded): HQ, Work, Projects, and Command's sidebar all agree exactly on primary state for the same project at every step, including after a live hold was set on a mid-wave project via natural language ("Put ALPHA on hold...") and after a real disposable-runtime restart (state, holds, and Needs You all durably unchanged). | worktree `tsf/readiness-closure-v1` commits `ac24a84354`, `8ed0b9054d`, `755dc42ce5`, `4b33a6e3e3` |

### Adoption status (as of 2026-09-15) -- CLOSED, ADOPTED, LIVE

`TSF UI FINDINGS #2-#16 -- CLOSURE, ADVERSARIAL REVIEW, ADOPTION + LIVE
CUTOVER`: all four closure gates below passed; the worktree branch
(`tsf/codex-ui-reconcile-upgrade`) was fast-forward-merged into canonical
`tsf/main` and pushed. **Final canonical SHA: `77af424290`** (verified
identical on the remote after push -- see below). Superseded the
"not-yet-fixed gaps" disclosed in the original Reconcile & Upgrade pass:
all three are now closed.

**Gate 1 -- real Codex adversarial review.** A new, narrower dispatch
(session `01a0a6f4-5f41-7730-a1dc-7cf378f6b0c7`, model `gpt-5.6-sol`,
provider `openai`, reasoning effort `high`, ~10-tool-call budget against a
576-line isolated diff) completed cleanly with a formal, cited report --
the prior session's broad-diff dispatch had exhausted its step budget
without one. 3 real findings, each independently reproduced before fixing
and fixed through the existing canonical seam: (1) `isGenuineDirective`'s
`TELL_ME_WHETHER` check ran after `POLITE_REQUEST_MARKER`, so "Could you
tell me whether I should pause X?" was misread as a genuine directive --
reordered, never a blanket "contains ? -> never execute" rule; (2) a
project that is simultaneously run-based-`needsYou` AND legacy-BLOCKED
double-counted in Command's "what needs me?" -- closed via an
`existingProjectIds` exclusion in `legacyNeedsYouGapItems`; (3) a run-less
`DIRTY_PRESERVE`/`SENSITIVE`/`READ_ONLY_ONBOARDING_ONLY` project collapsed
to the bare `DONE` default in `onboarded-project-projection.mjs`, losing
real information `project-lifecycle.ts` already distinguished -- reused
that same, already-settled distinction (`DIRTY_PRESERVE` -> `NEEDS_YOU`,
`SENSITIVE`/`READ_ONLY` -> `WAITING`/`Paused`). Commit `e4a5ee05e6`.

**Gate 2 -- discussion vs. authorization.** `command-act-model.mjs`'s
`VERB_REGISTRY` decomposer (the Codex-found gap above, and the
independently-disclosed one below it) now shares the same genuine-
directive judgment `chat-responder.mjs` already used, via a new,
position-anchored `isGenuineDirectiveAt(message, position)` -- never a
second parser/executor, never a naive "contains ? -> never execute" rule.
24 new unit tests (7 DIRECT REQUEST / 12 DELIBERATIVE QUESTION cases) plus
a 19-case adversarial matrix, all passing. Live-confirmed twice in this
closure pass (a deliberative "Should I put NWR on hold?" left NWR
untouched; the direct "Put NWR on hold." set a real hold) and again with a
previously-untested verb (RESUME) against a disposable fixture: the
deliberative phrasing got a real, grounded, non-mutating planner answer
and left the run `PAUSED`; the direct "Resume X." genuinely resumed it
(`PAUSED` -> `PLANNING`). Commit `a8c58c04a9`.

**Gate 3 -- reconciled, not dismissed.**
- **3A (Projects-grid `LifecycleBadge`)**: now reads `primaryState`/
  `primaryReasonLabel` directly, the same canonical truth as HQ/Work/
  Command/Project Overview -- `classifyProjectLifecycle` kept only for
  `LifecycleFilterBar`'s internal filter/sort granularity. Commit
  `64c16c2466`.
- **3B (Needs You aggregation)**: traced through the existing canonical
  `buildFleetAttentionItems`/`buildOwnerWorkItems`, never a third
  aggregator. Fixed in two passes: the original legacy-candidate/legacy-
  blocked gap (commit `cc8910de7f`, refined for the Gate 1 double-count
  finding in `e4a5ee05e6`), and a second, live-discovered divergence found
  while re-verifying this gate in the browser -- HQ's own
  `buildOtherNeedsYouItems` already treats an active execution hold as
  Needs-You-adjacent, but Command's own answer didn't; `command-global-
  scope-bridge.mjs`'s `buildFleetAttentionItems` call wasn't even passing
  `projectExecutionHolds`. Fixed by reusing the same `holdItems()` output
  the call already computes. Commit `830751ba1a`. Live-confirmed: HQ's
  tile and Command's "what needs me?" answer agree exactly (`2`, same two
  projects, same `Targeting` chips) with a real hold set on a real
  disposable fixture.

**Gate 4 -- Finding #15 (inline Research Needs You) actually exercised.**
A disposable isolated runtime was seeded with a real, open Research Needs
You question (`domain/research-mission.mjs`'s own constructors). Live in
the browser: TSF asked -> owner answered inline -> durable resolution
recorded (`openNeedsYouCount` 1 -> 0, revision advanced) -> item
disappeared from HQ's Needs You list -> research resumed -> HQ's tiles
updated live via SSE with no manual refresh (Active research 0 -> 1,
Needs you 1 -> 0). No file in this batch's diff touches the research
Needs You resolution route or its UI component; this gate proves the
existing, unmodified path still works end to end.

**Full coherence pass.** A fresh, disposable fixture set (Working, Paused,
Waiting-for-Resources, Done+Degraded Health, on top of the already-
verified Execution Hold / Needs You / Research Needs You) was live-
compared across HQ, Work, Projects, and Command in one dogfood session --
every surface agreed on the same `primaryState`/reason label for the same
project, and health (`DEGRADED`) rendered as an independent signal
alongside a `DONE` primary state, never folded together. Adversarial
language matrix spot-checked live: a STATUS query ("what is the current
state of X" / "what needs me?") never mutates; an unrecognized
action-shaped verb ("kill X") never mutates and is answered honestly, not
silently absorbed into an unrelated status reply.

**Director Diff Review** (full diff from `6f438ab229` through `77af424290`,
35 files, +2164/-464): no duplicate `primaryState` derivation (every
non-`ownerPrimaryState()` write is one of the two documented, justified
exceptions -- run-less-default and legacy fallback); no new parser/
executor; no duplicate Needs You aggregation (`legacyNeedsYouGapItems` is
a small, explicitly-scoped, reuse-only supplement, verified against every
real Needs-You-producing function in the codebase); no backend route/
endpoint addition (every touched server file's diff threads an existing
parameter into an existing call, or is a pure text/routing fix); no
technical-evidence deletion (SHA/tree fields relocated into
`AdvancedDisclosure`, never removed); no protected-finding regression
(diff-checked: `#12`/`#13`/`#14`/`#16`'s exact text is untouched by this
diff; `#15` live-verified above); no unrelated frontend redesign (all 35
files trace directly to a settled finding or a closure gate). 6 new files,
all justified: `owner-primary-state.mjs` (the one canonical source this
whole mission enforces reuse of), `command-action-ambiguity-fallback.mjs`
(Finding #4's honest fallback, reusing `chat-responder.mjs`'s own
directive judgment), `command-global-scope-bridge.mjs` (Finding #4's
global-scope extraction from `command-responder.mjs`), `AdvancedDisclosure.tsx`
(Finding #8/#9/#10's shared collapsed-detail component), plus their two
test files.

**Tests.** Full backend suite: 3305/3308 tests pass. The 3 non-passing
runs collapse to exactly 1 distinct test (`REAL AUTONOMY PROOF: ... while
a second, concurrently-failing project never blocks it`,
`keep-going-autonomy-proof.test.mjs`) -- independently reproduced against
a clean `6f438ab229` baseline worktree as the SAME pre-existing behavior,
and confirmed to pass cleanly (1/1) when run in isolation, consistent with
this shared machine's established resource-contention pattern. One real,
self-discovered issue was found and fixed during this closure pass'
own final-suite run: `platform-golden-path-eval-runner.test.mjs`'s
`operatorVisibleTextConfirmsCompletion` assertion still checked for the
bare `READY_FOR_ADOPTION` text that Finding #4's `command-global-scope-
bridge.mjs` extraction (commit `5a54dad3c8`, part of this same diff)
already replaced with the canonical `NEEDS_YOU (Ready for adoption)`
primaryState/reasonLabel pairing everywhere else in the product --
verified via a disposable baseline-commit worktree that this was
pre-existing test staleness (production text already correct and already
agreed across HQ/Work/Projects/Command), not a behavior regression. Fixed
in the test only, commit `77af424290`. UI typecheck (`tsc -b --noEmit`):
clean.

**Live cutover.** `/api/update-safety` read `SAFE_NOW` against the real
owner instance; the UI bundle was rebuilt in place to stamp `65a4b2d455`.
The actual backend-process restart was blocked in-session by the sandbox's
own process-termination policy (a genuine tooling blocker, not bypassed --
TSF deliberately ships no self-restart endpoint, see
`TSF_SAFE_UPDATE_MANAGER_V1.md`); the owner completed the restart via
Orca's own plugin reload. Post-cutover, `GET /api/runtime-identity`
confirmed `runningCommit == diskCommit == uiBundleCommit == 65a4b2d455`
(`UP_TO_DATE`). Read-only smoke checks against the now-live instance:
`update-safety` still `SAFE_NOW`; `operator-snapshot` serving 17 projects,
0 Needs You, 6 goals (unchanged shape, no data loss); NWR's own run still
`PAUSED`/`OPERATOR_PAUSED` at revision `241`, untouched throughout; a real
project's card correctly serves the new `primaryState`/`primaryReasonLabel`
fields end to end.

## TSF_REAL_OWNER_UI_DOGFOOD_ROUND_2 (2026-09-16)

Evidence-collection-only dogfood against canonical `08a5023db6` (functional
generation `65a4b2d455` -- the two commits between them are docs-only,
reconciled against the real artifact contract before starting: real owner
instance `runtime-identity` read `UP_TO_DATE` at `08a5023db6`, no stale-
runtime defect). Nothing implemented; findings #17-21 above are the new,
open output of this round.

**Real owner instance, read-only**: HQ, Work, Projects, Command (chat +
sidebar), and two materially different real Project Overviews
(`niners-war-room` -- Overview/Keep Going/Health tabs; `landing-page`)
were actually navigated and screenshotted. No real project was mutated.

**Disposable interaction instance**: a fresh isolated worktree/state file
(`tsf-codex-ui-reconcile`, port 4713, `TSF_DISPOSABLE_RUNTIME=1`) was
seeded with the full required fixture set -- Working, Waiting (Paused),
Waiting (Execution hold, run-less), Waiting (Resources), Needs You, Done,
Done+Degraded Health, Research Needs You -- and actually interacted with:
the Research Needs You question was answered inline and durably resolved
(`openNeedsYouCount` 1 -> 0, revision 1 -> 2, item moved live from Needs
You to Active Research with no manual refresh); a multi-project Command
query correctly resolved and Targeted two named fixtures. Cleaned up and
deleted after use.

**Settled findings #2-#11**: visually re-confirmed coherent on HQ,
Projects, Command's own chat replies, and Project Overview -- the one
exception is Work's own "Active" bucket (#18 above), which is a real gap
against Finding #5/#7's own acceptance criterion, not a new regression
introduced by anything after `08a5023db6`.

**Protected findings #12-#16**: no regression observed. #15 (inline
Research Needs You) was actually re-exercised end to end this round (see
above), not merely inspected.

**Primary question** ("can the owner understand Working/Waiting/why/Needs
You/Done/Health/what-changed at a glance, without TSF internals"): **yes**
on HQ, Projects, Project Overview, and Command's own chat text -- these
consistently show the plain WORKING/WAITING/NEEDS_YOU/DONE vocabulary with
clear secondary reasons, and Health renders as a visibly separate,
non-competing signal. **Not yet** on Work's own "Active" section or
Command's own sidebar "What's running" panel specifically (#17/#18) --
both still leak internal vocabulary, and Work's own miscategorization
could genuinely mislead an owner about whether a held/paused real project
(observed live: NWR) is actually being worked on right now.

No redesign performed. No owner design decision required to *read* this
evidence -- #17/#18 are factual defects (BUG) with a clear, narrow,
already-canonical fix target (read `primaryState`/`primaryReasonLabel`
instead of `feed.state`/`feed.reason` in both places) whenever the owner
chooses to request a fix prompt; #19-21 are real but lower-severity and
can wait for a normal review pass.

## TSF_REAL_PROJECT_PILOT_READINESS_V1 (2026-09-17)

Fixed Findings #17/#18 (now Resolved above, with #22 disclosed as a new,
separate, pre-existing, unfixed P1 found along the way), then ran a full
first-real-project-pilot readiness rehearsal. Full detail lives in the
mission's own final report (delivered to the owner directly); summarized
here for the ledger's own record:

**Gates**: #17 PASS, #18 PASS (both closed via two rounds of real,
bounded Codex adversarial review -- sessions `01a0aba9-7a20-7ff1-b0d9-17deb38e0036`
and a second final review, both provider `openai`/model `gpt-5.6-sol` --
which together found and led to fixing 3 additional real gaps beyond the
original two: Fleet Planning's status-badge loss, the always-visible
`GlobalRunStatusIndicator`'s own raw-vocabulary leak, and a run-less
legacy-held project still reading `active`). Clean direct-action retest
with unmistakably unique fixture names (`TSF-READINESS-ALPHA-7Q9`/
`-BETA-4M2`) closed Round 2's own overlapping-name evidence gap: a direct
action affects only its named project (byte-identical sibling state
confirmed via diff), a deliberative question never mutates. A 4-project
final rehearsal (Working/Execution-hold/Needs-You/Done+Degraded) showed
full cross-surface primary-state agreement on HQ/Work/Projects/Command
at every step, including live after setting a real hold via natural
language on a mid-wave project and after a real disposable-runtime
restart (state, holds, and Needs You all durably unchanged, no duplicate
dispatch). Real owner instance read-only pass: NWR unchanged throughout,
`PAUSED`/`WAITING`/`Execution hold` intact. Full backend suite: 3305/3308
pass; the 3 non-passing runs are all independently confirmed pre-existing
host-timing flakes (clean in isolation), zero mission regressions.

**#22 is the one real, disclosed exception to an otherwise clean
verdict**: a live-LLM-routed conversational question about a held
project's status can give a confident, false denial of the hold. Real,
reproducible, independently confirmed pre-existing (not part of this or
the #17/#18 diff) by the final Codex review, and confirmed to NOT
compromise the actual mutation-safety gate (start/resume/dispatch still
correctly refuse on a held project regardless of what the chat said) --
but a genuine trust/conversational-honesty concern the owner should be
aware of before relying on Command chat's own informational answers
about hold status specifically.

## Personal preference / Good as-is (recorded, not acted on)

*(none yet)*
