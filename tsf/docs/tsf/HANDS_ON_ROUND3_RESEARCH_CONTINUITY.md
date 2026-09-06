# Hands-On Pilot Round 3 — Research Continuity + True Zero-Relay

Correction wave applied on `tsf-hands-on-round3-correction-v1` (branched
from the frozen `tsf-zero-relay-resource-aware-candidate-v1` @
`c2074e8e57f07ee5f1b6aad83749d6bf2915c35e`, which remains untouched). Final
HEAD: `55300c0f8f`.

## Commits

1. `f24efde4f6` — Bugs 1-5 + UX polish (Command/Research conversational
   correction wave)
2. `32ea06fc9f` — Research Autonomy Bootstrap (normal server startup now
   owns the ResearchMission fleet driver)
3. `7c2223b15a` — pre-existing broken import path fix + dogfood D
   assertion updates
4. `3de2c7e774` — independent adversarial review findings (6 real findings,
   5 fixed, 1 disclosed limitation)
5. `55300c0f8f` — Bug 5 guardrail strengthened after a live-pilot
   reproduction

## Bugs fixed (against the real, hands-on pilot transcript)

- **Bug 1** (no autonomous dispatch without manual "continue"): creation
  now immediately attempts real free-path progress and, if a genuine gap
  exists, raises a scoped paid-research request — never silently waits for
  a human "continue." Proven end-to-end by
  `test/command-research-zero-relay-autonomy.test.mjs` (zero further
  messages after creation, `advanceOneMission` ticked directly, real
  dispatch/verify/reconcile occurs).
- **Bug 2/3** (research follow-ups falling back to project-required
  rejection): `command-research-bridge.mjs`'s intent patterns extended for
  natural phrasings ("paste it here", "show me the dataset", "where's the
  CSV", etc.) — but see the false-positive finding below, since fixed.
- **Bug 3** (artifact requests not grounded in real state):
  `describeArtifacts` reads the real `artifacts.packageBody.nodes[].canonicalFacts`
  path (a real pre-existing bug: old code read a nonexistent top-level
  field, always `0`/`undefined`).
- **Bug 4** (completion explanation not grounded): `describeMissionCompletion`
  builds its text from real `status.phase`/`completeness.fieldCoverage`/etc.
- **Bug 5** (false conversational continuity): the live-planner system
  prompt now carries an explicit anti-continuity guardrail. A live-pilot
  reproduction after the first fix still showed the failure (a real model
  ignoring a rule buried mid-prompt) — strengthened by moving an
  unconditional, concrete notice to the very top of the prompt for the
  deterministically-known zero-history case. Re-verified live: "how is
  nytheria doing" → "what is nwr doing right now" both answer fresh, no
  false continuity either direction.
- **UX polish**: `formatFleetStatusText`'s `IDLE_NAME_THRESHOLD` collapses
  a large idle fleet to a human summary while still naming ≤3 idle
  projects individually (avoids regressing the existing single-project
  back-reference case). Per-project chat now leads with state/blockers/
  whether Tim needs to care.

## Research Autonomy Bootstrap

`server/research-mission-fleet-driver-bootstrap.mjs` (new), mirroring
`keep-going-fleet-driver-bootstrap.mjs`'s established pattern exactly:
opt-in via `TSF_RESEARCH_MISSION_FLEET_DRIVER=1`, discovery re-reads real
durable state every cycle, `server.on('close', driver.stop)`. Wired into
`http-server.mjs`'s `startStandaloneServer` and `main.mjs`'s real
production spawn env (alongside the existing Keep Going flag). Proven via
a fresh pilot relaunch (port 4700) with **no companion process** — the one
normal server process alone dispatches, discovers, and ticks missions.

Adversarial review caught a real double-driver race: the bootstrap
originally fired unconditionally right after the async `server.listen()`
call, not gated on it succeeding — a losing process in an EADDRINUSE
restart-overlap race would still start its own driver interval. Fixed by
moving the call inside `listen()`'s success callback; only the process
that actually bound the fixed port can ever become the driver.

## Adversarial review findings (5 fixed, 1 disclosed)

1. Zero-node mission auto-complete (`Array.every` on `[]` is vacuously
   true) — fixed in `research-autonomy-policy.mjs`.
2. Double-driver restart race — fixed (see above).
3. Empty-string `periodScope` not caught by `?? 'UNSPECIFIED'` — fixed
   with a trimmed-truthiness check.
4. False-positive research hijack: broad follow-up phrasings ("paste it
   here", "is it still running?") intercepted ordinary Command chat in a
   fleet with zero research missions. Fixed with
   `shouldRouteToResearchBridge(message, opState)`, which only intercepts
   the context-dependent intents (ARTIFACTS/STATUS/COMPLETENESS/CONFLICTS/
   PAID_ADVISORY) when at least one mission exists.
5. Self-contradictory "queued for autonomous progression" text on a
   mission genuinely blocked on Tim's paid-research decision — fixed.
6. (Disclosed, not a code defect) The Bug 5 guardrail test can only prove
   the instruction reached the prompt, not that a real model obeys it —
   inherent to LLM behavior; the guardrail was additionally verified by
   live reproduction, the best available proof for this class of fix.

## Disclosed limitation: real forward progress on a brand-new topic

Live pilot dogfood (fresh state, no companion process, real Claude CLI)
proved the mechanism end-to-end — the bootstrapped driver discovers and
ticks an ACTIVE mission with zero manual intervention — but a genuinely
**new** research topic (no pre-existing Research Library facts, e.g. "NFL
salary cap 2018-2020" in a fresh pilot) made **zero** real progress after
several minutes of live ticking. Root cause, confirmed by direct code
inspection (not assumed):

- `research-mission-fleet-driver-bootstrap.mjs` deliberately wires **no**
  `worker` into the driver's `deps`. This is correct, not an oversight:
  `research-http-routes.mjs`'s existing dispatch route already documents
  an explicit, separate, default-disabled gate
  (`TSF_RESEARCH_LIVE_DISPATCH_ENABLED`) for real, billable
  Exa/Parallel dispatch, per an HQ finding ("before formal merge,
  externally billable dispatch must have an explicit operator-controlled
  enablement gate, DEFAULT DISABLED"). Wiring a real paid worker into an
  *unattended background driver* is a materially bigger decision than
  this correction wave's mandate ("smallest correct bootstrap/lifecycle
  fix") and was correctly left alone.
- With no worker and no matching library fact, `executeDispatchAction`
  returns `SKIPPED_NO_PROVIDER_CONFIGURED` every cycle, forever — harmless
  and honest (never fabricates progress), but **also never escalates to
  Needs You**, because "no provider configured" is architecturally a
  soft/retriable state, not a terminal one. A mission whose only path
  forward is a real paid dispatch will sit quietly, correctly reporting
  its real 0% state whenever asked, but will never proactively surface
  that it is permanently stuck without either (a) a future, deliberately
  authorized wiring of `TSF_RESEARCH_LIVE_DISPATCH_ENABLED`-style
  worker resolution into the bootstrap, or (b) a policy change making
  "no provider configured, no free-path match" itself the trigger for a
  bounded-cycles-later ESCALATE.

Both are real, scoped, worth-doing follow-ups — neither is implemented
here, matching this session's own established practice of recording debt
on the frozen candidate rather than silently expanding scope on a
correction wave.

## Test coverage added this wave

`command-research-zero-relay-autonomy.test.mjs` (new), `research-mission-
fleet-driver-bootstrap.test.mjs` (new), plus new/updated assertions in
`command-research-bridge.test.mjs`, `command-responder.test.mjs`,
`live-planner.test.mjs`, `research-autonomy-policy.test.mjs`,
`command-dogfood-sequences.test.mjs`. Full suite: 1626/1627 passing (the
one failure, `keep-going-autonomy-proof.test.mjs`, is a known real-time
test that passed cleanly in isolation three separate times across this
session — confirmed shared-host contention, not a regression).

## Round 4 addendum -- Research Completion Notification Continuity

Correction wave continued on the same branch: HEAD `47ad8b8588`. Bug: "let
me know when it's done" and natural variants matched no intent, falling
through to the generic project-required rejection despite unambiguous
mission context.

Investigated first: TSF has no push channel to Tim at all (no OS
notification API, no SSE/websocket, no webhook -- confirmed by direct
codebase investigation). Built a real, durable, target-agnostic
completion-watch primitive from scratch (`domain/completion-watch.mjs`,
`server/completion-watch-store.mjs`, `server/completion-watch-reconciler.mjs`,
`server/command-research-completion-watch.mjs`), mirroring the existing
mission/run store conventions exactly -- no second scheduler. It fires
once when a watched mission reaches a terminal outcome (COMPLETE or
cancelled) and delivers the notice exactly once, prepended to Tim's next
real chat turn, since there is no way to interrupt him outside the chat.
`kind` is generic on purpose so Keep Going/Health Repair/etc. completions
can be added later as one new resolver entry, never a second mechanism --
only RESEARCH_MISSION is wired today.

Adversarial review (2 passes) found and fixed: a real registration race
(two near-simultaneous requests could both create a watch) and a real
delivery race (two concurrent chat turns could both deliver the same
notice) -- both closed by moving the check-and-write inside one lock
acquisition; a false-positive hijack risk in the intent regex (an
earlier, fully-generic capture matched ordinary DevOps phrasing like "let
me know when the deploy is done") -- narrowed to back-reference-style
phrasing only. One item disclosed, not fixed: `resolveResearchMissionOutcome`
treats mission state BLOCKED as terminal; the domain state machine
technically allows resuming from BLOCKED, but `resumeResearchMission` has
zero real callers anywhere in this codebase today, so nothing is actually
at risk yet -- flagged inline for whoever wires up a real resume path
later.

Live-verified end to end against the fresh pilot with zero direct state
manipulation for the cancellation path (create -> watch -> cancel ->
honest notice, all via real chat); the COMPLETE path required directly
forcing the one already-tracked mission to COMPLETE in the pilot's state
file to prove delivery, since (as already disclosed above) no real
free/paid research provider exists in this codebase to organically
complete a brand-new topic.

## Next platform phase (unchanged from the freeze doc)

Planner Context Lifecycle / Automatic Session Rollover remains the next
Main TSF platform phase, contingent on continued pilot health. This
wave's two disclosed items above (paid-dispatch bootstrap wiring,
no-provider escalation policy) are Research-track follow-ups, tracked
here rather than folded into that unrelated phase.
