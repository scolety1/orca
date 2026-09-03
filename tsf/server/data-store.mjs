// Tiny local JSON persistence for operator-set state (Usage Mode, Work Set,
// the fixture candidate's decision). Not synced anywhere, not a database —
// one file, read on demand, written atomically. Gitignored.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createPortfolio } from '../domain/portfolio.mjs'

const HERE = import.meta.dirname
const STATE_DIR = path.join(HERE, '.local-state')
// Overridable so tests can point at an isolated temp file instead of the
// real local operator state (which a running dev server may hold open).
const STATE_FILE = process.env.TSF_UI_STATE_FILE || path.join(STATE_DIR, 'operator-state.json')

const DEFAULTS = {
  schemaVersion: 'TSF_UI_OPERATOR_LOCAL_STATE_V1',
  usageMode: 'BALANCED',
  workSet: [
    'colety-labs-sales-engine',
    'weird-talent-marketplace',
    'shopify-catalog-qa',
    'tsf-ui-capability-check'
  ],
  fixtureCandidateDecision: null, // { decision, requestId, reason, at, receiptHash }
  fixtureReceipts: [],
  chatThreads: {}, // projectId -> [{ role, content, at, decisionClass, intent }]
  plannerSessions: {}, // projectId -> TSF_SESSION_BINDING_V1 (see tsf/domain/session-affinity.mjs)
  portfolio: createPortfolio(), // real tsf/domain/portfolio.mjs structure: Known/Active Fleet/Work Set
  onboardedProjects: {}, // projectId -> { repoPath, lastAnalysis, receipts, acceptedAt, refreshedAt }
  keepGoingRuns: {}, // projectId -> TSF_OVERNIGHT_RUN_V1 (see tsf/domain/keep-going.mjs)
  researchMissions: {}, // missionId -> TSF_RESEARCH_MISSION_V1 (see tsf/domain/research-mission.mjs)
  projectMemory: {}, // projectId -> TSF_PROJECT_MEMORY_V1 (see tsf/domain/project-memory.mjs)
  projectEstimates: {}, // projectId -> TSF_PROJECT_ESTIMATE_RESULT_V1 (see tsf/server/estimate-http-routes.mjs)
  estimateActuals: {}, // projectId -> TSF_ESTIMATE_ACTUAL_V1[] (see tsf/domain/estimate-calibration.mjs)
  evalRuns: {}, // packId -> TSF_EVAL_RUN_RESULT_V1[], append-only (see tsf/server/eval-http-routes.mjs)
  prepareForWorkOperations: {} // operationId -> TSF_PREPARE_FOR_WORK_OPERATION_V1 (see tsf/domain/prepare-for-work-operation.mjs)
}

// Exposes the real state file path (honoring the same TSF_UI_STATE_FILE
// test-isolation override loadState/saveState use) so a caller that needs
// its own file-based lock scoped to this exact file -- keep-going-run-
// store.mjs's cross-process lock -- can derive a sibling lock path
// without duplicating the override logic.
export function getStateFilePath() {
  return STATE_FILE
}

export function loadState() {
  if (!existsSync(STATE_FILE)) {
    return structuredClone(DEFAULTS)
  }
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

// Bounded, synchronous retry for saveState's own final rename -- the same
// documented Windows file-handle-contention hazard (antivirus/indexer
// transiently holding a handle) that tsf/server/cross-process-file-lock.mjs
// already retries around for ITS lock file (see that module's
// withWindowsRetry), applied here to this second, previously-unprotected
// call site of the identical OS-level race. A real, independently-
// disclosed durability finding: keep-going-run-store-cross-process.test.mjs
// intermittently observed exactly this EPERM on rename under real
// concurrent-process load.
//
// Deliberately synchronous (Atomics.wait), not async: saveState always runs
// inside withFileLock's/withKeepGoingRun's/withResearchMission's required-
// synchronous critical section (an `await` there would break the
// atomicity those modules depend on). This is a categorically smaller,
// bounded block (<=620ms worst case, 5 short backoff steps) than the
// acquire-wait spin explicitly rejected elsewhere in this codebase (which
// could block for the full ~30s lock-acquire timeout) -- and it only ever
// runs while this process already holds the exclusive cross-process lock,
// so other processes are already waiting on it regardless.
const WINDOWS_RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320]

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withWindowsRenameRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      const retryable = error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY'
      if (process.platform !== 'win32' || !retryable || attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) {
        throw error
      }
      sleepSync(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}

// `rename` is injectable (defaults to the real renameSync) so tests can
// deterministically simulate a transient Windows rename failure without
// needing to reproduce real OS-level file-handle contention.
export function saveState(state, { rename = renameSync } = {}) {
  mkdirSync(STATE_DIR, { recursive: true })
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  withWindowsRenameRetry(() => rename(tmp, STATE_FILE))
}
