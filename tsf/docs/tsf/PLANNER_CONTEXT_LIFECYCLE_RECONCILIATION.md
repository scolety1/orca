# Planner Context Lifecycle / Automatic Session Rollover — read-only reconciliation

**Status:** Recorded next Main TSF frontier per the Main TSF overnight
autonomy program's Optional Job 3. Read-only reconciliation only — no
implementation in this pass, per the governing directive's own scope
limit ("do not launch another large implementation wave tonight").

## What already exists (real, tested, in production use today)

`tsf/domain/session-affinity.mjs` already provides the core primitives a
session rollover needs, but scoped today to a single implementation
mission's *worker* session, not a long-running planner/Command chat
session:

- `createSessionBinding` — a durable `TSF_SESSION_BINDING_V1` record
  (role, scope, providerId/agentId/orcaSessionId, an identity hash).
- `assertAffinity` — detects an in-flight identity change mid-mission
  (a real safety property already relied upon).
- `replaceSessionBinding` — the actual handoff primitive: takes an old
  binding, a new one, and a `boundary` reason drawn from an explicit
  allowlist (`MISSION_BOUNDARY`, `RECOVERY_CHECKPOINT`,
  `PROVIDER_FAILURE`, `EXPLICIT_ESCALATION`, `SAFETY_RECOVERY`), and
  produces a durable `TSF_SESSION_REPLACEMENT_RECEIPT_V1` (old/new
  identity, boundary, reason, an optional `checkpointRef`, and
  `unresolvedWork`).

**Today's only real caller is `server/live-planner.mjs`** — this
mechanism exists for a bounded implementation worker's own session
continuity, not for a Command/Chat planner conversation that grows across
many turns/waves over hours or days. There is no equivalent handoff for
the planner/chat side today.

## The gap (what "Automatic Session Rollover" actually needs)

1. **A structured planner handoff capsule** — `replaceSessionBinding`'s
   receipt shape (`unresolvedWork`, `checkpointRef`) is the right family
   of object but is currently populated ad hoc by `live-planner.mjs` for
   a mission-scoped worker, not for a durable chat thread's own state
   (`chatThreads`, `plannerSessions` in `data-store.mjs`). A real capsule
   for a Command/Chat rollover needs: the current conversational referent
   state (see `command-followup-context.test.mjs`'s bounded follow-up
   context), open Needs You/decisions, and a compact summary — not a
   full-transcript replay by default (explicitly required).
2. **An exclusive planner lease** — nothing today prevents two processes
   from believing they own the same chat thread's planner session
   simultaneously. `cross-process-file-lock.mjs` (already used by
   `keep-going-run-store.mjs`, `research-mission-store.mjs`, and this
   session's own new `resource-pressure-lease-store.mjs`) is the obvious,
   already-proven mechanism to reuse — a lease keyed by
   `projectId`/thread id, not a new locking primitive.
3. **A fresh Claude successor** — spawning mechanics already exist
   (`orca-cli-bridge.mjs`, the same pattern Keep Going workers use); the
   missing piece is the trigger condition (context-length/turn-count
   threshold) and what state to hand the successor.
4. **Continuity verification** — an analogue of `assertAffinity`, but for
   "does the successor's understanding of open state match the
   predecessor's" rather than raw process identity.
5. **Old planner retirement eligibility** — when is it safe to let the
   predecessor's session end. `replaceSessionBinding`'s `unresolvedWork`
   field already models "don't retire while X is still open" — reusable
   as-is.
6. **No full-transcript replay by default** — the handoff capsule (point
   1) is precisely what avoids this; a successor reads the capsule, not
   the full history, unless explicitly requested.

## Smallest real path forward (not started)

Given points 2–5 already have a directly-reusable primitive
(`cross-process-file-lock.mjs` for the lease, `session-affinity.mjs` for
the binding/receipt/retirement shape, existing worker-spawn mechanics for
the successor), the genuinely new work is narrow:

1. Extend `session-affinity.mjs`'s `replaceSessionBinding` boundary
   allowlist with a `PLANNER_CONTEXT_ROLLOVER` reason (or confirm
   `MISSION_BOUNDARY` already covers it semantically — needs a real
   decision, not assumed here).
2. Define the actual handoff capsule shape for a **chat thread**
   (distinct from a mission worker's shape) — this is genuine new domain
   modeling, not reuse.
3. Wire a lease around `plannerSessions[projectId]` using the existing
   file-lock primitive.
4. Decide the rollover trigger (context/turn threshold) and where it's
   checked (`chat-dispatch-bridge.mjs`'s existing entry point is the
   natural place, mirroring how the Resource Pressure Governor gate was
   added there this session).

No commit changes this session — this is a durable record only, to
orient whichever session/HQ picks up this frontier next.
