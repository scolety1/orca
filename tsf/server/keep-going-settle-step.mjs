// Settling an already-dispatched wave: checks real Orca task status,
// escalates a real worker question to Needs You, detects a genuine stall,
// or records the wave's real outcomes and retry attempts. Split out of
// keep-going-dispatch-loop.mjs (which still owns dispatchStep, the other
// half of the same tick contract, and calls this module's settleStep for
// the settle side) purely to keep that file's own size manageable -- no
// behavior here changed by the split.
import {
  checkpointRun,
  markStalled,
  raiseNeedsYou,
  recordTaskAttempt,
  releaseTick,
  settleInFlightWave
} from '../domain/keep-going.mjs'
import { isoNow } from '../domain/canonical.mjs'
import { claim, commitClaimed, commitReleaseOnly, lostLockResult } from './keep-going-tick-lock.mjs'
import { resolveSenderTerminal } from './keep-going-dispatch-loop.mjs'

const COMPLETED_STATUSES = new Set(['completed', 'succeeded'])
const FAILED_STATUSES = new Set(['failed', 'error'])

// TSF Overnight Product Completion V1, Phase 1 (zero-relay): a real worker
// can hit its own `orchestration ask` mid-task -- a genuine design/
// approval question it decided it could not resolve alone (distinct from
// ordinary self-resolvable uncertainty, which a worker just resolves and
// keeps going on; a worker only calls `ask` when it won't proceed without
// an answer). Before this, nothing here ever read the Run's own mailbox,
// so that question sat invisible to TSF's canonical Needs You system and
// the owner had no way to see it short of raw Orca CLI. `from_handle`
// starting with "dispatch:" is how a genuine worker-originated question is
// told apart from any other message type/sender this same mailbox carries
// (e.g. this module's own heartbeats). Filters out ids already present as
// an escalation.messageId on the run's own needsYou (dedup -- a message
// this tick already escalated must never raise a second, duplicate
// question just because it is still unanswered on a later tick). Real
// Codex adversarial review finding: also requires a truthy `id` (with no
// id there is no correlation key for either dedup or the later reply-back,
// so such a message can never be safely escalated) and dedupes WITHIN this
// same batch by id -- alreadyEscalatedMessageIds alone only guards against
// a PRIOR tick's escalations, so a single `check` response that itself
// contains the same message id twice previously produced two Needs You
// entries for one real question.
function newWorkerQuestions(messages, alreadyEscalatedMessageIds) {
  const seenThisBatch = new Set()
  return (messages ?? []).filter((m) => {
    if (
      m.type !== 'question' ||
      typeof m.from_handle !== 'string' ||
      !m.from_handle.startsWith('dispatch:') ||
      !m.body?.trim() ||
      !m.id ||
      alreadyEscalatedMessageIds.has(m.id) ||
      seenThisBatch.has(m.id)
    ) {
      return false
    }
    seenThisBatch.add(m.id)
    return true
  })
}

function parseMessagePayload(message) {
  try {
    return JSON.parse(message.payload ?? '{}')
  } catch {
    return {}
  }
}

export async function settleStep(projectId, clock, orchestration, store) {
  let claimed
  try {
    claimed = await claim(projectId, 'SETTLE', clock, store)
  } catch (error) {
    return {
      action: 'SETTLE_CLAIM_FAILED',
      reason: error.code ?? 'CLAIM_FAILED',
      detail: error.message
    }
  }

  const { inFlightWave, orchestrationRunId } = claimed
  // Real live-pilot finding, TSF Research-Driven Development V1: the
  // calling coordinator's own "currently bound Run" is real, ambient,
  // MUTABLE state -- any other real `orca orchestration check --run
  // <other-id>` call from the SAME terminal identity (a manual diagnostic,
  // a concurrent unrelated script) silently rebinds it, and every
  // subsequent settle tick's own checkOrchestrationMessages call then
  // fails with a real, honest consumer_fenced error -- live-reproduced,
  // not hypothetical. dispatchStep already defensively rebinds before ITS
  // OWN CLI calls on a reused orchestrationRunId (see resolveSenderTerminal
  // + bindOrchestrationRun above) for exactly this reason; settleStep
  // never did, despite running on every tick, not just the first. Mirrors
  // that same defensive rebind here -- a no-op when already correctly
  // bound, and an honest SETTLE_CHECK_FAILED (never a silent stall) if
  // even rebinding itself fails.
  const senderTerminal = await resolveSenderTerminal(orchestration)
  if (!senderTerminal.ok) {
    return commitReleaseOnly(projectId, store, claimed, clock, 'SETTLE_CHECK_FAILED', undefined, {
      reason: senderTerminal.reason ?? 'SENDER_TERMINAL_UNAVAILABLE',
      detail: senderTerminal.detail ?? 'could not resolve a sender-terminal identity for settlement'
    })
  }
  const bindResult = await orchestration.bindOrchestrationRun({
    id: orchestrationRunId,
    from: senderTerminal.handle
  })
  if (!bindResult.ok) {
    return commitReleaseOnly(projectId, store, claimed, clock, 'SETTLE_CHECK_FAILED', undefined, {
      reason: bindResult.reason,
      detail: bindResult.detail
    })
  }
  const tasksResult = await orchestration.listOrchestrationTasks({ run: orchestrationRunId })
  if (!tasksResult.ok) {
    return commitReleaseOnly(projectId, store, claimed, clock, 'SETTLE_CHECK_FAILED', undefined, {
      reason: tasksResult.reason,
      detail: tasksResult.detail
    })
  }
  const tasksById = new Map((tasksResult.result?.tasks ?? []).map((t) => [t.id, t]))

  // Disclosed, deliberately not modeled further this wave (found live
  // reconciling a real stalled smoke dispatch): PENDING here conflates two
  // genuinely different states -- "worker-start's CLI call succeeded and a
  // real worker was assigned" (DISPATCH_SUCCEEDED, confirmed the moment
  // dispatchStep records the dispatchId) versus "the underlying agent
  // process has actually finished ITS OWN startup and begun the real
  // task" (AGENT_STARTUP_READY -- an agent can sit in its own startup
  // phase, e.g. stalled on an unrelated MCP server login, for a long
  // time after a fully successful dispatch, with Orca's own worker.state
  // still reporting 'ready'/'running' throughout). Distinguishing them
  // precisely would need surfacing worker-show's stage/observation
  // fields into this outcome, a real enhancement judged out of scope for
  // this milestone; PENDING here should be read as DISPATCH_SUCCEEDED
  // only, never as evidence the agent is actively working.
  const outcomes = []
  let allTerminal = true
  for (const record of inFlightWave.dispatchRecords) {
    const task = tasksById.get(record.taskId)
    const status = task?.status ?? 'unknown'
    if (COMPLETED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'COMPLETED', rawStatus: status })
    } else if (FAILED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'FAILED', rawStatus: status })
    } else {
      allTerminal = false
      outcomes.push({ ...record, outcome: 'PENDING', rawStatus: status })
    }
  }
  if (!allTerminal) {
    // TSF Overnight Product Completion V1, Phase 1 (zero-relay): checked in
    // the SAME settle pass that already calls listOrchestrationTasks for
    // this run, so no extra tick/poll cadence is introduced, and only
    // while a wave is genuinely in flight -- there is no live worker to
    // ask anything otherwise. Takes priority over the stall-threshold
    // check just below: a worker waiting on a real owner answer is not
    // stalled, it is correctly, honestly blocked, and must never be
    // reported as a silent stall instead of what it actually is.
    const alreadyEscalated = new Set(
      (claimed.needsYou ?? []).map((entry) => entry.escalation?.messageId).filter(Boolean)
    )
    const messagesResult = await orchestration.checkOrchestrationMessages({
      run: orchestrationRunId
    })
    // Real Codex adversarial review finding: a failed mailbox read used to
    // silently fall through to the stall-threshold check below as if it
    // had confirmed there was nothing pending -- a real worker question
    // could sit unseen behind a transient CLI failure until the wave aged
    // past stallThresholdMs and got marked STALLED, contradicting the
    // "must never be reported as a silent stall" guarantee this same
    // feature exists to provide. Bail out honestly instead (same shape as
    // the tasksResult failure just above): release the lock, report the
    // real failure, and let the NEXT tick retry the mailbox read rather
    // than guess.
    if (!messagesResult.ok) {
      return commitReleaseOnly(
        projectId,
        store,
        claimed,
        clock,
        'SETTLE_MESSAGE_CHECK_FAILED',
        undefined,
        {
          reason: messagesResult.reason,
          detail: messagesResult.detail
        }
      )
    }
    const pendingQuestions = newWorkerQuestions(messagesResult.result?.messages, alreadyEscalated)
    if (pendingQuestions.length > 0) {
      try {
        const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
          let n = { ...current, revision: expectedRevision }
          for (const message of pendingQuestions) {
            const payload = parseMessagePayload(message)
            n = raiseNeedsYou(
              n,
              {
                question: message.body,
                options: Array.isArray(payload.options) ? payload.options : [],
                taskId: payload.taskId ?? null,
                escalation: {
                  kind: 'WORKER_ASK',
                  messageId: message.id,
                  dispatchId: payload.dispatchId ?? message.from_handle.slice('dispatch:'.length),
                  orchestrationRunId
                }
              },
              clock,
              n.revision,
              true
            )
          }
          return releaseTick(n, clock, n.revision)
        })
        return {
          action: 'WORKER_ESCALATED_TO_NEEDS_YOU',
          run: next,
          questions: pendingQuestions.map((m) => m.id)
        }
      } catch (error) {
        return lostLockResult('WORKER_ESCALATION_FAILED', error, {})
      }
    }
    // No real per-worker heartbeat timestamp exists to feed keep-going.mjs's
    // own detectStall (mapOrchestrationFacts always emits lastHeartbeatAt:
    // null -- a disclosed, still-open limitation, see wave 11 finding 4).
    // What IS real: how long this wave has been dispatched. Past
    // stallThresholdMs with nothing terminal, escalate to STALLED so an
    // operator sees it, rather than looping WAVE_STILL_IN_FLIGHT forever
    // with no way out.
    const silentForMs = Date.parse(isoNow(clock)) - Date.parse(inFlightWave.dispatchedAt)
    if (silentForMs > claimed.budget.stallThresholdMs) {
      try {
        const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
          const stalledWorkItemIds = inFlightWave.dispatchRecords
            .filter((r) =>
              outcomes.some((o) => o.workItemId === r.workItemId && o.outcome === 'PENDING')
            )
            .map((r) => r.taskId)
          let stalled = markStalled(
            current,
            inFlightWave.dispatchRecords.filter((r) =>
              outcomes.some((o) => o.workItemId === r.workItemId && o.outcome === 'PENDING')
            ),
            clock,
            true, // tickInternal -- this tick still holds the lock it is releasing
            expectedRevision
          )
          // A real, confirmed gap found live: this branch was the only run-
          // level phase transition in this module with no explicit
          // checkpoint of its own -- state.transitions correctly recorded
          // the STALLED transition, but summarizeRun/the UI's "last
          // checkpoint" display would keep showing the pre-stall phase
          // (still WAVE_DISPATCHED) with no durable record of *why* or
          // *when* the stall was actually detected.
          stalled = checkpointRun(
            stalled,
            {
              phase: 'WAVE_STALLED',
              note: `silent for ${silentForMs}ms`,
              evidence: stalledWorkItemIds
            },
            clock
          )
          return releaseTick(stalled, clock, stalled.revision)
        })
        return { action: 'WAVE_STALLED', run: next, outcomes }
      } catch (error) {
        return lostLockResult('WAVE_STALLED', error, {})
      }
    }
    return commitReleaseOnly(projectId, store, claimed, clock, 'WAVE_STILL_IN_FLIGHT', outcomes)
  }

  // Captured by the mutateFn closure below rather than stashed on the run
  // object itself -- the run returned from mutateFn is exactly what gets
  // persisted (JSON.stringify'd), so any out-of-band signal must live
  // outside it, not as a throwaway property that would otherwise leak into
  // the saved state.
  let retryBudgetExceededOut = []
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
      let n = current
      const retryBudgetExceeded = []
      outcomes.forEach((outcome, index) => {
        try {
          n = recordTaskAttempt(
            n,
            outcome.workItemId,
            outcome.outcome === 'FAILED' ? 'RETRY' : 'COMPLETED',
            clock,
            // Only the FIRST mutation in this closure needs the real
            // claim-time check (index === 0 ? expectedRevision) -- a real,
            // confirmed review finding was that every mutation here
            // previously used `n.revision` (self-consistent, a tautology
            // that can never detect the lock was recovered by another
            // tick since the claim). Subsequent iterations reusing the
            // now-validated `n.revision` is safe: nothing else can run
            // between them inside this one synchronous closure.
            index === 0 ? expectedRevision : n.revision
          )
        } catch (error) {
          if (error.code === 'TSF_RETRY_BUDGET_EXCEEDED') {
            retryBudgetExceeded.push(outcome.workItemId)
          } else {
            throw error
          }
        }
      })

      const waveResult = {
        schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
        outcomes,
        settledAt: null
      }
      n = settleInFlightWave(n, { ...waveResult, settledAt: n.updatedAt }, clock, n.revision)
      n = checkpointRun(
        n,
        { phase: 'WAVE_SETTLED', evidence: outcomes.map((o) => o.taskId) },
        clock
      )

      if (retryBudgetExceeded.length > 0) {
        // Reporting the breach alone doesn't stop anything: nothing
        // prevents the caller from handing the same exhausted work item
        // back in on the very next tick, immediately re-triggering the
        // same breach forever. Escalate to a real NEEDS_YOU question so an
        // operator actually sees it and the run stops silently spinning.
        n = raiseNeedsYou(
          n,
          {
            question: `Retry budget exceeded for work item(s): ${retryBudgetExceeded.join(', ')}. How should I proceed?`,
            options: ['RETRY_ANYWAY', 'SKIP_AND_CONTINUE', 'BLOCK_RUN']
          },
          clock,
          n.revision,
          true // tickInternal
        )
        n = checkpointRun(
          n,
          { phase: 'RETRY_BUDGET_NEEDS_YOU', evidence: retryBudgetExceeded },
          clock
        )
      }
      retryBudgetExceededOut = retryBudgetExceeded
      return releaseTick(n, clock, n.revision)
    })
    return {
      action: retryBudgetExceededOut.length > 0 ? 'WAVE_SETTLED_NEEDS_YOU' : 'WAVE_SETTLED',
      run: next,
      outcomes,
      ...(retryBudgetExceededOut.length > 0 ? { retryBudgetExceeded: retryBudgetExceededOut } : {})
    }
  } catch (error) {
    return lostLockResult('WAVE_SETTLED', error, {})
  }
}
