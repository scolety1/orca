// Thin RETIRE_SESSION adapter matching cleanup-executor.mjs's
// (resolvedRealPath, mutationParams, ctx) -> { steps, result } contract,
// over the real mechanism in cleanup-session-retirement.mjs.
import { retireSessionGracefully } from './cleanup-session-retirement.mjs'

export async function executeRetireSession(resolvedRealPath, { pid, verifyIdentity, send, graceMs }) {
  const outcome = await retireSessionGracefully({ pid, verifyIdentity, send, graceMs })
  return {
    steps: [
      {
        name: 'GRACEFUL_RETIRE',
        status: 'COMPLETED',
        detail: { pid, alreadyStopped: outcome.alreadyStopped, escalatedToForce: outcome.escalatedToForce }
      }
    ],
    result: outcome
  }
}
