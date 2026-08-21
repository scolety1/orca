# M9–M13: Program Extension — Tim's Completed Roadmap Handoff

Recorded verbatim (lightly reformatted for Markdown) from Tim's own
message, received mid-M8-session, so this survives context compaction
and does not need to be re-derived. **Explicit instruction: do NOT
interrupt, restart, broaden, or redo the currently active milestone
(M8) because this message exists.** M8 finishes normally under the
existing program charter (acceptance criteria → immutable candidate →
independent verification → governed local ff-only adoption → receipt/
rollback identity → next milestone) before any of this takes effect.

M1–M8 remain governed by their own existing durable state, designs,
evidence, authority rules, and acceptance criteria — this message does
not reinterpret them.

Target Orca core delta across M9–M13 remains 0. Orca remains the
execution/runtime foundation; TSF remains the intelligence/project/
governance/Health/autonomy/memory/estimation/operator layer. Do not
introduce another orchestration foundation.

After M8 is GREEN and locally adopted, continue sequentially through
M9 → M10 → M11 → M12 → M13. **Do not begin M14 or invent additional
feature milestones without Tim's approval — M13 is intentionally the
end of this upgrade program.**

## M9 — Evaluation & Regression Lab

**Purpose**: measure whether planner/worker/verifier/routing/prompt/
model/provider/architecture changes actually improve or regress the
system — "this candidate planner mapping improved these tasks,
regressed these tasks, cost this much more, produced this confidence,"
not "this new model feels better."

**Source harvest**: Promptfoo and similar permissively-licensed/current
evaluation tooling — bounded current-source/license/API verification
only before implementation, no broad research phase. Harvest concepts:
datasets/test cases, expected outputs/assertions, provider/model
comparisons, side-by-side evals, regression thresholds, red-team/
adversarial cases, repeatable scoring, model/prompt comparison,
local-first execution. Do not install another orchestration runtime —
evaluate whether an existing evaluation library genuinely reduces
complexity; prefer a simple TSF-native domain layer over existing test
infrastructure if that's cleaner.

**Required capabilities**: durable, versioned evaluation packs covering
at minimum:
- **Planner evals**: decomposition quality, goal retention, project-context grounding, authority classification, recommendation quality, avoidance of previously rejected approaches.
- **Worker evals**: task completion, scope adherence, test correctness, file-boundary discipline, false-success avoidance.
- **Verifier evals**: ability to catch known planted defects, independence, false-positive rate, failure to rubber-stamp candidates.
- **Routing evals**: planner role mapping, worker role mapping, provider fallback, cost/capacity tradeoffs.
- **Memory evals**: relevant recall, project isolation, stale-fact handling, preference/decision protection.
- **Autonomy evals**: Keep Going goal retention, recovery, duplicate-work prevention, retry/stall behavior.
- **Estimator evals**: deterministic reproducibility, sensitivity, calibration behavior, no fake precision.

**Model upgrade gate**: compare CURRENT MAPPING vs CANDIDATE MAPPING
(e.g. PLANNER_DEEP: current Claude Sonnet 5 vs a candidate future
model) by running the same eval pack and reporting quality score,
regressions, improvements, cost/capacity impact, latency, confidence,
recommendation. Do not silently change production/default role
mappings merely because a newer model exists — material routing/model
changes must be evidence-backed.

**UI**: a restrained Evaluation/Regression surface — current benchmark
packs, last run, candidate vs. current, regression count,
recommendation, drill-down into failed cases. Do not turn TSF into a
benchmark dashboard product.

**Acceptance** — not GREEN until: (1) evaluation packs are versioned
and reproducible; (2) at least one planner comparison works; (3) at
least one worker regression test works; (4) at least one verifier
planted-defect test works; (5) a candidate model/prompt can fail
promotion on a regression; (6) costs/capacity are not fabricated; (7)
test cases cannot mutate real protected repos unexpectedly; (8)
historical eval results remain inspectable; (9) independent verifier is
GREEN; (10) Orca core delta remains 0.

## M10 — Security & Supply-Chain Health

**Purpose**: extend TSF Health with evidence-backed repository security
signals. Not an autonomous penetration-testing platform — a
project-health and adoption-safety capability.

**Source harvest**: Trivy (primary candidate) and, where useful, other
mature permissive scanners. Before any installation: inspect current
license, release provenance, security advisories; pin/verify the exact
version; never blindly install "latest." Treat external scanners as
optional tools/adapters — TSF architecture must not depend on Trivy.

**Signals** (where supported and trustworthy): dependency
vulnerabilities, secrets exposure, configuration mistakes,
container/IaC issues, license concerns, SBOM, dependency freshness,
known compromised package/version warnings — integrated into Project
Health (e.g. "Dependencies 2 HIGH / Secrets NONE / Configuration 1
MEDIUM / Licenses CLEAN / SBOM AVAILABLE").

**High Assurance integration**: High Assurance mode may require
stronger security checks before adoption; normal Balanced mode should
not force expensive scanners on every tiny local edit unless justified.
Security findings are evidence, not automatic authority — never
automatically rewrite dependencies, rotate credentials, update
production infrastructure, or remediate findings without a governed
mission.

**Acceptance** — not GREEN until: (1) security scan is read-only by
default; (2) scanner absence produces honest UNKNOWN/UNAVAILABLE; (3)
findings are provenance-bound; (4) secret values are never
unnecessarily copied into TSF logs/UI; (5) severity/source/version are
recorded; (6) a false "security clean" cannot be produced if the
scanner fails; (7) High Assurance can consume the findings; (8) a safe
fixture with planted issues is detected; (9) real repos are not
mutated during scanning; (10) independent verifier is GREEN; (11) Orca
core delta remains 0.

## M11 — Observability / Agent Flight Recorder

**Purpose**: make long TSF runs understandable without reading raw
terminals — when Tim asks "what happened for the last six hours?" TSF
should have a trustworthy answer.

**Source harvest**: OpenTelemetry JavaScript and OpenTelemetry GenAI
semantic conventions (current). Harvest concepts: traces, spans,
events, durations, provider calls, tool calls, workflows, agent
execution, retries, memory, MCP, errors. Prefer open standards over
custom telemetry where practical. Do not add a giant external
observability stack merely to display local TSF data — M4's Run
Journal remains the durable source for workflow history; M11 adds
standardized instrumentation/projection around it, not a replacement.

**Events/spans** to track (trustworthy facts only): planner episode
started/settled, plan generated, Orca Run created, task dispatched,
worker became ready, worker settled, verifier started/settled, retry,
stall, recovery, provider fallback, capacity pause, Needs You,
adoption, checkpoint, external wait, browser verification, security
scan, estimate generated — with elapsed/active/waiting duration,
provider, effective model, role, capacity consumed, retries, result
class where observable. Never fabricate unavailable token counts.

**Privacy**: default telemetry must NOT indiscriminately persist full
prompts, full LLM responses, secrets, credentials, or arbitrary source
contents. Prefer metadata + hashes + classifications + bounded
summaries unless explicit evidence retention requires more.

**UI**: a Run Timeline/Flight Recorder (planner turns, worker tasks,
successful/retried/Needs You counts, active/waiting/blocked duration
per provider, largest bottleneck, a chronological timeline) with
drill-down. Keep raw Orca terminals available as advanced evidence, not
the default view.

**Acceptance** — not GREEN until: (1) a multi-wave run produces a
coherent trace/timeline; (2) Tim can identify why time was spent
waiting; (3) retry/stall/recovery events are visible; (4)
provider/model metadata is honest; (5) unknown usage remains UNKNOWN;
(6) project/run isolation works; (7) sensitive prompt/source content is
not captured by default; (8) M4 Run Journal and M11 telemetry
reconcile; (9) restart/recovery doesn't corrupt the timeline; (10)
independent verifier is GREEN; (11) Orca core delta remains 0.

## M12 — Fleet Optimizer

**Purpose**: upgrade Active Fleet/Work Set from "these projects are
active" into "this is the best safe execution schedule across all
active projects." M8 estimates project work; M5 knows provider
capacity/expiry/cost; M12 decides when and where to run work.

**Source harvest**: Google OR-Tools/CP-SAT concepts (current
license/API verification required) — evaluate as
OPTIONAL_SOLVER_BACKEND. Do not introduce a heavy solver dependency if
a simpler TSF-native deterministic scheduler satisfies V1.

**Inputs** fleet planning may consider: project priorities, deadlines,
M8 task estimates, dependency constraints, critical path, Work Set,
Active Fleet, provider/model suitability, provider remaining capacity,
provider reset/expiry, human availability, client review windows,
Windows heavy-worker limits, file/repo conflict, High Assurance
requirements, blocked/Needs You states, project scheduling policies.

**Output**: a proposed schedule with an explanation of WHY each slot
was selected (example: "10:00–11:30 NWR read-only research / 11:30
Codex reset / 11:30–2:00 Worldforge implementation / 2:00–2:30 NWR
verification / 2:30–5:00 Client site implementation / 5:00–6:00 Buffer
/ recovery").

**Scheduling modes**: FASTEST_SAFE, BALANCED, DEADLINE_FIRST,
COST_MINIMIZED, SUBSCRIPTION_UTILIZATION, HIGH_ASSURANCE. Tim's project
priority and authority decisions always outrank optimizer convenience.

**Real-time replanning**: when a task finishes early, a worker stalls,
a provider reset occurs, Tim changes priority, a project becomes
blocked, or a client deadline changes, the optimizer may generate a new
proposed schedule. Do not silently erase previous plan history. Do not
interrupt healthy sticky planner/worker episodes merely for trivial
optimization gain.

**Multi-project Windows safety**: preserve the hard-earned host rules —
heavy install/build/setup concurrency stays conservative; do not spawn
several sandbox-heavy Codex operations simply because provider capacity
exists; model CPU/RAM/process constraints separately from token
availability.

**Acceptance** — not GREEN until: (1) two+ project workloads can be
scheduled; (2) dependencies change the result; (3) provider resets
change the result; (4) project priority changes the result; (5)
Windows concurrency limits change the result; (6) an impossible
deadline is surfaced honestly; (7) the schedule includes
reasoning/explanation; (8) no project is automatically authorized
beyond its Work Set/policy; (9) the optimizer can replan after a stall;
(10) deterministic test scenarios are reproducible; (11) independent
verifier is GREEN; (12) Orca core delta remains 0.

## M13 — TSF Full-System Acceptance + Operator Readiness

**M13 is NOT a feature-building milestone.** It exists to answer "Is
TSF actually ready for Tim to use?" Stop adding ambitious new
capabilities — freeze feature scope at M1–M12. M13 may fix genuine
defects, close missing integration paths, simplify confusing UX,
improve reliability, remove dead/duplicate TSF code where independently
proven safe, improve documentation, close acceptance gaps. M13 must NOT
become "one more architecture expansion."

**Goal**: prove the entire TSF product as one coherent system — Desktop
launch → Add Project → analyze repo → Health → project memory/context
→ Planner Chat → natural-language goal → real governed Orca work →
live Work Feed → Keep Going/Overnight → interruption/recovery →
capacity-aware routing → verification → candidate → adoption →
estimator → calendar → eval/regression → security Health →
observability → fleet optimization — and prove Tim can operate it
without manually managing Orca terminals during normal work.

### Phase 1 — Source/state reconciliation
Inspect current tsf/main HEAD/tree/status; inspect all milestone
receipts; reconcile M1–M12 actual implementation vs. durable roadmap
claims; confirm no milestone is marked ADOPTED without matching
evidence; inspect the remaining legacy capability ledger; inspect known
follow-ups/gaps; inspect outstanding dirty/stale worktrees; inspect
Orca core delta; inspect package/dependency health. Do not assume
earlier milestone reports were perfect — if durable state and source
disagree, source/evidence wins.

### Phase 2 — Clean-install/launch test
Desktop TSF must install/build successfully, launch normally, start/
connect required local services, communicate with Orca, see
Claude/Codex providers, show honest unavailable states, shut down
cleanly, reopen cleanly. Tim should not need `pnpm dev`, manual
localhost URLs, manual Claude terminal bootstrap, or manual Codex
terminal bootstrap for normal use. If dev-only launch remains required,
M13 cannot call the daily-driver experience fully ready.

### Phase 3 — Project onboarding test
Clean low-risk fixture/test repos first: Browse/Add Project, read-only
repo analysis, branch/HEAD/status, Health, handoff reconciliation,
upgrade recommendations, Known Projects, Active Fleet, Work Set,
Refresh Project State, Planner Chat receiving onboarded context. Then
at least one real low-risk existing project read-only to prove realism.
Do not mutate an important repo merely for acceptance.

### Phase 4 — Planner Chat/dispatch test
From the TSF UI only: Tim-style natural request → live planner →
bounded plan → real Orca Run/task → real Codex worker → Work Feed →
verifier → READY_FOR_ADOPTION. No manual Orca worktree/terminal
management during the normal path. Test: "what's going on?", "what
should we do?", "go ahead", "fix this", "why did you choose that?",
"pause", "resume", "what's the worker doing?", "revise this". Project
switching must remain isolated.

### Phase 5 — Overnight/long-run test
A meaningful multi-wave unattended dogfood, long enough to expose real
lifecycle behavior. Prove: original goal retention, multi-wave
autonomous execution, real worker dispatch, verifier waves, bounded
revisions, stall detection, poller/monitor timeout, supervisor-loss
recovery, worker survives supervisor loss, checkpoint, pause/resume, no
duplicate settled work, provider exhaustion/pause, restart recovery,
morning/return summary. A long run that merely sits waiting for Tim is
not success.

### Phase 6 — Capacity/expiry test
Prove M5 in real behavior: Provider A (high remaining capacity, far
reset) vs. Provider B (smaller remaining capacity, imminent reset). TSF
should reason about expiry pressure, suitability, safety reserve,
sticky sessions, cost, concurrency. Confirm provider balancing is
useful and does not assign unsuitable work merely to burn credits.

### Phase 7 — Memory test
Across fresh planner sessions: Fact recall, Decision protection,
Preference persistence, Experience/Lesson recall, stale Fact
supersession, project isolation, no transcript bloat. Test explicit
correction.

### Phase 8 — Estimator/Delivery Planner test
Test: (A) idea-only estimate, (B) clean repo estimate, (C)
uncertain/blocked repo, (D) impossible deadline, (E) competing project
capacity, (F) provider near reset. Confirm P50/P80/P95, assumptions,
evidence, active effort, human effort, wall-clock, provider forecast,
direct cost, deadline probability, client-facing estimate, Delivery
Calendar, estimate-vs-actual capture. No fake precision.

### Phase 9 — Evaluation Lab test
Run a known evaluation pack; deliberately introduce/choose a candidate
that regresses one known case; M9 should detect and reject/promote
appropriately; verify eval result history.

### Phase 10 — Security Health test
Fixture/project with known safe planted findings: vulnerabilities,
secret detection if available, configuration findings,
failure/UNKNOWN handling, no secret content leak, High Assurance
consumes security state. Do not mutate production/real repositories.

### Phase 11 — Flight Recorder test
Take one complex run and answer: What happened? How long did it take?
Where did time go? Which providers/models were used? Which worker
stalled? Which retries occurred? Why did it pause? What was adopted?
Compare timeline against M4 Run Journal.

### Phase 12 — Fleet Optimizer test
A realistic multi-project planning scenario: at minimum 3 projects,
different priorities, different deadlines, dependency differences,
provider/reset constraints, Windows concurrency constraint. Test
replanning after one project stalls. Optimizer output must be
understandable to Tim.

### Phase 13 — Adversarial/failure test matrix
Attack the product with scenarios actually suffered during development,
at least: Windows sandbox helper failure, wrong Codex executable,
provider auth failure, Claude limit exhaustion, Codex limit exhaustion,
worker starts but never receives task, MCP startup hang, monitor
exceeds timeout, supervisor dies, Orca task continues after supervisor
dies, duplicate dispatch attempt, stale revision, dirty canonical repo,
staged accidental revert, broken/stale worktree, dev server disappears,
planner session disappears, unavailable provider, malformed planner
response, stale memory, conflicting Work Set task, failed verifier,
browser UI failure. TSF should fail boringly: checkpoint → explain →
recover/fence/Needs You → no false success.

### Phase 14 — UX/operator pass
Use the actual TSF UI as Tim would: Home, Work, Projects, Agents,
Planner Chat, Keep Going, Health, Adoption, Memory, Estimator,
Calendar, Evaluation, Security, Flight Recorder, Fleet planning. Ask:
Is this too cluttered? Is important information obvious? Does Tim know
what Needs You means? Can he tell what is working? Can he tell when
something is safe to adopt? Does raw agent plumbing dominate the
experience? Does the purple/gamer-professional visual language remain
coherent? Are old TSF features that remain useful still represented?
Fix usability defects — do not redesign everything merely from taste.

### Phase 15 — Legacy capability reconciliation
Revisit the original 111-capability preservation ledger. For every
remaining item, classify current reality: UPSTREAM_NATIVE / REUSED /
ADAPTED / NEW_TSF / REPLACED_BY_ORCA / SAFE_TO_DEFER / REJECTED /
STILL_REQUIRED_BEFORE_V1. No silent feature loss. If a remaining
capability is genuinely required for the daily-driver north star,
implement/fix it; if not, document why it is deferred/rejected. Do not
port obsolete machinery merely to make the number reach 111.

### Phase 16 — Simplification/dead-code pass
Only after all functional acceptance work: identify duplicate adapters,
dead fixture code, obsolete legacy compatibility paths, unused schemas,
outdated docs, stale feature flags, conflicting implementations. Remove
only when usage is proven absent, tests cover the removal, independent
review agrees, and rollback is clear. Goal: reduce accidental
complexity before Tim starts relying on TSF.

### Phase 17 — Documentation
Concise operator documentation ("START HERE"): how to install/open
TSF, add a project, talk to Planner, start work, start Overnight,
Pause/Resume, handle Needs You, review/adopt, inspect Health, estimate
a project, use the calendar, manage Work Set, inspect a run, recover
after restart, update Claude/Codex accounts. Also: architecture
summary, provider-role configuration, backup/recovery notes, Windows
host requirements, known limitations. Do not require Tim to understand
Orca internals for normal operation.

### Phase 18 — Real low-risk pilot
Once all fixture/system acceptance is GREEN, use one clean, low-risk
real repository for one final governed daily-driver mission. Prefer an
already-understood low-risk project. Do NOT use NWR, HouseOS, EasyLife,
or Worldforge as the first final acceptance pilot unless Tim separately
authorizes it. From TSF UI: onboard/select project → ask Planner what
to do → approve/issue normal goal → real worker execution → verifier →
candidate → Tim/gated adoption. Measure actual UX friction.

### M13 readiness classification
Return one of: `GREEN_TSF_V1_OPERATOR_READY`,
`YELLOW_TSF_V1_OPERATOR_READY_WITH_CAVEATS`, `RED_TSF_V1_NOT_READY`,
`TIM_REQUIRED`. GREEN means Tim can now reasonably use TSF as his
normal development cockpit for controlled real work (raw Orca remains
available as the engine-room/debugging view) — GREEN does NOT mean
zero future bugs, production enterprise certification, every
conceivable feature complete, or permission to autonomously deploy
important systems.

### M13 final report
An operator-ready final acceptance report containing: (1) exact
accepted tsf/main HEAD/tree; (2) milestone status M1–M13; (3) desktop
launch/install result; (4) current primary UI capabilities; (5)
Planner Chat proof; (6) Chat→Dispatch proof; (7) Overnight proof; (8)
recovery proof; (9) capacity-routing proof; (10) memory proof; (11)
estimator/calendar proof; (12) eval/regression proof; (13)
security-health proof; (14) observability proof; (15) fleet-optimizer
proof; (16) final legacy-capability ledger; (17) Orca core delta; (18)
provider configurations tested; (19) Windows reliability results; (20)
known caveats; (21) deferred capabilities; (22) real-pilot result; (23)
exact rollback identity; (24) install/open instructions; (25) what Tim
should test himself. Also produce a short "TSF V1 — TIM TEST CHECKLIST"
for Tim to personally run through when he returns.

## Continuation / authority

Continue autonomously while Tim is away. Do not stop after routine
milestone reports. After each M9–M12 milestone: verify → immutable
candidate → governed local adoption → update program state → next
milestone. After M12 adoption, make M13 CURRENT automatically. M13 may
fix defects necessary to achieve operator readiness; M13 must NOT
invent M14 or broaden the product indefinitely.

Preserve: existing authority model; exact adoption; real-repo
protection; Windows safety; provider-capacity safety; frequent durable
checkpoints; independent verification; Orca core delta target 0.

Interrupt Tim only for: genuine TIM_REQUIRED; architectural/safety RED;
source/canonical-state ambiguity; a paid dependency/service requiring
approval; credentials; destructive/irreversible action;
production/push/deploy/publication; inability to satisfy M13 without
changing the approved architecture. Otherwise: keep going.
