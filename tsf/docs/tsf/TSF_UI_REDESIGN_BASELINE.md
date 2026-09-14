# TSF UI Redesign Baseline

Produced by the TSF Reconcile & Upgrade Protocol V1's Lane 6 objective
UI dogfood pass (2026-09-12), against the real, rendered UI (an
isolated dev instance + disposable state -- never the owner's real
running instance or real project data). Intended for the **separate,
owner-led UI review** to understand current implementation before
making any navigation/layout/visual-hierarchy/color/typography/IA
decisions -- this document deliberately makes none of those decisions
itself.

**Coverage**: HQ, Work, Projects (list + detail), More, Fleet Planning,
Evaluation, Health Repair Center, the Command dock. Not covered this
pass: Agents, individual project detail sub-tabs beyond Overview
(Keep Going/Research/Health/Estimate/Flight Recorder/Adoption/
Evidence/Receipts), first-run/setup flow (no fresh-install path was
exercised -- the isolated instance still bootstrapped 4 pilot
projects from repo-committed fixtures, so a genuinely first-run/empty
state was not observed).

## Screen map

| Screen | Route | Primary owner job | Component | Data source | Owner-facing state | Advanced/internal state | Known objective bugs | UI-review questions |
|---|---|---|---|---|---|---|---|---|
| HQ | `/` | "What needs me right now, across everything?" | `HQPage.tsx` | `GET /api/operator-snapshot` (one coherent read, live-updated via `GET /api/operator-events` SSE -- migrated from three separate `/api/work`+`/api/attention`+`/api/portfolio` fetches; those legacy routes remain available for other callers) | Needs You / Active Work / Active Research / Ready for Adoption tiles; NEEDS YOU cards (project, **research -- now inline-answerable**, planner, self-improvement finding, project execution hold); Recently Completed | Provider capacity panel, resource pressure, active-runs indicator | none found | The GlobalRunStatusIndicator's own "Active runs: N" badge blends literal Keep Going runs with merged attention extras (resource pressure, adoption candidates) under one count/label -- intentional by design, but worth an owner read on whether "Active runs" is the right label for that mixed bag. |
| Work | `/work` | "What's actually happening to my projects right now?" | `WorkPage.tsx` | `GET /api/work` | Active / Verifying / Needs You-Blocked / Ready for Adoption / Recently Completed buckets | Coding vs. Research filter | none found | none |
| Projects | `/projects` | "Show me everything TSF knows about, let me act on several at once" | `ProjectsPage.tsx` + `ProjectCard.tsx` | `GET /api/portfolio` | Card grid: lifecycle badge, health badge, Fleet/Work Set membership, why/next explanation, stable-head SHA + testing status chip | Bulk selection, filters, sort | Card titles truncate with an ellipsis at narrow widths (884px test width) -- plausible standard responsive behavior, not confirmed at a representative desktop width; noted, not fixed. | The card's top lifecycle badge and its own bottom-right testing-status chip can both independently read "BLOCKED" for the same project (two genuinely different real dimensions -- lifecycle bucket vs. CI/testing status -- that happen to share vocabulary). Truthful, but a real point of owner confusion worth a naming pass. |
| Project detail | `/projects/:id` | "Everything about this one project" | `ProjectDetailPage.tsx` (tabbed) | `GET /api/portfolio`, per-tab endpoints | Overview: fleet membership, mission/blocked reason, baseline, release (stable/upgrade SHAs, testing, adoption, published state), recent decision, restrictions, Planner Chat | 9 tabs: Overview/Keep Going/Research/Health/Estimate/Flight Recorder/Adoption/Evidence/Receipts | The 9-tab bar visually clipped its last 1-2 tabs at an 884px test window, with no visible scroll/overflow affordance (the tabs remain in the DOM/reachable via keyboard, just not visually indicated). Not confirmed at a representative desktop width -- the browser-resize tool available this pass did not reliably change the actual screenshot capture size, so this could not be re-verified wider. | Worth a real-browser check at common desktop widths (1280-1440px) specifically for tab-bar overflow behavior. |
| More | `/more` | Discover advanced/internal surfaces | `MorePage.tsx` | static | Fleet, Agents, Evaluation, Health Repair Center, Command (full page) links, each with a one-line description | -- | none found | none |
| Fleet Planning | `/fleet` | "Build and launch an overnight schedule across my Work Set" | `FleetPage.tsx` | `GET /api/portfolio`, `/api/work` | Work Set checkbox/priority list, live-run badges, "Start Overnight Fleet" (selected or whole Work Set), schedule results (`ProjectScheduleCard`) | Max concurrent agents (Windows safety) input | **FIXED THIS PASS**: the Work Set checkbox list showed raw internal project ids (`weird-talent-marketplace`) instead of display names -- the same bug class already fixed once in this file's own `ProjectScheduleCard`, just never applied to this sibling list. See `fix(tsf-ui): Fleet Planning's project checkbox list showed raw internal ids, not display names`. | none |
| Evaluation | `/evaluation` | "Is TSF's own planner/agent/verifier/routing quality regressing?" | `EvaluationPage.tsx` | `GET /api/eval` | 11 real eval packs (including the new `reconcile-upgrade-disposable-pilot`, confirmed live-wired), run history, regression check | -- | none found | none |
| Health Repair Center | `/health-repair` | "Fleet-wide health scan and bulk repair" | `HealthRepairCenterPage.tsx` | `GET /api/health-repair/scan` (reads `opState.onboardedProjects`, a store distinct from `portfolio.knownProjects`) | Fleet summary, per-project repair class, "Repair selected" | Baseline verification (opt-in, per-project) | Showed "No Known Projects yet / Onboard a project first" despite 4 real projects existing in the portfolio (`portfolio.knownProjects`) -- because none of this pass's fixture projects had gone through the separate onboarding/analysis step that populates `opState.onboardedProjects`. **Not confirmed as a real product bug**: a real owner's projects normally go through the real "Add Project" onboarding flow, which would populate both stores together, so this gap may be purely an artifact of how this pass's disposable fixture data was seeded (bypassing onboarding), never actually reachable in real use. Recorded as an open question, not patched, per the protocol's own "do not invent bugs to justify continued work" rule. | Worth a real, owner's-own-data check: does "Known Projects" (Projects page) and "Onboarded Projects" (Health Repair Center) ever legitimately diverge in real use, and if so, should the empty-state copy here distinguish "no known projects" from "no onboarded/analyzed projects" (the two are objectively different real states today)? |
| Command dock | persistent, every page | "Ask/direct TSF about anything, from anywhere" | `CommandDockProvider` + dock component | `GET/POST /api/chat/__command__` | Minimized floating trigger (bottom-right) always present; opens to a full composer with planner identity, TSF self-repair-mode toggle, suggestions | "Full view" (expand to a dedicated page) | none found (the header "Ask Command" button appeared not to open the dock on one attempt, but a following click on the floating trigger worked correctly and cleanly -- inconclusive, likely this pass's own tooling interference rather than a real product bug; not filed) | none |

## Objective bugs found this pass

- **P2 (fixed, `6f5051e54d`)**: Fleet Planning's Work Set list rendered
  raw internal project ids instead of display names. Real, reproduced,
  fixed by reusing the file's own existing `displayNameById` lookup,
  verified live against the rendered fix.
- No P0/P1 objective bugs found (broken controls, uncaught errors,
  broken deep links, untruthful status, dead-end Needs-You items) in
  the screens covered this pass.

## Explicitly not evaluated (belongs to the owner's separate UI review)

Navigation structure, layout, visual hierarchy, color, typography,
information architecture, and the two genuine-but-subjective naming
questions raised above (the BLOCKED/BLOCKED coincidence on Projects
cards; the Known-vs-Onboarded distinction on Health Repair Center).
This pass made no redesign decisions and changed no visual design.

## Update: TSF Final Pre-UI P1 Closure V1 (2026-09-13/14) -- new realities

Two real backend/product-completion gaps a fresh post-coherence audit
found were closed this pass (P0=0, P1=2 at audit time). Recorded here so
the owner-led UI review starts from what is now REAL, not from the same
gaps this document's own screen map described above.

**Project → Goal → Work is now backed by real canonical data.**
`domain/owner-goal-model.mjs` (new) projects a real `OwnerGoal` for every
Keep Going run and ResearchMission, derived from the run/mission's own
real `originalGoal`/`specification.researchQuestion` -- restart-stable
identity, never re-minted when Tim authorizes a real goal-content
replacement. `GET /api/operator-snapshot`'s own `goals` field is real
(was `[]`); every Work item's `goalId` resolves to a real entry there. A
run-less legacy project has no goal (honestly unscoped, never a
fabricated "General work" placeholder) -- this is a real, current-state
fact for the UI review to know, not a bug. **No visual Goal display was
built** -- the shape exists and types are real
(`ui/src/lib/operator-snapshot-types.ts`'s `OwnerGoal`), but whether/how
a Goal appears anywhere in the UI is a genuine, subjective IA decision
left entirely to the owner-led review.

**Needs You is now fully cross-source resolvable from the normal owner
surface.** `action-executor.mjs`'s `RESOLVE_NEEDS_YOU` is source-aware
(PROJECT/RESEARCH/PLANNER) -- one canonical mutation authority for all
three. HQ's own "Needs you" section now renders a real, inline
answer/submit form for a research mission's own open question
(`ResearchNeedsYouCard.tsx`, mirrors the pre-existing `PlannerNeedsYouCard`
exactly) -- previously a permanent, non-clickable dead end. Real,
browser-validated end to end: answering resolves the mission, HQ updates
live via the existing SSE channel, no manual refresh. Command's own
natural-language resolution ("Answer that with X.") was deliberately NOT
built this pass (a genuine scope decision, not an oversight -- the
mission brief's own explicit caution against inventing ambiguous
natural-language execution rules without existing referential/authority
protection) -- a real, bounded, next-session-ready follow-up if the owner
wants it.

**Still explicitly open, for the owner-led review to decide (unchanged
from before this pass, restated so the ledger stays self-contained):**
- Research WAITING placement (a research mission's own resource-wait
  state currently renders under "Active Research", not a separate
  "Waiting for resources" section the way a Keep Going run's WAITING
  does -- a real, deliberate divergence preserved during the HQ Snapshot
  Migration, not accidental, but still a real IA question: should it
  stay that way?).
- Project Detail's implementation-shaped tab bar (Overview/Keep
  Going/Research/Health/Estimate/Flight Recorder/Adoption/Evidence/
  Receipts) -- whether this is the right IA for an owner (vs. grouping
  some of these under a single "Inspect/Advanced" surface) is unchanged
  from this document's own original screen map above.
- Technical/subsystem plumbing (research `phase` badges, Keep Going
  `liveWorkFeed` internals, the raw `source` a Needs You question came
  from) belongs under Inspect/Advanced in whatever shape the owner
  review settles on -- the backend now exposes `source`
  (PROJECT/RESEARCH/PLANNER) on demand but never forces it into the
  primary owner-facing surface (HQ's cards show the real question, never
  "this came from subsystem X" unless the owner review decides that
  belongs there).

No visual redesign was performed. No navigation, layout, color, or
typography decision was made. Backend/product architecture for these two
areas is now considered frozen pending real owner dogfood, a failing
owner flow, a verified reliability defect, a security/safety finding, or
a new explicit product requirement -- not "a competitor has feature Y."
