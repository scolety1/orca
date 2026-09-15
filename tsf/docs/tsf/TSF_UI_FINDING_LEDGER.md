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

Findings 1-16 below are from `TSF_REAL_OWNER_UI_DOGFOOD_ROUND_1`
(2026-09-15), the first pass against the **real, rendered** UI through a
real browser connector -- real owner instance for the read-only findings
(1-11), an isolated disposable runtime (`TSF_DISPOSABLE_RUNTIME=1`) for
the interaction-tested findings (12-16). Logged by the dogfood pass
itself, not the owner's own screenshot commentary -- per this ledger's
own Authority section, the owner's read of these findings (agree,
reclassify, or dismiss) is what actually settles them, not this entry.

**Finding 1 is a safety-relevant observation, not an ordinary UI
finding** -- flagged first and separately because of its severity; see
the note directly below the table.

| # | Screen/Route | Classification | Finding | Screenshot/evidence | Baseline cross-ref |
|---|---|---|---|---|---|
| 1 | `/projects/niners-war-room` (Planner Chat, Overview + Keep Going tabs) | BUG | **Safety-relevant.** NWR's own Planner Chat history contains several real, escalating attempts (labeled "NWR — FULL OVERNIGHT PRODUCT ADVANCE V3") to have TSF release the real NWR `EXTERNAL_WORK_ACTIVE` execution hold and take over autonomous ownership -- each one was declined, but only because it got mis-routed to a Dataset-Research-only planner role that doesn't recognize software-mission requests, never because anything checked "is there an active hold on this project." Independently reconfirmed the hold is still intact right now. See full detail in the return report below. | Read via `get_page_text` + screenshot, both tabs | none |
| 2 | HQ (`/`) | BUG | The "Needs you" summary tile undercounts by 1 whenever a RESEARCH-sourced Needs You item is open: 4 real cards rendered in the NEEDS YOU section, tile read "3", both before and after resolving that item (tile stayed "3" throughout, list correctly dropped to 3 cards after). Real, live, reproduced via the disposable runtime's own live SSE update. | Before/after `get_page_text` capture around a real resolve action | none |
| 3 | Command (`/command`) | BUG | Asking Command the very natural status question "What is everyone doing right now?" returns an irrelevant, unhelpful answer ("Safe to mess around with... say which one you want to act on") instead of summarizing real run states -- even though the correct data is already computed correctly one section below, in the same page's own "WHAT'S RUNNING" panel. | `get_page_text` capture of the live response | none |
| 4 | Command (any project) | BUG / UX PROBLEM | A natural-sounding hold request ("put X on hold, a separate process is working on it") silently fails -- classified `GENERAL`/`AUTO_DECIDE`, bundled with unrelated attention notices, with no indication the hold wasn't understood or set. Only a narrow phrasing ("is being handled by another AI/agent/process", "leave it alone", "hold off") actually triggers the real `EXTERNAL_WORK_HOLD` action -- confirmed by retrying with that exact phrasing, which worked correctly. | Two real chat calls compared, disposable runtime | none |
| 5 | HQ, Work, Projects, Command (`WHAT'S RUNNING`) | UX PROBLEM | The SAME real project/run state gets a different bucket label depending which screen you're on. A PAUSED run reads "ACTIVE" on HQ/Work ("Active work" bucket, card text "run state is PAUSED"), "WAITING" on Command's own status panel, and "PAUSED" on the Projects card's lifecycle badge. Reproduced with both the real `niners-war-room` (Projects: "PAUSED"; HQ/Work: "ACTIVE"... run state is PAUSED) and a seeded `paused-proj` in the disposable runtime (HQ/Work: "ACTIVE"; Command: "WAITING"). | Screenshots + text captures across all 4 surfaces | Screen map row "Work"/"Projects" |
| 6 | `/projects/:id` Overview tab | UX / IA PROBLEM | A project's execution hold (or any open Needs You) is invisible on its own Project Detail Overview tab -- the single "everything about this project" page never mentions it. It only surfaces on HQ's Needs You section, or by clicking into the Keep Going sub-tab specifically. Reproduced on the real `niners-war-room` page. | Screenshot + full `get_page_text` of Overview tab | none |
| 7 | HQ, Work "Active Work" bucket | UX PROBLEM | "Active Work" includes projects that are PAUSED and/or under an active execution hold, with no hold indicator on that card itself (the hold only shows in the separate Needs You section). An owner scanning only "Active Work" would not know a listed project is actually on hold. Reproduced on real `niners-war-room` and seeded `held-proj`. | Screenshot + `get_page_text`, both real and disposable instances | none |
| 8 | Projects list, Project Detail Release section | UX PROBLEM | Every project card, and the Release section of Project Detail, shows a raw truncated git SHA with no label (e.g. `58060e1462`) -- a real implementation-detail leak per the ledger's own plumbing-exposure rule. | Screenshot, `/projects` list | Plumbing-exposure rule |
| 9 | `/projects/niners-war-room` Overview tab | IA PROBLEM | "RECENT DECISION" and "ONBOARDING" sections are dense, jargon-heavy engineering paragraphs (branch names, "Hermetic verification gate", git commit terminology) presented as primary owner-facing content, not summarized in plain language. | `get_page_text` capture | Plumbing-exposure rule; baseline's own "9-tab bar" note |
| 10 | `/projects/niners-war-room?tab=keep-going` | IA PROBLEM | An "Advanced: override worktree" control sits directly on the Keep Going tab with a raw jargon label and no plain-language explanation before interacting with it. | `find` + `get_page_text` | Plumbing-exposure rule |
| 11 | HQ | IA PROBLEM | A project (e.g. `easylifehq.github.io`, `Landing Page`) can appear simultaneously under "Recently Completed / ADOPTED" and "Project Health / DEGRADED" with no visual link explaining these are different dimensions (historical event vs. current health), not a contradiction. Same pattern as the baseline doc's already-recorded BLOCKED/BLOCKED finding, different concrete instance. | Screenshot, HQ bottom section | Baseline doc, "Projects" row |
| 12 | HQ (disposable) | GOOD AS-IS | Empty states (`No active research`, `Nothing blocked`, etc.) consistently use an icon + heading + helpful next-step subtext. No change wanted. | Screenshots, real + disposable | none |
| 13 | `/projects/tsf-ui-capability-check` | GOOD AS-IS | A purpose-built, clearly `FIXTURE`-labeled, safe-to-exercise Adoption-flow demo project ("Not a real project -- no repository, no push, no adoption authority") ships directly in the real product, letting the Adopt/Request Revision/Reject path be exercised with zero risk to real project history. Excellent pattern; recommend keeping and possibly extending to other flows. | Screenshot | none |
| 14 | Command (`/command`) | GOOD AS-IS | Command's own top-of-page description is honest and plain-language about its own architecture ("it never runs a second execution engine of its own"), and multi-project answers show a `Targeting: [chips]` summary under the response so it's unambiguous which projects were addressed. No change wanted. | Screenshot | none |
| 15 | HQ Needs You -> Research card (disposable) | GOOD AS-IS | Inline Research Needs You resolution (real textarea + submit) works correctly end to end: durable state matches the UI's claim, and the resolved item disappears from Needs You while the mission reappears under Active Research live via SSE within ~3s, with zero manual refresh. Verified via a real interaction + durable-state cross-check, not just visual inspection. | Before/after screenshots + `get_page_text`, durable-state API cross-check | Update: TSF Final Pre-UI P1 Closure V1 section above |
| 16 | Project Detail Overview (real projects) | GOOD AS-IS | Project descriptions in plain, owner-authored language (e.g. Niners-War-Room's own summary) read clearly and are genuinely useful context, distinct from the jargon-heavy sections noted in finding 9. No change wanted. | Screenshot | none |

**On finding 1**: this is not something to fix tonight -- per this
mission's own explicit "do not reopen frozen backend architecture unless
the browser pass proves a real objective defect" and "no subjective UI
redesign," and because it touches request routing/safety-check
architecture, not UI presentation. It is recorded here because it was
discovered during UI dogfood and belongs in the same durable evidence
trail; see the full write-up in the mission's own return report for the
complete quoted transcript and reasoning.

## Settled (batch ready for a fix prompt, not yet requested)

*(none yet)*

## Resolved

*(none yet)*

## Personal preference / Good as-is (recorded, not acted on)

*(none yet)*
