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

*(none currently -- findings 2-16 moved to Resolved / Good as-is below,
per `TSF UI FINDINGS #2-#16 -- RECONCILE & UPGRADE`, 2026-09-15.)*

## Settled (batch ready for a fix prompt, not yet requested)

*(none yet)*

## Resolved

| # | Screen/Route | Classification | Finding | Resolution |
|---|---|---|---|---|
| 1 | `/projects/niners-war-room` (Planner Chat) | BUG (safety-relevant) | See row 1's original text above (unmodified for the record). `TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1`: traced every real execution/dispatch path down to the domain layer -- most were already correctly hold-aware (`tickKeepGoingRun`, `chat-dispatch-bridge.mjs`, `chat-http-routes.mjs`'s `dispatchFromChat`, `RELEASE_HOLD`'s own narrow regex trigger, `live-planner.mjs`'s `--tools ""` pure-text-only conversational fallback -- the actual path most of the real incident's messages hit). Found and closed the real gap: `startKeepGoingRun`/`resumeKeepGoingRun`/`abandonKeepGoingStalledWave` had zero hold awareness, and confirmed it was live-reachable via ordinary phrasing ("Resume work.", "Continue the overnight product advance.") through `classifyRunActionVerb` -> the canonical action-executor -> `resumeProjectRun` -- a held project's paused run genuinely resumed end to end over the real `/api/chat` route before the fix (mutation-tested proof, not assumed). Fixed at the domain layer (`keep-going-controller.mjs`) plus 4 call sites that were building a fake opState missing the hold data. 405 targeted + ~3579 full-suite regression tests green. Real NWR hold/run independently reconfirmed untouched throughout. | commit `be8a341d05`, full record in `TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1.md` |
| 2 | HQ (`/`) | BUG | Needs You tile undercount -- `HQPage.tsx`'s headline omitted `researchNeedsYou.length` from the sum even though the rendered card list included it. Fixed: headline now sums all three real sources (`needsYouProjectCount + researchNeedsYou.length + otherNeedsYou.length`), proven equal to the rendered card count for multiple cross-source combinations. | worktree commit `a8d8d22f48` on `tsf/codex-ui-reconcile-upgrade` (not yet merged to canonical `tsf/main` -- see Adoption status below) |
| 3 | Command (`/command`) | BUG | Natural fleet-status phrasings ("what is everyone doing right now?" and close variants) now answer from the same canonical `fleetWorkStatus`/`fleetResearchStatus` data `WHAT'S RUNNING` already reads -- broadened `chat-responder.mjs`'s STATUS pattern and `command-scope-classifier.mjs`'s deterministic `GLOBAL_STATUS` fallback with the same regex alternative, and sharpened the live classifier's system prompt to stop confusing a plain status question with `GLOBAL_ADVISORY`. Live-confirmed in a real browser dogfood pass (isolated runtime): "What is everyone doing right now?" now returns a real, grounded fleet-status answer instead of a "couldn't tell which project" fallback. | worktree commit `a8d8d22f48` |
| 4 | Command (any project) | BUG / UX PROBLEM | Two-part fix. (a) Broadened `EXTERNAL_HOLD_SOURCE` (`domain/command-act-model.mjs`) to recognize "put X on hold" and subject-first "a separate process is working on it" -- live-confirmed: "Put Weird Talent Marketplace on hold, a separate process is working on it." now durably sets a real hold ("Held -- ... (recorded, releasable later)"), mirrored into `chat-responder.mjs`'s per-project STATUS pattern. (b) New honest "NO ACTION WAS TAKEN" fallback (`server/command-action-ambiguity-fallback.mjs`) for an action-shaped request (a stop/halt/kill/abort/terminate/quit verb, used as a genuine directive) that every real action classifier still declines -- live-confirmed: "Halt it." now returns `**NO ACTION WAS TAKEN.**` with an explicit ask for the project+action, instead of silently falling through to an unrelated status answer. Reuses `chat-responder.mjs`'s own genuine-directive judgment (generalized into `messageContainsGenuineDirectiveFor`), never a second parser. | worktree commits `5a54dad3c8`, `a8d8d22f48` |
| 5 | HQ, Work, Projects, Command (`WHAT'S RUNNING`) | UX PROBLEM | New canonical `domain/owner-primary-state.mjs` (`WORKING`/`WAITING`/`NEEDS_YOU`/`DONE`, with an active execution hold always winning `WAITING`/`Execution hold` except against a genuinely-finished `DONE` item) is now the one collapse HQ (`operator-work-cards.ts`), Command (`fleet-work-status.mjs` and every `command-responder.mjs`/bridge caller), and Project Overview (`onboarded-project-projection.mjs`/`project-catalog.mjs`) all read. **Not yet applied to the Projects-page grid's own `LifecycleBadge`/`classifyProjectLifecycle`** (`ui/src/lib/project-lifecycle.ts`) -- that surface still computes its own, separate 8-bucket vocabulary that also folds health into the lifecycle word (e.g. `NEEDS_REPAIR`), a real, disclosed remaining gap against this finding's own "apply consistently across HQ, Work, Projects, Project Overview, Command" requirement. Live-confirmed for HQ/Command/Project Overview: a held project now reads `WAITING`/`Execution hold` identically in HQ's Waiting section, Project Overview's banner, and is correctly excluded from Active Work. | worktree commit `a8d8d22f48`; Projects-grid gap disclosed, not fixed |
| 6 | `/projects/:id` Overview tab | UX / IA PROBLEM | New `ProjectPrimaryStateBanner`, prominently rendered at the top of Overview (before the tab strip), showing the project's real `primaryState`/`primaryReasonLabel` -- the same canonical fields Findings #5/#7 wire everywhere else, never re-derived here. Live-confirmed: a held project's Overview now reads `WAITING` / `Execution hold`, matching this finding's own worked example format exactly. | worktree commit `7cc1d9f6f1` |
| 7 | HQ, Work "Active Work" bucket | UX PROBLEM | `operator-work-cards.ts`'s `ACTIVE_STATES` set included `PAUSED` (a legacy carry-over); active/waiting bucketing now derives from `primaryState` instead. Live-confirmed: the held `weird-talent-marketplace` project no longer appears under Active Work, correctly appears under a renamed, broadened "Waiting" section with an `Execution hold` reason badge. | worktree commit `a8d8d22f48` |
| 8 | Projects list, Project Detail Release section | UX PROBLEM | `ProjectCard.tsx`'s card footer now shows the real `release.stable.branch` (plain language) instead of a raw SHA prefix. Project Detail's Release card now leads with Branch/Testing/Adoption/Published in plain language; exact Stable/Previous Stable/Upgrade commit+tree identity moved into a new, reusable `AdvancedDisclosure` component (a collapsed native `<details>`) -- never deleted. Live-confirmed on two real projects: card footer reads a branch name, Overview's "Advanced: exact commit identity" disclosure expands to show the real SHA/tree with its existing copy button intact. | worktree commit `5a614bd376` |
| 9 | `/projects/niners-war-room` Overview tab | IA PROBLEM | Recent Decision card was already plain-language (unchanged). Onboarding card's Orca-registration-check and exact analysis timestamp (the two fields that read as engineering mechanics rather than owner summary) moved into the same `AdvancedDisclosure`. Maturity/Alignment/unfinished-summary/upgrade-backlog fields were already reasonably plain-language and are unchanged. | worktree commit `987c6717a3` |
| 10 | `/projects/niners-war-room?tab=keep-going` | IA PROBLEM | `KeepGoingTickForm.tsx`'s worktree/agent placement fields moved into the same `AdvancedDisclosure`, collapsed by default -- ordinary use of the "Run now" form (work item id, scope, optional spec) no longer requires engaging with placement at all. Worktree stays a real, required field with no fabricated default -- `hasExplicitPlacement`'s own safety history (a prior silent default resolved to the coordinator's own working directory, not the project's) is exactly why no default is introduced here either; the existing client-side validation error already tells an operator who forgets it to provide one. | worktree commit `5a614bd376` |
| 11 | HQ | IA PROBLEM | State (lifecycle) and Health are now two visually distinct elements everywhere Finding #6 touched: Project Overview's `ProjectPrimaryStateBanner` (state) sits separately from the existing `StatusChip` (health) in the header; HQ's own "Waiting"/"Project Health" sections were already visually separate and remain so. Live-confirmed: the held, `DEGRADED`-health `weird-talent-marketplace` project shows `WAITING` (state) and `DEGRADED` (health) as two independent, non-contradictory signals, both on HQ and on its own Overview page. **Same disclosed gap as Finding #5**: the Projects-grid `LifecycleBadge` still folds health into its own lifecycle word in some buckets (`NEEDS_REPAIR`), which is exactly the kind of state/health mixing this finding warns against -- not fixed on that one surface. | worktree commit `7cc1d9f6f1`; Projects-grid gap disclosed, not fixed |
| 12 | HQ (disposable) | GOOD AS-IS | Re-verified live in this batch's own dogfood pass: empty states (`No active work`, `No active research`, `Nothing waiting`) still use icon + heading + helpful next-step subtext, including the two new/reworded ones this batch introduced. No regression. | re-verified against worktree commit `987c6717a3` |
| 13 | `/projects/tsf-ui-capability-check` | GOOD AS-IS | Re-verified live: the `FIXTURE` badge, "Not a real project" description, and "Fixture only: no repository exists on disk." / "Decisions here never touch a real project." restrictions all still render exactly as before. Not expanded, per this mission's own explicit instruction. | re-verified against worktree commit `987c6717a3` |
| 14 | Command (`/command`) | GOOD AS-IS | Re-verified live: `Targeting: [chips]` still renders under multi-project and resolved single-project answers (confirmed across several real chat turns this batch's own dogfood pass exercised). Command's own role explanation was not re-read verbatim this pass but its rendering code was not touched by this batch. | re-verified (Targeting chips) against worktree commit `987c6717a3`; role-explanation text not independently re-read this pass |
| 15 | HQ Needs You -> Research card (disposable) | GOOD AS-IS | **Not independently re-exercised in this batch's dogfood pass** (no active research mission existed in the disposable fixture data used) -- but no file in this batch's diff touches `command-research-bridge.mjs`, the research Needs You resolution route, or its own UI component, so no regression risk was introduced. Flagged honestly rather than claimed as re-verified. | not touched by this diff; not independently re-exercised |
| 16 | Project Detail Overview (real projects) | GOOD AS-IS | Re-verified live: the fixture project's own plain-language description ("Exercises the real Adopt / Request Revision / Reject code path...") still renders prominently under the title, unchanged position/styling, above the new `ProjectPrimaryStateBanner`. | re-verified against worktree commit `987c6717a3` |

### Adoption status (as of 2026-09-15)

Implemented and tested in an isolated worktree (`tsf/codex-ui-reconcile-upgrade`,
`C:\tsf-codex-ui-reconcile`), **not yet merged/pushed to canonical `tsf/main`**.
Real backend suite: 3578/3585 passing (the 5 failures are pre-existing,
unrelated, host-timing/resource-governor integration tests -- one already
documented in `overnight-control-plane-queue.md`, the other four confirmed
to have zero references to any file this batch touched, running while a
peer session was concurrently busy on this shared machine). Real browser
dogfood completed against an isolated disposable runtime (port 4711,
isolated state file, real owner instance never touched) -- see individual
rows above for what was live-confirmed. A real Codex adversarial-review
dispatch was run (session `01a0a6f4-5f41-7730-a1dc-7cf378f6b0c7`, real
tool calls against this diff and a real live-executed probe script) but
exhausted its own step budget before producing a formatted findings
report; one genuine finding was extracted from its raw transcript and
independently re-verified below.

**Disclosed, not-yet-fixed gaps** (none introduced by this batch's own
diff -- all pre-existing, found while verifying it):
- The Projects-grid `LifecycleBadge` (Findings #5/#11, above).
- A pre-existing divergence between Command's `NEEDS_YOU_QUERY`
  (`buildFleetAttentionItems`, filtered to `NEEDS_OWNER`) and HQ's own
  Needs You count (`buildOwnerWorkItems`-derived) -- live-observed during
  this pass's own dogfood ("What needs me?" answered "nothing" while HQ's
  tile read 2).
- **(Found by the Codex adversarial review, independently re-verified)**
  `domain/command-act-model.mjs`'s `VERB_REGISTRY`-based multi-action
  decomposer has no genuine-directive/question-awareness at all (unlike
  `chat-responder.mjs`'s own `isGenuineDirective`) -- a genuine question
  ("Should I put niners-war-room on hold?", "Should I leave niners-war-room
  alone?", "Should I hold off on niners-war-room?", "Should I pause
  niners-war-room?", "Should I keep niners-war-room going overnight?",
  "Should we assess niners-war-room?") is misclassified as the real
  directive and can set a genuine, durable hold/pause/dispatch from a
  question alone. Confirmed pre-existing and NOT specific to this batch's
  own two new hold-phrase additions -- the exact same false positive
  already existed on the original "leave X alone"/"hold off"/"pause"
  phrasings, live-reproduced via a real `decomposeMultiAction` call.
  Lower severity than it first appears: the system fails toward MORE
  caution (an accidental hold/pause blocks future dispatch; it does not
  cause one), the opposite direction from Finding 1's original safety
  gap. Out of this batch's scope -- `command-act-model.mjs` is a large,
  separately-hardened surface (its own CASE-31/CASE-32 history) shared by
  PAUSE/RESUME/KEEP_GOING/ASSESS/adoption-decline, not something to
  rush-fix inside a UI-findings batch. Recommended as its own, dedicated
  follow-up finding.

## Personal preference / Good as-is (recorded, not acted on)

*(none yet)*
