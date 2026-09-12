import {
  classifyContinueAction,
  pauseProjectRun,
  resumeProjectRun
} from './command-run-action-bridge.mjs'

/**
 * @typedef {{ ok: true, action: 'PAUSE' | 'RESUME' | 'DISPATCH' }} ActionSuccess
 * @typedef {{ ok: false, reason: 'PAUSE_FAILED' | 'RESUME_FAILED' | 'UNSUPPORTED_ACTION', detail: string }} ActionFailure
 */

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

/** @returns {Promise<ActionSuccess | ActionFailure>} */
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

    return {
      ok: false,
      reason: 'UNSUPPORTED_ACTION',
      detail: `unsupported action type: ${type}`
    }
  } catch (error) {
    return {
      ok: false,
      reason: type === 'PAUSE' ? 'PAUSE_FAILED' : 'RESUME_FAILED',
      detail: errorDetail(error)
    }
  }
}
