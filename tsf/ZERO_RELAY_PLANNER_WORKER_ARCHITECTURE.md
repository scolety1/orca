# Zero-Relay Planner/Worker Operating Model — Durable Requirement + Reconciliation

Read-only gap reconciliation against the current unified-platform code, at
freeze `16c8b7e530` (plus docs-only commits on top). No implementation
started. The frozen candidate is preserved untouched.

## 0. The requirement (durable record, not chat-only)

**Binding architecture for the final TSF release.** Eliminate the manual
relay loop where Tim copies prompts/results between ChatGPT HQs and
Orca/Claude. Target operating model:

- **TSF** = deterministic authority/governance (project/mission authority,
  durable state, allowed scope, exclusions, spend policy, destructive-
  action policy, adoption/release gates, Needs You, consequences)
- **Claude / PLANNER_DEEP** = director/organizer/planner — decomposes
  goals into durable missions, routes to the right specialist, reviews
  structured results, does gap analysis, requests independent
  verification, issues correction waves, replans, continues to the next
  wave, keeps memory/learning synchronized
- **Orca** = durable execution runtime (worktrees, worker processes,
  provider execution, durable dispatch, process recovery, bounded
  concurrency, worker lifecycle) — no second execution engine inside TSF
- **Codex** = primary bounded implementation worker (not planner +
  implementer + verifier by default; provider routing may substitute but
  must preserve the role separation)
- **Independent verifier** = structurally separate review authority
- **Tim** = owner/consequential-decision authority, interrupted only by a
  genuine Needs You

Golden-path acceptance test to add: `ZERO_RELAY_AUTONOMOUS_DEVELOPMENT_LOOP`
(one nontrivial goal → mission → worktree → decomposition → bounded
Codex dispatch → structured evidence → independent verification → a
seeded defect found → Claude reconciles → correction dispatch →
reverify → checkpoint → memory/learning update → gap analysis →
next wave → `READY_FOR_ADOPTION`, zero Tim relays), plus an
overnight/crash-restart continuation variant.

## 1. Reconciliation table

| Dimension | Verdict | Evidence |
|---|---|---|
| Automatic planner → worker dispatch | **ALREADY_SUPPORTED** (project/code work) | `chat-dispatch-bridge.mjs`'s `planAndDispatchFromCommand`; `keep-going-fleet-driver.mjs` ticks the whole fleet on a real `setInterval` (`keep-going-fleet-driver-bootstrap.mjs`), dispatching without a chat message each time |
| Structured worker result return | **ALREADY_SUPPORTED** | `domain/keep-going-result-capsules.mjs` (project code); `domain/research-node.mjs`'s `TSF_BOUNDED_RESEARCH_RESULT_V1` (research) — both carry status/evidence/files/usage, not prose |
| Automatic verifier dispatch | **ALREADY_SUPPORTED** (project code) / **PARTIALLY_SUPPORTED** (research) | `settled-run-reconciler.mjs`'s `DISPATCH_VERIFICATION` action fires from the same automatic fleet tick, no chat trigger needed. Research missions have the same admit/verify/reconcile *decision logic* (`domain/research-reconciliation.mjs`) but no equivalent background timer — something must call the driver (Command message or script) |
| Verifier → correction loop | **ALREADY_SUPPORTED** (project code) | `server/settled-run-reconciler.mjs:241-276`: `NEEDS_DECISION` with retry budget remaining records a `RETRY` attempt and checkpoints the gap (picked up by the next automatic tick) with **zero Tim involvement**; only once `retryBudgetExceeded` does it `raiseNeedsYou`. Proven end to end in `keep-going-autonomy-proof.test.mjs` |
| Automatic next-wave planning | **ALREADY_SUPPORTED** (project code) | Keep Going's own gap/decision object (`{"gap":{"remainingGaps":[...],"decision":"CONTINUE"}}`, observed live this session) drives the fleet driver's next dispatch with no external call |
| Specialist planner routing | **GENERIC_GAP** | Command classifies GLOBAL/PROJECT/RESEARCH scope and has a hand-built bridge per lane (`command-research-bridge.mjs`, `command-run-action-bridge.mjs`) — there is no generic "specialist planner" registry a new lane (Web Acquisition, Resource Management) can register into. Those two lanes' worktrees are still at `tsf/main` HEAD with zero lane-specific code, so there is nothing to route to yet regardless |
| Durable planner state | **ALREADY_SUPPORTED** (per-project), **PARTIALLY_SUPPORTED** (cross-lane) | `server/live-planner.mjs`'s `buildProjectContextCapsule` already assembles goal, completed missions, blockers, decisions (from the receipt chain), known risks, do-not-repeat lessons (Project Memory), next recommended action, last worker/result, live run status, into every planner call automatically — this is most of "what a fresh session should reconstruct." `plannerSessions` (session-affinity) is a *different*, narrower thing (which process/session to reuse), not goal/decision history. No cross-lane (multi-specialist) equivalent exists |
| Project Memory updates | **PARTIALLY_SUPPORTED** | `domain/project-memory.mjs` + `server/project-memory-http-routes.mjs` are real (Facts/Preferences/Experiences, explicit-vs-inferred supersession) and are *read* automatically into every planner capsule — but nothing in the autonomous keep-going/reconciliation loop *writes* a new record automatically after a wave/verification cycle; today a write needs an explicit call to the HTTP route |
| Platform Learning updates | **GENERIC_GAP** | Confirmed via REQ-002/REQ-003 (this freeze's own reconciliation, §4/§4a of the sibling freeze doc): no generic cross-mission ledger exists anywhere in Unified Platform; Dataset Research uses a mission-scoped fixture fallback only |
| Provider-role routing | **ALREADY_SUPPORTED** (config) / **PARTIALLY_SUPPORTED** (runtime enforcement) | `routing/provider-role-mappings.v1.json` already encodes exactly the target separation: `PLANNER_DEEP`→Claude-preferred, `WORKER_*`→Codex-preferred, `VERIFIER_INDEPENDENT`→Claude-preferred with an explicit `mustDifferFromWorkerWhenAvailable: true` flag. That flag is enforced today only as a **static regression gate** over candidate routing configs (`routing-eval-cases.mjs`'s `REQUIRED PROOF` test), not as a live runtime check that a given wave's verifier actually used a different provider than that wave's worker |
| Needs You gating | **PARTIALLY_SUPPORTED** | Real, tested categories exist for what's coded: `RESEARCH_NEEDS_YOU_CATEGORIES` includes `PAID_PROVIDER_APPROVAL_REQUIRED` (new spend), `UNRESOLVED_CONFLICT`/`HIGH_RISK_CLAIM`/ambiguity categories (irreducible ambiguity); `self-repair-authority.mjs`'s `TIM_REQUIRED` gate and `self-update-adoption.mjs`'s `decidedBy !== 'TIM'` throw cover authority/adoption. Nothing yet models "destructive cleanup" or "credentials Tim must supply" as first-class categories — unsurprising, since Resource Management HQ (the lane that would need them) hasn't started |
| Overnight/crash-resume continuation | **ALREADY_SUPPORTED** | Heavily tested this session and previously: `keep-going-autonomy-proof.test.mjs` (multi-wave, verification, revision, completion, **real backend restart mid-wave**, zero ticks after initial dispatch); research-mission-driver's own "CRASH SIMULATION" tests (dispatch intent persisted, network call never resolved, safe resume); `getRuntimeIdentity`/`writeRuntimeMetadata` distinguish a genuinely-alive process from a stale one |
| Zero-relay Command UX | **PARTIALLY_SUPPORTED** | Command V1 (just finished, frozen) gives a real natural-language front door for *one project or one research mission at a time* — status, dispatch, pause/resume, explanatory follow-ups, research advisory. It does **not** yet decompose one compound, multi-domain instruction (Tim's own example: continue Dataset Research + let the scraper lab experiment + investigate resource pressure + exclude NWR) into several durable missions across several specialist domains in one turn — today that still requires several separate instructions, and two of the three target domains have no capability to route to yet |

## 2. What manual relay remains today (concretely)

1. **Cross-specialist decomposition.** One compound Tim instruction
   spanning Dataset Research + Scraper Lab + Resource Management has no
   single entry point — Command handles one project/research scope per
   turn today.
2. **Research/acquisition-side autonomy.** No background driver
   equivalent to `keep-going-fleet-driver.mjs` exists for `ResearchMission`
   — someone (today: a human relaying between ChatGPT HQs, or a script)
   must keep calling forward. This is very likely the single largest
   contributor to the actual manual loop Tim described.
3. **Two lanes don't exist as code yet.** Web Source Acquisition and Orca
   Resource Management are both still at `tsf/main` HEAD — there is
   nothing in-TSF to route to regardless of Command's own capability.
4. **Project Memory isn't self-writing.** Real structure exists and is
   read automatically; nothing currently writes a new Fact/Preference/
   Experience record automatically after a wave without an explicit call.
5. **No generic Platform Learning mechanism** (REQ-002/003, filed with
   evidence, not yet designed).
6. **Verifier/worker separation isn't runtime-enforced**, only
   regression-gated at the config level — a possible-in-principle
   provider-fallback collision (worker and verifier both landing on the
   same underlying provider in one wave) wouldn't be caught live.

## 3. Proposed implementation phases (sequencing only — not started)

1. **Research autonomy driver** — the highest-leverage single piece:
   build the `ResearchMission` equivalent of `keep-going-fleet-driver.mjs`
   (opt-in interval driver reusing the exact existing admit/verify/
   reconcile decision logic already proven in `research-mission-driver.mjs`
   — no new decision logic, just automatic ticking). This alone would
   remove most of tonight's literal "keep improving Dataset Research
   overnight" relay.
2. **Project Memory auto-write hook** — have `settled-run-reconciler.mjs`
   (and the research equivalent once it exists) record an Experience/Fact
   automatically on COMPLETE and on a NEEDS_DECISION escalation, reusing
   `domain/project-memory.mjs`'s existing `addMemoryRecord`, not a new
   store.
3. **Specialist planner registry** — a generic interface a lane
   registers against (project-set + capability id + dispatch/status/
   verify hooks), so Command routes by capability rather than by a
   hand-written bridge per lane. Migrate the existing Dataset Research
   bridge onto it as the first real registrant (proves genericity the
   way the Dataset Research engine's own cross-domain proof already did).
4. **Multi-domain Command decomposition** — let one compound instruction
   resolve into N durable missions across N specialist registrations,
   with per-clause inclusion/exclusion (reusing the multi-project
   quantifier's own clause-splitting machinery, `project-name-resolver.mjs`,
   generalized past "the same action on multiple projects" to "possibly
   different actions across different capabilities").
5. **Generic Platform Learning Ledger** — only once REQ-002/003 (or a
   third recurring gap) gives a concrete enough shape; explicitly deferred
   per the freeze doc's own reconciliation plan.
6. **Runtime worker/verifier provider divergence check** — a live
   assertion (not just the eval-pack regression gate) that a given wave's
   verifier dispatch actually used a different resolved provider than
   that wave's worker when `mustDifferFromWorkerWhenAvailable` is set.

## 4. Dependencies on specialist HQ work

- Phase 1 (research driver) depends on nothing outside this worktree —
  Dataset Research HQ's own branch never touched engine code (verified in
  the freeze doc's §3), so building this here creates no conflict.
- Phase 3 (specialist registry) has no real registrant beyond Dataset
  Research until Web Source Acquisition or Orca Resource Management HQ
  produces its own capability code — building the registry ahead of a
  second real registrant risks guessing at the wrong generic shape (the
  same genericity discipline REQ-002/003 are already being held to).
- Phase 5 (Platform Learning) explicitly waits on a concrete design input
  from Dataset Research HQ, per the freeze doc.

## 5. Risks

- **Building a second execution engine by accident.** Phase 1 must reuse
  Orca's dispatch/worktree/process mechanics exactly as
  `keep-going-fleet-driver.mjs` does — a bespoke research scheduler would
  violate "do not create another execution engine inside TSF."
- **Guessing genericity too early.** A specialist registry designed
  against one real lane (Dataset Research) risks being NFL/research-
  shaped rather than truly generic, the same failure mode the Dataset
  Research engine's own genericity proof was built to catch. Wait for a
  second real registrant before finalizing the interface.
- **Runtime cost of always-on background drivers.** An interval-driven
  research fleet driver, like the existing keep-going one, spends real
  provider capacity autonomously overnight — needs the same opt-in gate
  (`TSF_KEEP_GOING_FLEET_DRIVER`-style env flag) and budget/spend policy
  already governing paid research dispatch, not a silent default-on.
- **Destabilizing the frozen Command V1 candidate.** None of the above
  touches `command-responder.mjs`/`command-research-bridge.mjs` until
  Phase 3/4 — explicitly sequenced after Tim's pilot per this
  instruction.

## 6. Recommended next Main TSF mission after Tim's Command pilot

**Phase 1 (research autonomy driver)** — highest leverage, lowest risk
(reuses proven decision logic, no new domain concepts, no specialist-lane
dependency, no Command changes), and it is the one piece most directly
responsible for the literal manual relay loop Tim described. Recommend
this as the next bounded mission once Tim's hands-on pilot on `16c8b7e530`
either passes or surfaces defects to fix first.
