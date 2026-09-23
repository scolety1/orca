import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedDogfoodSessionSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.dogfood-session.lock`
}

function checkedSessions(sessions) {
  for (const session of Object.values(sessions)) {
    assertSupportedDogfoodSessionSchemaVersion(session)
  }
  return sessions
}

function scopeKey(projectId) {
  return projectId ?? '__global__'
}

function assertOneOpenSessionPerScope(sessions) {
  const openScopes = new Set()
  for (const session of Object.values(sessions)) {
    if (!['ACTIVE', 'PAUSED'].includes(session.state)) {
      continue
    }
    const key = scopeKey(session.projectId)
    if (openScopes.has(key)) {
      const error = new Error(`more than one open dogfood session exists for scope ${key}`)
      error.code = 'TSF_DOGFOOD_SESSION_SCOPE_CONFLICT'
      throw error
    }
    openScopes.add(key)
  }
}

export function readAllDogfoodSessions() {
  return checkedSessions(loadState().dogfoodSessions ?? {})
}

export function readDogfoodSession(id) {
  const session = loadState().dogfoodSessions?.[id] ?? null
  if (session) {
    assertSupportedDogfoodSessionSchemaVersion(session)
  }
  return session
}

export async function withDogfoodSessions(mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = checkedSessions(opState.dogfoodSessions ?? {})
    assertOneOpenSessionPerScope(current)
    const next = mutateFn(current)
    checkedSessions(next)
    assertOneOpenSessionPerScope(next)
    saveState({ ...opState, dogfoodSessions: next }, { writerCollection: 'dogfoodSessions' })
    return next
  })
}
