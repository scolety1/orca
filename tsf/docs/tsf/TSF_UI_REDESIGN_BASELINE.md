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
| HQ | `/` | "What needs me right now, across everything?" | `HQPage.tsx` | `GET /api/work`, `/api/attention`, `/api/portfolio` | Needs You / Active Work / Active Research / Ready for Adoption tiles; NEEDS YOU cards (planner, self-improvement finding, project execution hold); Recently Completed | Provider capacity panel, resource pressure, active-runs indicator | none found | The GlobalRunStatusIndicator's own "Active runs: N" badge blends literal Keep Going runs with merged attention extras (resource pressure, adoption candidates) under one count/label -- intentional by design, but worth an owner read on whether "Active runs" is the right label for that mixed bag. |
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
