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

*(none logged yet -- ready for the first screenshot)*

| # | Screen/Route | Classification | Finding | Screenshot/evidence | Baseline cross-ref |
|---|---|---|---|---|---|

## Settled (batch ready for a fix prompt, not yet requested)

*(none yet)*

## Resolved

*(none yet)*

## Personal preference / Good as-is (recorded, not acted on)

*(none yet)*
