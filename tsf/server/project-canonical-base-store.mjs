// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C: durable,
// per-project, operator-set canonical base ref. Mirrors
// project-execution-hold-store.mjs exactly (REUSE_PATTERN: same cross-
// process-file-lock.mjs mutex, same data-store.mjs opState collection
// convention, same synchronous-mutateFn constraint) -- no second durability
// mechanism invented. Explicit, auditable, never-silent: every write records
// who set it and why, mirroring the hold's own setBy/setAt/reason shape.
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedProjectCanonicalBaseSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'
import { isoNow } from '../domain/canonical.mjs'

export const PROJECT_CANONICAL_BASE_SCHEMA_VERSION = 'TSF_PROJECT_CANONICAL_BASE_V1'

function lockPath() {
  return `${getStateFilePath()}.project-canonical-base.lock`
}

function versionChecked(record) {
  if (record) { assertSupportedProjectCanonicalBaseSchemaVersion(record) }
  return record
}

export function readProjectCanonicalBase(projectId) {
  return versionChecked(loadState().projectCanonicalBases?.[projectId] ?? null)
}

export function readAllProjectCanonicalBases() {
  const bases = loadState().projectCanonicalBases ?? {}
  for (const base of Object.values(bases)) { versionChecked(base) }
  return bases
}

export function createProjectCanonicalBaseRecord({ projectId, ref, setBy, reason }, clock) {
  if (!projectId) { throw new Error('projectId is required to set a project canonical base') }
  if (!ref?.trim()) { throw new Error('ref is required to set a project canonical base') }
  if (!setBy) { throw new Error('setBy is required -- a canonical base must always record who set it, for a real audit trail') }
  const at = isoNow(clock)
  return {
    schemaVersion: PROJECT_CANONICAL_BASE_SCHEMA_VERSION,
    projectId,
    ref,
    setBy,
    reason: reason ?? null,
    setAt: at,
    updatedAt: at,
    history: [{ action: 'SET', ref, by: setBy, reason: reason ?? null, at }]
  }
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// constraint every other withXxx in this codebase has).
export async function withProjectCanonicalBase(projectId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionChecked(opState.projectCanonicalBases?.[projectId] ?? null)
    const next = mutateFn(current)
    saveState({
      ...opState,
      projectCanonicalBases: { ...opState.projectCanonicalBases, [projectId]: next }
    })
    return next
  })
}

// Real setter: an operator/coordinator's own deliberate designation. Records
// who and why, never silent. Overwrites any prior explicit ref for this
// project (a real re-designation), keeping history.
export async function setProjectCanonicalBaseRef({ projectId, ref, setBy, reason }, clock) {
  return withProjectCanonicalBase(projectId, (current) => {
    const at = isoNow(clock)
    if (!current) {
      return createProjectCanonicalBaseRecord({ projectId, ref, setBy, reason }, clock)
    }
    return {
      ...current,
      ref,
      setBy,
      reason: reason ?? null,
      updatedAt: at,
      history: [...current.history, { action: 'SET', ref, by: setBy, reason: reason ?? null, at }]
    }
  })
}

// Real Part A caller: after a genuine adoption merge advances the canonical
// base branch's HEAD, the pointer's `ref` (branch name) is unchanged but the
// event is recorded in history for a real audit trail -- never a silent,
// unrecorded pointer "update".
export async function recordProjectCanonicalBaseAdvanced({ projectId, ref, resultingSha, missionId }, clock) {
  return withProjectCanonicalBase(projectId, (current) => {
    const at = isoNow(clock)
    const base = current ?? createProjectCanonicalBaseRecord({ projectId, ref, setBy: 'SYSTEM_ADOPTION_EXECUTION', reason: 'first real adoption merge on this project' }, clock)
    return {
      ...base,
      ref,
      updatedAt: at,
      history: [
        ...base.history,
        { action: 'ADVANCED', ref, resultingSha, missionId: missionId ?? null, at }
      ]
    }
  })
}
