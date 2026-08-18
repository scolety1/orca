# TSF Orca First Real Project Pilot V1

## Verdict

`GREEN_TSF_ORCA_FIRST_REAL_PROJECT_PILOT_READY_FOR_ADOPTION`

The Orca-based successor understood one real repository, selected a useful bounded mission from current evidence, produced an isolated candidate through real Orca workers, accepted one verifier-driven correction, passed an independent final verifier and Orca-native browser QA, and stopped before adoption. No source-branch mutation, merge, push, deployment, publication, outreach, CRM action, customer-data access, or other real-project access occurred.

## 1. Pilot project identity

- Project: Colety Labs Sales Engine
- Project ID: `colety-labs-sales-engine`
- Source: `C:\Users\codex-agent\Documents\ChatGPT\Idea Incubator\colety-labs-sales-engine`
- Lifecycle: local Idea Incubator project
- Purpose: evidence-first website audit, prospect discovery, and operator review using local/synthetic inputs
- Registration: `tsf/pilots/first-real-project-v1/project-registration.json`
- Pilot Work Set: this was the only real project

## 2. Starting repository identity

- Branch: `codex/mission-4-prospect-discovery`
- HEAD: `6b8790bedfd56c0c75e71e9edef14e475f3211c3`
- Tree: `0ce0df1cad78bf387290e504ffd78aae46116b6b`
- Status: clean; no staged, unstaged, or untracked files
- Active Git operation: none
- Baseline: typecheck PASS, build PASS, 34/34 tests PASS
- Runtime/package requirements were satisfied with the existing project-local dependency set; no dependency was added.

The source repository remained on this exact branch/HEAD/tree throughout the pilot.

## 3. Host and successor preflight

The exact abandoned pnpm install was re-observed by executable path, command line, start time, and parent/child identity before its proven orphan tree was terminated. No unrelated Node, PowerShell, Codex, Orca, Sales Engine, or system process was stopped.

After cleanup there was no heavy install/setup task or worker farm. `C:\TSF_ORCA` was clean at `a846f6d10e54c2845d4ba9506d569039207ecbc2`; Orca remained v1.4.184 on upstream commit `2307f2ebbe1c1e737c0b12d920bb0a208332db2c`; legacy TSF was clean at `c702a373b39ea6b2e451788da82ed0437811dfc3`.

## 4. Research-first planner

- Role: `PLANNER_DEEP`
- Effective Usage Mode: `BALANCED`
- Provider/agent/model: OpenAI / Codex / `gpt-5.6-sol` high
- Preferred Claude planner was unavailable, so the configured `CODEX_SAFE` fallback was used; provider diversity is not claimed.
- Orca session: `term_2c649832-4bd5-43d0-95b8-2a05f380b3d4`
- Orca Run: `run_502251c2543e`
- Worktree: `tsf-pilot-m5-planner`
- Planner commit: `233582878e712400a32a8836b0004e26cf713872`

The planner read README/HQ, architecture and evidence docs, product/roadmap, package/build configuration, recent Missions 1–4 history, current storage/API/UI/source, and tests. It distinguished current behavior, synthetic-only behavior, unfinished Mission 5 work, deferred features, and explicit exclusions.

## 5. Selected mission and rationale

Mission: **Operator Evidence Review and SCREENING-vs-DEEP Comparison**.

Repository truth validated the historical Mission 5 candidate. Linked SCREENING/DEEP evidence and lineage already existed, but operators could inspect the runs only separately and could not persist finding-level dispositions. The chosen slice was local-only, dependency-free, covered by existing storage/API/UI seams, achievable with two sequential scopes, and explicitly excluded collectors, scoring, CRM, outreach, real data, providers, deployment, and architecture rewrite.

Two schema-valid `TSF_PLAN_CAPSULE_V1` artifacts bounded backend and UI scopes. Their paths and hashes are in `planner-evidence.json`.

One compact-contract friction was found during final evidence audit: the planner artifacts' recorded `baselineTree` did not equal the actual tree of their recorded baseline HEAD. Execution remained safe because coordinator binding overrides and worker preflights used the exact commit and clean worktrees, but semantic head-to-tree validation should be added before broader rollout.

## 6. Workers and Orca isolation

### Backend ledger/comparison

- Task: `task_b37bd57f625a`; dispatch `ctx_7be7b8ab1dcd`
- Session: `term_b56dd3a5-71ea-4ad9-b47b-628978256961`
- Worktree/branch: `tsf-pilot-m5-backend`
- Commit: `8b8339f657ae000a6295e1ba1b93b1c3dbf6d892`
- Outcome: schema-v6 append-only reviews, ownership and immutability guards, bounded review API, neutral linked comparison, lineage/terminal checks, zero-finding control, and migration tests

### UI review lane

- Task: `task_2546e8e6f4f5`; dispatch `ctx_b843a45f7413`
- Session: `term_a6b11d04-0168-4c31-91ed-20a897c3b7ed`
- Worktree/branch: `tsf-pilot-m5-ui`
- Commit: `e581c9218669df781dc1b8aee7773ead2cd5b713`
- Outcome: server-authoritative SCREENING/DEEP review surface, accessible save states, immutable history, provenance views, honest healthy control, and responsive stacking

The UI worker briefly attempted a local Chrome check despite the coordinator-owned Orca-browser requirement. The coordinator stopped that path, the worker removed its temporary listeners/logs, and no browser result was accepted from it.

### Verifier correction

- Task: `task_92666a452632`; dispatch `ctx_3fc6c87d45db`
- Session: `term_804603ac-b82c-494d-9b77-7aec4e92c166`
- Worktree/branch: `tsf-pilot-m5-api-revision`
- Commit: `8069d0070d3a0b088609ea45bcd42ec9984275a2`
- Outcome: malformed JSON now returns 400 and oversized request bodies return 413; unexpected errors remain 500

All implementation workers used isolated Orca worktrees. No worker edited the accepted source checkout.

## 7. Candidate identity and files

- Candidate branch: `tsf-pilot-m5-integration`
- Candidate worktree: `C:\Users\codex-agent\orca\workspaces\colety-labs-sales-engine\tsf-pilot-m5-integration`
- Candidate HEAD: `50f9ce1fc5a462e168b1490391a02aa44ea63690`
- Candidate tree: `578ee5cd359be686131a1f60e5e94b669b7f6049`
- Candidate status: clean

Changed paths:

- `app/evidence-review.tsx`
- `app/globals.css`
- `app/sales-engine.tsx`
- `server/api.ts`
- `server/evidence-review/compare.ts`
- `server/evidence-review/service.ts`
- `server/evidence-review/types.ts`
- `server/storage/database.ts`
- `tests/evidence-review/evidence-review.test.ts`
- `tests/storage/database.test.ts`

No dependency, port, provider, collector, scoring, discovery, CRM, outreach, deployment, or production behavior changed.

## 8. Tests and integration gates

- Scoped Prettier with Windows line-ending accommodation: PASS
- ESLint: PASS
- TypeScript client/server checks: PASS
- Focused evidence-review verifier suite: 6/6 PASS
- Full serialized Vitest: 9 files, 41/41 PASS
- Production build: PASS
- `git diff --check`: PASS
- Candidate worktree: clean

One default parallel Vitest attempt earlier lost a worker process; the bounded serialized suite passed consistently. The pilot therefore records serialized execution as the reliable Windows gate for this repository.

## 9. Independent verifier

The independent verifier used session `term_f7a8de22-c564-4edf-bf57-77ee470f5b39` in worktree `tsf-pilot-m5-verifier`, with no source changes and no browser.

Its first pass correctly failed the candidate because malformed and oversized request bodies mapped to generic 500 responses. After the single bounded correction, the same independent session directly proved 400/413 behavior, reran focused and full gates, reconfirmed append-only ownership/lineage, neutral classifications, zero-finding behavior, UI semantics/accessibility, and reported `PASS — READY_FOR_BROWSER_QA`.

Durable final task `task_170ba8e98173`, dispatch `ctx_35aea9aa114d`, completed GREEN with message `msg_ee14fffc7cab`. The verifier checkout and integration candidate have identical tree `578ee5cd...`.

## 10. Orca-native browser evidence

- Runtime: Orca 1.4.184, runtime `40c4c89d-4cec-4902-b49b-c6c9dca875a7`
- Browser page: `28bcd976-0cce-4ecf-a552-ed55ebaf2e6e`
- Origin: loopback-only `http://localhost:3000/`
- Data: disposable synthetic SQLite records only

Desktop 1440×900 showed two clearly labeled SCREENING/DEEP columns, exact run identities, neutral caveats, evidence provenance, and Lighthouse lab-not-field language without horizontal overflow.

The operator save path was exercised end to end. With only the browser tab offline, save failed visibly with `Failed to fetch`, retained the exact draft note, and created zero false history. Restoring the local tab saved `accepted`, created one LOCAL_OPERATOR history entry, and a full reload restored disposition, note, actor, timestamp, and history.

The Northstar synthetic zero-finding pair rendered zero findings/evidence/opportunities, no review form, and explicitly declined to manufacture a problem.

At 390×844, run and comparison grids stacked to one column, all controls stayed within the viewport, six native form labels remained exposed, and document scroll width equaled client width.

The page console contained only Vite connection and React development information. Orca's browser shim recorded no-URL `Cannot redefine property: webdriver` automation-injection noise after reload; no application-originated error was present.

Full machine-readable evidence is in `browser-proof.json`.

## 11. Release and adoption state

- Stable: source branch remains unchanged at `6b8790be...`
- Upgrade: exact candidate `50f9ce1f...`
- Testing: GREEN on exact candidate tree
- Published: unchanged; no publication action
- Mission: `READY_FOR_ADOPTION`
- Adoption: `PENDING_TIM`

Worker completion, integration, verifier completion, and browser completion did not modify Stable. No merge or adoption has occurred.

## 12. Pilot efficiency metrics

- Time from Orca mission Run creation (21:54:59 MDT) to durable final verifier/browser/adoption gate: about 82 minutes
- Tim interruptions: 0
- Planner episodes: 1
- Implementation workers: 3
- Worker retries: 0
- Verifier correction cycles: 1
- Independent verifier sessions: 1 persistent session, re-engaged under a fresh final task
- Runtime recovery events: 1 transient endpoint/daemon recovery; no product work lost
- Human copy/paste: 0
- Provider usage: not reported by available telemetry
- Heavy installs during mission: 0

## 13. Errors, recovery, and friction

- The authorized abandoned pnpm process tree was precisely identified and stopped before the pilot.
- One Orca endpoint recovery required stopping only a stale Orca terminal daemon and creating the missing current-day local session directory. Runtime/task/worktree state survived.
- Non-escalated CLI calls can falsely look unattached because the Windows named pipe is outside the filesystem sandbox; elevated read-only control calls remain required.
- `core.autocrlf=true` creates CRLF-only Prettier noise in fresh Windows worktrees. Focused checks with `--end-of-line auto` plus `git diff --check` avoided unrelated rewrites.
- Orca left a newly created verifier task pending despite its dependency already being completed; the coordinator made the explicit safe `ready` transition before dispatch.
- Vinext production start does not expose the Vite local API proxy; browser QA used the documented dev UI and the same built candidate.
- A disposable fixture initially reused a canonical URL and was correctly deduplicated by the product; the API was stopped, the fixture identity corrected, and QA resumed.
- During final successor validation, one root-level `npm test` selected Orca's upstream package instead of the TSF overlay and stopped immediately because the source checkout intentionally lacks native dependencies. It left no installer or dependency change; the correct direct TSF suite then passed 20/20.

## 14. Comparison with legacy TSF operation

Orca owned the commodity runtime: worktrees, branches, terminal/session identities, task/dispatch records, worker processes, browser, and recovery. TSF supplied mission intent, project/Work Set boundary, compact plan/result evidence, verifier/adoption gates, release identity, and receipts.

This avoided recreating the legacy PowerShell launch pipeline, mirror engine, browser runner, process ownership layer, and per-command approval choreography. The remaining friction was mostly Windows CLI attachment, line endings, and a few thin semantic/admission gaps rather than a second runtime control plane.

## 15. Capability migration feedback

Genuinely useful:

- exact project/source preflight and single-project Work Set;
- persistent planner versus bounded workers;
- compact scope/acceptance capsules;
- Orca worktree/session ownership;
- independent verifier with one correction cycle;
- Stable/Upgrade/Testing separation;
- explicit human adoption authority;
- lightweight receipts and native browser evidence.

Still missing or awkward:

- semantic assertion that a capsule's `repository.tree` is the tree of `repository.head`;
- a reusable real-project profile/command discovery service rather than planner-only inspection;
- first-class persisted real-project registration and pilot state through the TSF domain API;
- smoother durable verifier-revision transitions without a manual `ready` state correction;
- filtering of Orca browser-shim errors from application error evidence;
- a human adoption surface for reviewing exact candidate, verifier, browser proof, and decision.

No legacy capability was removed; the 111-capability manifest still totals 111.

## 16. Recommendation

Recommend Tim review and adopt this exact candidate into the project's accepted branch only if the product direction remains desired. Confidence is high because the scope is additive and local, 41/41 tests and build pass, the verifier found and closed a real defect, browser behavior is proven on synthetic desktop/mobile controls, and Stable remained untouched.

Do not broaden to a second real project until Tim decides this adoption and the compact-capsule head/tree semantic check is scheduled. The host is otherwise safe for another controlled run after the local pilot processes are stopped.
