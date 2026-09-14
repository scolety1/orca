import {
  classifyContinueAction,
  pauseProjectRun,
  resolveProjectNeedsYou,
  resumeProjectRun
} from './command-run-action-bridge.mjs'
import { executeCommandAdoption } from './command-adoption-execution.mjs'
import {
  createProjectExecutionHold,
  releaseProjectExecutionHold
} from '../domain/project-execution-hold.mjs'
import { withProjectExecutionHold } from './project-execution-hold-store.mjs'
import {
  cancelResearchMissionDurable,
  resolveResearchNeedsYouDurable
} from './research-mission-driver.mjs'
import { resolvePlannerNeedsYou } from '../domain/planner-mission-checkpoint.mjs'
import { mutateCheckpoint } from './planner-mission-store.mjs'

/**
 * @typedef {{ ok: true, action: 'PAUSE' | 'RESUME' | 'DISPATCH' | 'HOLD' | 'RELEASE_HOLD' | 'CANCEL_RESEARCH' | 'RESOLVE_NEEDS_YOU', hold?: object, releasedSomething?: boolean, mission?: object, run?: object, checkpoint?: object, source?: 'PROJECT' | 'RESEARCH' | 'PLANNER' }} ActionSuccess
 * @typedef {{ ok: false, reason: 'PAUSE_FAILED' | 'RESUME_FAILED' | 'ADOPT_FAILED' | 'HOLD_FAILED' | 'RELEASE_HOLD_FAILED' | 'CANCEL_RESEARCH_FAILED' | 'RESOLVE_NEEDS_YOU_FAILED' | 'UNSUPPORTED_ACTION', detail: string, code?: string | null }} ActionFailure
 */

const FAILURE_REASON_BY_TYPE = Object.freeze({
  PAUSE: 'PAUSE_FAILED',
  RESUME: 'RESUME_FAILED',
  ADOPT: 'ADOPT_FAILED',
  HOLD: 'HOLD_FAILED',
  RELEASE_HOLD: 'RELEASE_HOLD_FAILED',
  CANCEL_RESEARCH: 'CANCEL_RESEARCH_FAILED',
  RESOLVE_NEEDS_YOU: 'RESOLVE_NEEDS_YOU_FAILED'
})

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `target` is a bare project id for PAUSE/RESUME/HOLD/RELEASE_HOLD (all
 * their real underlying primitives need) but a full project object for
 * ADOPT (`executeCommandAdoption` needs more than an id -- this executor
 * has no project-catalog access of its own to re-derive one from a bare
 * id). A real, disclosed inconsistency in this minimal contract, not fixed
 * here -- a future generalization pass should settle on one shape once
 * more action types reveal what's actually needed.
 * @returns {Promise<ActionSuccess | ActionFailure>}
 */
export async function executeAction({ type, target, parameters = {}, clock, deps = {} }) {
  try {
    if (type === 'PAUSE') {
      const pause = deps.pauseProjectRun ?? pauseProjectRun
      await pause(target, parameters.reason, clock)
      return { ok: true, action: 'PAUSE' }
    }

    if (type === 'RESUME') {
      const classifyContinue = deps.classifyContinueAction ?? classifyContinueAction
      if (classifyContinue(target) === 'DISPATCH') {
        return { ok: true, action: 'DISPATCH' }
      }
      const resume = deps.resumeProjectRun ?? resumeProjectRun
      await resume(target, clock)
      return { ok: true, action: 'RESUME' }
    }

    if (type === 'ADOPT') {
      // executeCommandAdoption already returns a real, honest
      // {ok, ...}-shaped result for every EXPECTED failure (hold active,
      // diverged, etc.) -- returned verbatim, never reshaped, since every
      // real caller already knows how to read its own exact fields
      // (alreadyIncluded/resultingCanonicalSha/receipt/reason/detail).
      // The try/catch here only guards against a genuinely UNEXPECTED
      // thrown error (e.g. a git subprocess crash).
      const adopt = deps.executeCommandAdoption ?? executeCommandAdoption
      return await adopt({ project: target, clock, deps })
    }

    if (type === 'HOLD') {
      // Idempotent: re-stating an already-held project doesn't overwrite
      // its original setBy/setAt/reason (mirrors the pre-migration
      // applyExternalWorkHold's own "never a promise with no backing
      // durable record" discipline exactly -- moved here unchanged).
      const withHold = deps.withProjectExecutionHold ?? withProjectExecutionHold
      const create = deps.createProjectExecutionHold ?? createProjectExecutionHold
      const hold = await withHold(target, (current) =>
        current && current.status === 'ACTIVE'
          ? current
          : create(
              {
                projectId: target,
                reason: parameters.reason ?? 'EXTERNAL_WORK_ACTIVE',
                setBy: parameters.setBy ?? 'OPERATOR_CHAT',
                note: parameters.note ?? null
              },
              clock
            )
      )
      return { ok: true, action: 'HOLD', hold }
    }

    if (type === 'RELEASE_HOLD') {
      // Releasing an already-released (or never-held) project is an
      // honest no-op, never a fabricated "released" claim -- moved here
      // unchanged from the pre-migration applyExternalWorkRelease.
      const withHold = deps.withProjectExecutionHold ?? withProjectExecutionHold
      const release = deps.releaseProjectExecutionHold ?? releaseProjectExecutionHold
      let releasedSomething = false
      await withHold(target, (current) => {
        if (!current || current.status !== 'ACTIVE') {
          return current
        }
        releasedSomething = true
        return release(
          current,
          {
            releasedBy: parameters.releasedBy ?? 'OPERATOR_CHAT',
            reason: parameters.reason ?? null
          },
          clock
        )
      })
      return { ok: true, action: 'RELEASE_HOLD', releasedSomething }
    }

    if (type === 'RESOLVE_NEEDS_YOU') {
      // TSF Final Pre-UI P1 Closure V1, P1 #1: source-aware -- fleetNeedsYouStatus
      // (fleet-work-status.mjs) already aggregates three real sources
      // (PROJECT/RESEARCH/PLANNER); this is the one canonical mutation
      // authority for resolving any of them, closing the "CONNECTION, not
      // a new interruption system" gap the mission brief named. `source`
      // defaults to 'PROJECT' -- every real caller before this stage
      // (keep-going-http-routes.mjs's resolve-needs-you route) never set
      // it, so an unspecified source keeps that exact prior behavior.
      // `target` is the project id for PROJECT, the mission id for
      // RESEARCH and PLANNER (matching CANCEL_RESEARCH's own mission-id-
      // as-target convention). `parameters.expectedRevision` is optional
      // for PROJECT/RESEARCH (their real domain primitives already
      // support it via assertExpectedRevision) -- omitted, a later answer
      // freely replaces an earlier one (deliberately preserved default,
      // not a bug); supplied, a stale-revision race throws
      // TSF_STALE_REVISION (caught below, `.code` preserved onto the
      // failure result). PLANNER's own real checkpoint mutator
      // (resolvePlannerNeedsYou) has no revision concept at all -- not
      // added here ("do not rewrite the planner interruption store");
      // parameters.expectedRevision is silently ignored for that source,
      // matching its pre-existing, unchanged real behavior exactly.
      const source = parameters.source ?? 'PROJECT'

      if (source === 'PROJECT') {
        const resolve = deps.resolveProjectNeedsYou ?? resolveProjectNeedsYou
        const run = await resolve(
          target,
          parameters.needsYouId,
          parameters.resolution,
          clock,
          parameters.expectedRevision
        )
        return { ok: true, action: 'RESOLVE_NEEDS_YOU', source: 'PROJECT', run }
      }

      if (source === 'RESEARCH') {
        const resolve = deps.resolveResearchNeedsYouDurable ?? resolveResearchNeedsYouDurable
        const mission = await resolve(
          target,
          parameters.needsYouId,
          parameters.resolution,
          clock,
          parameters.expectedRevision
        )
        return { ok: true, action: 'RESOLVE_NEEDS_YOU', source: 'RESEARCH', mission }
      }

      if (source === 'PLANNER') {
        const mutate = deps.mutateCheckpoint ?? mutateCheckpoint
        const resolve = deps.resolvePlannerNeedsYou ?? resolvePlannerNeedsYou
        const checkpoint = await mutate(
          target,
          (current, c) => {
            if (!current) {
              throw new Error(`unknown planner mission: ${target}`)
            }
            return resolve(current, parameters.needsYouId, parameters.resolution, c)
          },
          clock
        )
        return { ok: true, action: 'RESOLVE_NEEDS_YOU', source: 'PLANNER', checkpoint }
      }

      throw new Error(`unknown Needs You source: ${source}`)
    }

    if (type === 'CANCEL_RESEARCH') {
      // Named CANCEL_RESEARCH, not a generic CANCEL -- reconciliation found
      // no generic cancel capability anywhere else (Keep Going runs have
      // no cancel primitive at all, only pause/complete/stall; the legacy
      // candidate ADOPT/REJECT route is fixture-only, dead for real
      // projects). This is the one real, wired cancel capability that
      // exists today. `target` is the mission id (a bare string, like
      // PAUSE/RESUME/HOLD/RELEASE_HOLD).
      const cancel = deps.cancelResearchMissionDurable ?? cancelResearchMissionDurable
      const mission = await cancel(target, parameters.reason ?? 'OPERATOR_CANCEL', clock)
      return { ok: true, action: 'CANCEL_RESEARCH', mission }
    }

    return {
      ok: false,
      reason: 'UNSUPPORTED_ACTION',
      detail: `unsupported action type: ${type}`
    }
  } catch (error) {
    // `code` (e.g. TSF_STALE_REVISION) is additive -- preserved so a caller
    // that cares can distinguish a concurrency conflict from any other
    // failure, without changing the existing {ok, reason, detail} shape
    // every current caller already reads.
    return {
      ok: false,
      reason: FAILURE_REASON_BY_TYPE[type] ?? 'UNSUPPORTED_ACTION',
      detail: errorDetail(error),
      code: error?.code ?? null
    }
  }
}
