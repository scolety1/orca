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

export function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, STATE_FILE)
}
