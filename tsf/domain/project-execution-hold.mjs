// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B:
// durable, operator-scoped "do not dispatch new heavyweight TSF work into
// this project" hold. Reconciliation finding (checkpoint doc): Keep Going's
// PAUSED state is insufficient (a paused run blocks a TICK, but a fresh
// chat dispatch just creates a brand-new run instead -- see
// chat-dispatch-bridge.mjs's own NON_DISPATCHABLE_ACTIVE_STATES, which only
// ever guards an EXISTING run); the Resource Pressure Governor is host-wide,
// not project-scoped; mission-state.mjs has no operator-settable
// blockedReason concept at all. This is the smallest new, real domain
// primitive that actually covers "this ONE project, for an operator-stated
// reason, until explicitly released" -- never touches the project's real
// repo, never implies mission completion, never kills anything.
import { isoNow } from './canonical.mjs'

export const PROJECT_EXECUTION_HOLD_SCHEMA_VERSION = 'TSF_PROJECT_EXECUTION_HOLD_V1'

// Deliberately one reason today (the real one this mission needs, NWR) --
// extend this set, not the shape, when a second real reason emerges.
export const HOLD_REASONS = Object.freeze(['EXTERNAL_WORK_ACTIVE'])

export const HOLD_STATUSES = Object.freeze(['ACTIVE', 'RELEASED'])

export function createProjectExecutionHold({ projectId, reason, setBy, note = null }, clock) {
  if (!projectId) {
    throw new Error('projectId is required to create a project execution hold')
  }
  if (!HOLD_REASONS.includes(reason)) {
    throw new Error(`unknown project execution hold reason: ${reason} (known: ${HOLD_REASONS.join(', ')})`)
  }
  if (!setBy) {
    throw new Error('setBy is required -- a hold must always record who set it, for a real audit trail')
  }
  const at = isoNow(clock)
  return {
    schemaVersion: PROJECT_EXECUTION_HOLD_SCHEMA_VERSION,
    projectId,
    status: 'ACTIVE',
    reason,
    note,
    setBy,
    setAt: at,
    releasedBy: null,
    releasedAt: null,
    releaseReason: null,
    updatedAt: at,
    history: [{ action: 'SET', reason, by: setBy, note, at }]
  }
}

// Explicitly releasable, never a silent delete: the record survives release
// (status flips to RELEASED, history keeps the SET entry) so "who set it and
// why, who released it and why" is always answerable later, mirroring this
// codebase's own audit-trail convention (mission.transitions,
// self-improvement finding transitions).
export function releaseProjectExecutionHold(hold, { releasedBy, reason = null }, clock) {
  if (!hold || hold.status !== 'ACTIVE') {
    const error = new Error('no active project execution hold to release')
    error.code = 'TSF_NO_ACTIVE_PROJECT_EXECUTION_HOLD'
    throw error
  }
  if (!releasedBy) {
    throw new Error('releasedBy is required -- a release must always record who released it')
  }
  const at = isoNow(clock)
  return {
    ...hold,
    status: 'RELEASED',
    releasedBy,
    releasedAt: at,
    releaseReason: reason,
    updatedAt: at,
    history: [...hold.history, { action: 'RELEASE', reason, by: releasedBy, at }]
  }
}

export function isProjectExecutionHoldActive(hold) {
  return !!hold && hold.status === 'ACTIVE'
}
