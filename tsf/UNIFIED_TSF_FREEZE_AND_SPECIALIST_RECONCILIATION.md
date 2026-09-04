# Unified TSF — Freeze + Specialist-Lane Reconciliation

Non-invasive adoption-prep record while the final hands-on pilot waits on
host memory. No push, no merge/adoption, no deploy, no live TSF mutation,
no writes into any specialist lane's worktree.

## 1. Freeze status

- **Frozen candidate**: `16c8b7e530` (tsf-unified-platform-v1)
- **Status**: `TSF_COMMAND_V1_READY_FOR_TIM`
- **Worktree**: clean (`git status --short` empty, verified at freeze time)
- No further Command functionality will be added unless Tim's hands-on
  pilot exposes a real defect.
- **Blocker**: host memory pressure (0.53 GB free / 15.11 GB total, 16
  concurrent peer sessions observed) — not a known product defect. Do not
  repeatedly relaunch the pilot while RAM remains critically low.
- **Resource-pressure ownership**: Orca Cleanup / Resource Management HQ.
  Not investigated or remediated from this worktree; no processes were
  touched or terminated from here.

## 2. Specialist-lane map (real, current, as of this freeze)

| Lane | Worktree | Branch | HEAD | Status |
|---|---|---|---|---|
| Dataset + Deep Research HQ | `dataset-research-engine-v0` | `tsf/feature/dataset-research-engine-v0` | `61e6f99d75` | Active — 57 commits ahead of `tsf/main`, all customer-mission data/docs work (NWR historical redraft, FFA/nflverse acquisition, coverage/validation) |
| Web Source Acquisition / Scraper Capability HQ | `Web-Source-Acquisition-Orca-HQ` | `Web-Source-Acquisition-Orca-HQ` | `2613be403c` | Not yet started — HEAD equals `tsf/main`, no lane-specific commits yet |
| Orca Cleanup / Resource Management HQ | `Orca-Cleanup-Resource-Management` | `Orca-Cleanup-Resource-Management` | `2613be403c` | Not yet started — HEAD equals `tsf/main`, no lane-specific commits yet |
| Live accepted main | `C:/TSF_ORCA` | `tsf/main` | `2613be403c` | Clean; unified candidate is a real fast-forward descendant (57 commits ahead, zero divergence) |

Main Unified Platform (this worktree) owns: shared contracts, generic
capability boundaries, Command integration, eventual reconciliation/
adoption of specialist capabilities, and conflicts between specialist
proposals. It does not duplicate implementation owned by the three lanes
above.

## 3. Cross-lane contract-conflict check

Verified directly against real git history (`git merge-base`, `git diff
--stat` scoped to `domain/ server/ contracts/ providers/ adapters/`),
not inferred:

- **Dataset + Deep Research HQ**: merge-base with this candidate is
  `182c123f5e`. Since that point, dataset-research-engine-v0's 57 commits
  touch **zero** files under `domain/`, `server/`, `contracts/`,
  `providers/`, or `adapters/` — every change is customer-mission data,
  fixtures, or docs. Every shared-engine change since the same merge-base
  is on the Unified side only (Command V1 rounds 2–4). **No real contract
  conflict exists today.**
- **Web Source Acquisition / Scraper Capability HQ** and **Orca Cleanup /
  Resource Management HQ**: both worktrees are still sitting exactly at
  `tsf/main`'s HEAD — no lane-specific commits exist yet, so there is
  nothing to conflict with.

**Finding: no genuine cross-lane integration conflict exists at this
freeze.** This will need re-checking once any lane produces its own
engine-touching work — this doc's git-based method (merge-base + scoped
diff-stat) is the fast way to re-verify it later without a live
merge attempt.

## 4. REQ-002 — cross-mission Platform Learning Ledger

- **Classification**: `GENERIC_GAP`
- **Filed by**: Dataset + Deep Research HQ (`dataset-research-engine-v0`,
  commit `8915d525ed`, `DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`)
- **Current state**: Dataset Research continues using its mission-scoped
  fallback (`fixtures/nwr-historical-redraft-results/platform-learning-ledger.json`).
  No competing implementation has been built in Unified Platform.
- **Reconciliation plan**: Main TSF (this lane) will design the generic
  cross-mission Platform Learning Ledger once Dataset Research HQ
  produces a concrete requirement/evidence (real recurring learning that
  the mission-scoped fallback cannot serve). No action needed here until
  then.

### 4a. Addendum — possible second generic gap (evidence only, not yet filed)

Dataset + Deep Research HQ reports (2026-09-04, after this freeze) a
reclassification data point: authenticated-session UI-provenance capture
was originally scored `CUSTOMER_SPECIFIC` (tied to one source's own
settings shape), but a re-verification pass across four independent
seasons/sources all showed the identical YELLOW `temporallyVerified`
status for the identical reason — provenance established by owner
directive, but no independent `source_as_of` chain-of-custody found in
the artifact itself. That recurrence across unrelated seasons/sources is
evidence the underlying need (a generic "temporal chain-of-custody
strength" concept, independent of any one source's settings) may be
cross-cutting rather than one-off.

**Status here: logged only, not classified, no implementation started.**
No formal REQ has been filed for this by Dataset Research HQ yet (REQ-002
above remains the only filed item). Reconciliation on this waits for the
same thing REQ-002 does — a concrete requirement/evidence packet from the
owning lane — consistent with §4's stated plan.

## 5. Pilot launch procedure (kept current)

Reuses the prior pilot's real onboarded TEST projects (temp git repos
still on disk) in a fresh, empty state file — no stale chat/run/mission
history. Port 4620 chosen because 4610 is occupied by another live
process on this host (not touched).

```
TSF_API_PORT=4620 TSF_UI_STATE_FILE="C:\Users\codex-agent\orca\workspaces\TSF_ORCA\tsf-unified-platform-v1\tsf\server\.local-state\operator-state.PILOT-cmdv1-final.json" node server/http-server.mjs
```

Then open `http://127.0.0.1:4620`. Seeded projects:
`tsf-pilot-28a3754d06-test-project`, `-test-worldforge`, `-test-nwr`
(repos under `%TEMP%`).

## 6. Adoption readiness (reuses the real gate, `domain/self-update-adoption.mjs`'s `assessAdoptionReadiness`)

| Condition | Status | Evidence |
|---|---|---|
| `candidateIsFastForward` | ✅ true | `tsf/main` (`2613be403c`) is a real ancestor of `16c8b7e530`, 57 commits ahead, zero divergence |
| `candidateWorktreeClean` | ✅ true | `git status --short` empty in this worktree at freeze time |
| `liveMainClean` | ✅ true | `git status --short` empty in `C:/TSF_ORCA` (the live `tsf/main` checkout) |
| `independentReviewGreen` | ⏳ **outstanding** | Automated adversarial self-review done every round; Tim's own hands-on pilot (the real independent check) is the one still pending, blocked on host memory only |
| `requiredTestsGreen` | ✅ true | Command-family 207/207; full server suite 1532/1533 (1 pre-existing, isolated-confirmed flaky, unrelated file); UI typecheck/build/tests clean |
| `orcaCoreDeltaZero` | ✅ true | `foundation-health` reports `status: PASS`, `upstreamCoreDeltaCount: 0` |

**Net: 5/6 green. The sole outstanding gate is Tim's independent
hands-on pilot** — which is exactly the step blocked on memory, not a
code or review gap. Once that pilot runs clean (or any real defect it
finds is fixed and reverified), `assessAdoptionReadiness` is expected to
return `{ ready: true }` with no further engineering wave required.

## 7. Rollback

`createAdoptionReceipt` (same module) already records
`rollbackAvailable: true` on every real adoption. If Tim later adopts
this candidate and needs to roll back: `previousHead` is `tsf/main`'s
current HEAD, `2613be403c`. No adoption has been authorized or performed
from this freeze — this section documents the mechanism already in code,
not an action taken.

## 8. Capability inclusion map — in Unified Platform now vs still external

**Already included in this candidate (`16c8b7e530`):**
- Command V1 (global + per-project): intent taxonomy, actionable
  follow-ups, back-references, explanatory follow-ups, multi-project
  quantifiers, GLOBAL_ADVISORY, NEEDS_YOU_QUERY, self-repair authority
- Command ↔ Keep Going bridge (pause/resume/dispatch via chat)
- Command ↔ Dataset Research bridge: create/continue, status/
  completeness/artifacts/conflicts, paid-provider advisory + scoped
  grant, cancel, conversational mission-context resolution
- Dataset Research engine itself (mission lifecycle, Research Library
  reuse, Source Library, reconciliation, schema-versioning) — merged
  from `dataset-research-engine-v0` as of `c7989cdfa9`
- Operator Hardening V2, Command + Operator integration (Operator
  Stabilization V1) — both merged
- Health Repair, Prepare for Work, Safe Update Manager runtime-identity
  checks, security scanning, worker/verifier eval packs

**Still external — owned by a specialist lane, not duplicated here:**
- Any NWR-specific dataset acquisition/decision beyond what's already a
  generic ResearchMission capability — stays in Dataset + Deep Research HQ
- Generic source-acquisition router, `WEB_TABLE_SOURCE_ADAPTER`, access/
  rights preflight, public-web extraction — not yet started anywhere;
  will land via Web Source Acquisition / Scraper Capability HQ
- Governed resource-management capability (workspace/process/RAM/disk
  auditing + safe cleanup) — not yet started anywhere; will land via
  Orca Cleanup / Resource Management HQ
- The generic cross-mission Platform Learning Ledger (REQ-002, §4) —
  deferred pending Dataset Research HQ's concrete requirement
