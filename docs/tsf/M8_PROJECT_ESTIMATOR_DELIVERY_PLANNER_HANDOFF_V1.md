# M8: Project Estimator + Delivery Planner — Tim's Completed Research Handoff

Recorded verbatim (lightly reformatted for Markdown) from Tim's own
message, received mid-M7-session on 2026-08-20/21, so this survives
context compaction and does not need to be re-derived or re-researched.
This supersedes the older, thinner `M8` roadmap stub in `state.json` with
a fully-specified architecture and acceptance bar. **Do not re-run a
broad external research phase for M8** — only targeted verification of
specific API/license/version details when actually needed during
implementation.

**Authorization / sequencing (Tim's own words):** "finish M7 → verify →
immutable candidate → locally adopt if all existing program conditions
pass → immediately make M8 CURRENT → implement M8 using this
research/spec." M8 is released from `ON_HOLD` **only once M7 is
genuinely ADOPTED** — do not begin M8 implementation before that point,
and do not stop after M7 adoption merely to ask whether M8 should begin.

## Continuation authority

Continue autonomously. Interrupt Tim only for: genuine TIM_REQUIRED;
architectural/safety RED; unrecoverable source ambiguity; provider/
runtime failure that cannot be safely checkpointed; a paid dependency/
service requiring approval; failed adoption conditions. Otherwise keep
going. Reuse M1–M7 wherever possible rather than creating parallel
systems. Keep Orca core delta at 0; heavy Windows work conservatively
serialized; real project repos protected; adoption exact and governed;
independent review substantive; checkpoints frequent.

## M8 north star

Tim provides an existing repo, an onboarded TSF project, an Idea
Incubator concept, or a client brief, and receives an evidence-backed:
scope → stages → time forecast → provider capacity forecast → monetary
cost forecast → risks → milestones → deadline probability → delivery
schedule → client-facing quote.

## Source-harvest findings (already completed by Tim — do not redo)

| Source | Harvest | Decision |
|---|---|---|
| AIPM / AI Project Manager | repo-linked planning, goals, milestones, due dates, time horizons, project summaries, repository-aware completion checks | ADAPT CONCEPTS — do not install AIPM as another project-management runtime |
| Simple Project Estimates | Monte Carlo project-duration forecasting, task min/max ranges, confidence-based distributions, cost simulation, percentile-based results, velocity-aware estimation | REIMPLEMENT AS A SMALL PURE TSF DOMAIN ENGINE — do not import its UI/runtime |
| EstimatorX | Project → Epic → Feature decomposition, explicit assumptions, Clarity separate from Confidence, uncertainty multipliers, weighted estimates, Risk/Effort classifications, reusable estimation patterns/templates | ADAPT DOMAIN MODEL |
| Tokenometer / TokenCost | provider/model pricing adapters, metered API token-cost calculation, separation of current pricing data from estimation logic, cost/latency observability concepts | REFERENCE / BOUNDED LIBRARY EVALUATION ONLY — never confuse subscription allowance percentages with raw API token costs |
| React Big Calendar | React-native Delivery Calendar (day/week/month scheduling, milestone/date presentation, drag/drop if appropriate) | strong candidate — normal dependency/license check before adoption |
| Frappe Gantt | dependency timeline, milestones, day/week/month/year views, working/ignored periods | optional if it adds real value beyond the Delivery Calendar; do not add multiple overlapping calendar frameworks merely because both exist |

## Required memory classes (M7, restated for consistency — see docs/tsf/M7_PROJECT_MEMORY_V2_V1.md for the implementation)

- **FACT** — a project truth that may legitimately become stale (framework/version, canonical branch, architecture fact, deployment topology, current product capability). Superseded by newer evidence; never silently delete historical provenance.
- **DECISION** — an accepted technical/product decision (selected architecture, explicit rejection of another approach, authority boundary, release decision). Must not be silently overwritten by a planner or worker; supersession requires explicit evidence/authority and must preserve the prior decision.
- **PREFERENCE** — Tim's durable project-specific preference (visual direction, workflow preference, preferred level of autonomy, product-behavior preference). Treated as protected user state; cannot be silently inferred away or replaced by a model.
- **EXPERIENCE / LESSON** — a useful learned result from prior implementation, failure, verification, or research (an approach repeatedly failed; a Windows mechanism is unreliable; an integration requires a certain sequence; a rejected implementation should not be repeated). Powers `do_not_repeat_lessons` and similar bounded planner context.

Automatic capture must be conservative: prefer capture from accepted
user decisions, settled/adopted milestones, verified results, explicit
preferences, independently supported lessons — over arbitrary worker
prose, speculative model observations, unverified candidate claims.
When confidence/provenance is insufficient, do not promote something
into durable memory merely because a model said it.

## M8 estimation architecture

The planner must **not** directly invent the final numeric estimate.
Required pipeline:

```
project/idea evidence
  → planner creates structured Work Breakdown Structure
  → TSF validates the structure
  → deterministic estimator computes uncertainty/ranges
  → Monte Carlo simulation
  → dependency/capacity-aware Delivery Planner
  → final estimate
  → client-facing view
```

Planner judgment is allowed in decomposition and uncertainty inputs.
**Final calculations must be reproducible for the same fixed input/seed.**

### Work Breakdown Structure fields (as appropriate per task/stage)

id, title, stage/epic, category, dependencies, likely file/component
conflicts, minimum effort, expected effort, maximum effort, clarity,
confidence, risk, provider role hint, human review range, external wait
range, assumptions, evidence, blockers, direct-cost items. Do not add
fields merely for ceremony.

### Three distinct clocks — never collapse into one number

1. **Active engineering / agent effort** — how much actual implementation/research/testing work is required.
2. **Human/operator effort** — how much of Tim's own time is likely required.
3. **Wall-clock delivery time** — how long until the client/project actually receives the result.

A project may require 12 hours of agent work but still take a calendar
week due to dependencies, provider resets, verification, and client
feedback.

### Monte Carlo estimation

Deterministic-seeded Monte Carlo engine, typically 10,000+ simulations,
using bounded task distributions informed by optimistic/min, expected,
pessimistic/max, clarity, confidence, dependency delays, revision/
verification probability, and historical TSF calibration when
available. Required outputs: P10/optimistic, P50/expected, P80/
recommended planning bound, P95/high-confidence outside bound, mean/
spread, probability of hitting a supplied deadline. Never label a
number with fake confidence.

### Dependency-aware scheduling

Do not simply sum task hours — build/simulate the dependency graph and
effective critical path. Parallel execution must respect dependencies,
file/component conflicts, Work Set commitments, provider capacity,
Windows/heavy-worker concurrency, client/human review waits. Reuse
relevant M2/M5 scheduling/capacity primitives.

### Provider capacity + cost

Must consume the already-adopted M5 Capacity/Expiry/Cost-Aware Routing
data — do not implement another provider-capacity system.

- **Subscription mode**: report estimated percentage of Claude/Codex allowance where trustworthy, reset windows likely crossed, expiry pressure, likely provider bottleneck. If work is already covered by subscriptions, incremental AI cost = $0 unless overage/additional credits actually apply. Never convert an observed allowance percentage into fake raw-token counts.
- **Metered/API mode**: estimated input/output usage range, provider/model, current pricing-source timestamp/version, estimated USD range, uncertainty, external API/service/infrastructure costs. Pricing must be adapter-driven/current, not permanently hard-coded.

### Estimate calibration

One of TSF's strongest advantages, if done right. Use M4 Run Journal /
settled run evidence plus M5 provider telemetry. Preserve estimated vs.
actual for completed projects/milestones: active agent effort,
wall-clock duration, human review, Claude usage, Codex usage, retries,
revision waves, verifier waves, scope changes, direct cost, predicted
delivery vs. actual delivery. Start conservatively: group similar
task/project archetypes, use robust actual/predicted multipliers,
retain sample size, widen uncertainty for small datasets, do not
overfit, do not rewrite historical estimates. M7 Project Memory may
provide useful durable Lessons, but deterministic calibration should
live in appropriate estimator/run data rather than arbitrary memory
prose.

### Idea Incubator (no repo yet)

Accept a concept/client brief; planner creates a preliminary WBS;
repository facts remain UNKNOWN; widen uncertainty; label the estimate
PRELIMINARY; explain what discovery would reduce uncertainty. When a
repo later exists: run Project Onboarding, refresh the estimate, compare
the preliminary estimate against the repo-grounded one.

### Existing repo / project

Reuse Project Onboarding evidence: Health, branch/HEAD, test/build
status, architecture docs, unfinished work, blockers, upgrade backlog,
lifecycle, existing run history. By default, estimate remaining work,
not the entire codebase.

### Delivery Planner

Inputs: WBS/dependencies, deadlines, project commitments, Tim/team
availability, provider capacity/reset forecasts, Work Set, client-review
periods, weekends/blackout dates, contingency preference.

Outputs: proposed stage dates, milestone dates, dependency warnings,
capacity conflicts, deadline probability, recommended buffer,
ON_TRACK/AT_RISK/UNREALISTIC, alternative schedules.

Suggested scheduling modes: FASTEST_SAFE, BALANCED, COST_MINIMIZED,
DEADLINE_FIRST, SUBSCRIPTION_UTILIZATION, HIGH_ASSURANCE.

### Client-facing estimate

Keep the internal engineering forecast separate from the external
client quote. Client view: scope, assumptions, exclusions, delivery
range, committed/recommended delivery window, milestones, revision
allowance, contingency, configured pricing model, estimate validity
period, conditions requiring re-estimation. Do not expose internal
provider/token information unless Tim chooses to. Possible future
pricing policies: configured hourly/day rate, fixed project price,
stage-based price, cost-plus, user-configured margin/value multiplier —
**TSF must not invent Tim's commercial margin.**

## M8 UI

Add clean TSF-native surfaces, not another giant dashboard. Preserve
TSF's dark/purple/gamer-professional visual direction.

- **Project page → Delivery/Estimate**: expected completion, P80 completion, uncertainty, remaining active effort, human-review effort, provider capacity forecast, direct-cost range, schedule status.
- **Estimate detail**: scope/stages, assumptions, percentiles/distribution, risks, provider forecast, costs, client estimate.
- **Delivery Calendar**: milestones, deadlines, project overlap, capacity conflicts, contingency, optional Gantt/dependency view.

## Proposed contracts

`TSF_PROJECT_ESTIMATE_V1`, `TSF_DELIVERY_PLAN_V1`,
`TSF_ESTIMATE_ACTUAL_V1` — provider-neutral and versioned.

## M8 implementation waves (Tim's own proposed sequence)

1. **Contracts + pure deterministic estimation engine**: WBS normalization, three-point estimates, seeded Monte Carlo, percentiles, deadline probability, tests.
2. **Planner WBS integration**: repo/onboarding evidence, idea/client-brief input, schema validation, assumptions/evidence, no model-authored final arithmetic.
3. **Provider/cost forecasting**: reuse M5, subscription vs. metered, price-adapter interface.
4. **Delivery scheduling**: dependencies, working calendar, provider capacity, milestones, alternative schedules.
5. **Operator/client UI**: Project Estimate, client estimate, Delivery Calendar, appropriate timeline/Gantt if justified.
6. **Estimate-vs-actual calibration**: consume settled M4/M5 evidence, conservative historical correction.
7. **Adversarial real proof**: test at least — small clean repo; larger uncertain repo fixture; idea-only estimate; impossible deadline; provider near reset; existing competing Work Set commitments; blocked/dirty project; scope change; missing provider pricing; no historical calibration data. Do not mutate real projects merely to estimate them.

(Read as guidance for wave *boundaries*, not a rigid recipe — apply the
same research-first-before-each-wave discipline established throughout
M2–M7, since some of these "waves" may turn out to already be partially
satisfied by existing code, exactly as happened repeatedly in M4–M7.)

## M8 acceptance — not GREEN until

1. Same fixed repo snapshot + seed produces reproducible estimates.
2. Idea-only estimate is explicitly preliminary and wider.
3. Estimates use ranges/percentiles instead of fake precision.
4. Active effort, human effort, and wall-clock delivery remain distinct.
5. Deadline probability comes from scheduling/simulation.
6. Subscription capacity is not misrepresented as API token cost.
7. Metered cost estimates identify price source/time/uncertainty.
8. Planner cannot simply invent the final numeric total.
9. Assumptions/evidence are visible.
10. Dirty/blocked/unknown state affects confidence honestly.
11. Dependencies/availability affect delivery schedule.
12. Existing project commitments can create deadline/capacity conflicts.
13. Client quote remains separate from internal cost forecast.
14. Estimate-vs-actual can be persisted without rewriting history.
15. Estimation remains read-only against real projects.
16. Independent verifier is GREEN.
17. Orca core delta remains 0.

## M8 non-goals

Do not build: an accounting suite; invoicing; ERP; legally binding
automatic quotes; a giant ML estimator before TSF has enough historical
data; fake exact raw-token predictions; automatic business-margin
decisions; another project-management runtime.
