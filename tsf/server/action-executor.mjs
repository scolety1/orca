import {
  classifyContinueAction,
  pauseProjectRun,
  resumeProjectRun
} from './command-run-action-bridge.mjs'
import { executeCommandAdoption } from './command-adoption-execution.mjs'
import {
  createProjectExecutionHold,
  releaseProjectExecutionHold
} from '../domain/project-execution-hold.mjs'
import { withProjectExecutionHold } from './project-execution-hold-store.mjs'

/**
 * @typedef {{ ok: true, action: 'PAUSE' | 'RESUME' | 'DISPATCH' | 'HOLD' | 'RELEASE_HOLD', hold?: object, releasedSomething?: boolean }} ActionSuccess
 * @typedef {{ ok: false, reason: 'PAUSE_FAILED' | 'RESUME_FAILED' | 'ADOPT_FAILED' | 'HOLD_FAILED' | 'RELEASE_HOLD_FAILED' | 'UNSUPPORTED_ACTION', detail: string }} ActionFailure
 */

const FAILURE_REASON_BY_TYPE = Object.freeze({
  PAUSE: 'PAUSE_FAILED',
  RESUME: 'RESUME_FAILED',
  ADOPT: 'ADOPT_FAILED',
  HOLD: 'HOLD_FAILED',
  RELEASE_HOLD: 'RELEASE_HOLD_FAILED'
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

    return {
      ok: false,
      reason: 'UNSUPPORTED_ACTION',
      detail: `unsupported action type: ${type}`
    }
  } catch (error) {
    return {
      ok: false,
      reason: FAILURE_REASON_BY_TYPE[type] ?? 'UNSUPPORTED_ACTION',
      detail: errorDetail(error)
    }
  }
}
