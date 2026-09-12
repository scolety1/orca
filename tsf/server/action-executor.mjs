import {
  classifyContinueAction,
  pauseProjectRun,
  resumeProjectRun
} from './command-run-action-bridge.mjs'
import { executeCommandAdoption } from './command-adoption-execution.mjs'

/**
 * @typedef {{ ok: true, action: 'PAUSE' | 'RESUME' | 'DISPATCH' }} ActionSuccess
 * @typedef {{ ok: false, reason: 'PAUSE_FAILED' | 'RESUME_FAILED' | 'ADOPT_FAILED' | 'UNSUPPORTED_ACTION', detail: string }} ActionFailure
 */

const FAILURE_REASON_BY_TYPE = Object.freeze({
  PAUSE: 'PAUSE_FAILED',
  RESUME: 'RESUME_FAILED',
  ADOPT: 'ADOPT_FAILED'
})

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `target` is a bare project id for PAUSE/RESUME (all `pauseProjectRun`/
 * `resumeProjectRun`/`classifyContinueAction` need) but a full project
 * object for ADOPT (`executeCommandAdoption` needs more than an id --
 * this executor has no project-catalog access of its own to re-derive one
 * from a bare id). A real, disclosed inconsistency in this minimal
 * contract, not fixed here -- a future generalization pass should settle
 * on one shape once more action types reveal what's actually needed.
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
