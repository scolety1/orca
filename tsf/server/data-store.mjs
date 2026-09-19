// Tiny local JSON persistence for operator-set state (Usage Mode, Work Set,
// the fixture candidate's decision). Not synced anywhere, not a database —
// one file, read on demand, written atomically. Gitignored.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createPortfolio } from '../domain/portfolio.mjs'

const HERE = import.meta.dirname
const STATE_DIR = path.join(HERE, '.local-state')
const REAL_DEFAULT_STATE_FILE = path.join(STATE_DIR, 'operator-state.json')

// TSF-SAFE-UI-001-ROOT-CAUSE (fixture-pollution incident, 2026-09-14):
// this used to be a module-level `const STATE_FILE = process.env.TSF_UI_STATE_FILE
// || REAL_DEFAULT_STATE_FILE`, resolved ONCE at first import. A caller that sets
// TSF_UI_STATE_FILE only AFTER something else in the same process already
// imported this module (any process that loads more than one file/module
// graph sharing this module registry -- e.g. a batched/aggregated test run)
// got permanently stuck on whatever STATE_FILE resolved to first, silently
// ignoring its own later override. That is exactly how
// tsf-command-operator-integration-nytheria-* test fixtures ended up written
// into the REAL owner state file even though the test itself does set
// TSF_UI_STATE_FILE before importing the server -- see
// docs/tsf/TSF_FIXTURE_POLLUTION_RECONCILIATION_V1.md. Resolving live, on
// every call, makes the override authoritative regardless of import order or
// process-sharing, and makes the fail-closed disposable-runtime check
// (TSF-SAFE-UI-001) re-evaluate every time instead of only once.
function resolveStateFile() {
  const override = process.env.TSF_UI_STATE_FILE
  const resolved = override || REAL_DEFAULT_STATE_FILE
  // TSF-SAFE-UI-001: a disposable/test dogfood runtime sets BOTH
  // TSF_UI_STATE_FILE (its own isolated path) and TSF_DISPOSABLE_RUNTIME=1
  // to declare its intent -- if TSF_UI_STATE_FILE fails to actually
  // propagate (a real PowerShell/Bash env-var-to-child-process quirk
  // already hit once this program), resolved silently falls back to the
  // REAL owner's own default path, and a disposable server would read/write
  // real owner data without anyone noticing. Fails closed on every
  // resolution -- every real caller of loadState/saveState/getStateFilePath
  // transitively imports this module, so a misconfigured disposable
  // runtime can never reach any of them.
  if (process.env.TSF_DISPOSABLE_RUNTIME === '1' && resolved === REAL_DEFAULT_STATE_FILE) {
    throw new Error(
      'TSF-SAFE-UI-001: this process is marked TSF_DISPOSABLE_RUNTIME=1 but TSF_UI_STATE_FILE resolved to the real default owner state file -- refusing to start rather than risk mutating real owner data. TSF_UI_STATE_FILE likely failed to propagate to this process.'
    )
  }
  return resolved
}

// Also fail closed at MODULE LOAD time (not only on first loadState/
// saveState/getStateFilePath call): a misconfigured disposable runtime
// must never get to run ANY of its own code first, even code that never
// touches state I/O. resolveStateFile() re-checks on every call for the
// process-sharing/import-order hazard above; this one extra call preserves
// the original "refuses to even start" guarantee for the ordinary case
// where TSF_DISPOSABLE_RUNTIME is wrong from the process's very first
// instant.
resolveStateFile()

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
  researchLibrary: null, // TSF_RESEARCH_LIBRARY_V1 singleton, or null before first use (see tsf/domain/research-library.mjs)
  completionWatches: {}, // watchId -> TSF_COMPLETION_WATCH_V1 (see tsf/domain/completion-watch.mjs)
  projectMemory: {}, // projectId -> TSF_PROJECT_MEMORY_V1 (see tsf/domain/project-memory.mjs)
  projectEstimates: {}, // projectId -> TSF_PROJECT_ESTIMATE_RESULT_V1 (see tsf/server/estimate-http-routes.mjs)
  estimateActuals: {}, // projectId -> TSF_ESTIMATE_ACTUAL_V1[] (see tsf/domain/estimate-calibration.mjs)
  evalRuns: {}, // packId -> TSF_EVAL_RUN_RESULT_V1[], append-only (see tsf/server/eval-http-routes.mjs)
  prepareForWorkOperations: {}, // operationId -> TSF_PREPARE_FOR_WORK_OPERATION_V1 (see tsf/domain/prepare-for-work-operation.mjs)
  healthRepairOperations: {}, // operationId -> TSF_HEALTH_REPAIR_OPERATION_V1 (see tsf/domain/health-repair-operation.mjs) -- BUG-05
  plannerMissions: {}, // missionId -> { lease, checkpoint: TSF_PLANNER_MISSION_CHECKPOINT_V1 } (see tsf/server/planner-mission-store.mjs)
  platformLearningLedger: null, // TSF_PLATFORM_LEARNING_LEDGER_V1 singleton, or null before first use (see tsf/domain/platform-learning-ledger.mjs)
  cleanupRequests: {}, // requestId -> TSF_CLEANUP_REQUEST_RECORD_V1 { recommendation, plan, authorization, executions[], receipts[] } (see tsf/server/cleanup-request-store.mjs)
  selfImprovementFindings: {}, // findingId -> TSF_SELF_IMPROVEMENT_FINDING_V1 (see tsf/domain/self-improvement-finding.mjs, tsf/server/self-improvement-finding-store.mjs)
  selfImprovementReceipts: {}, // missionId -> TSF_SELF_IMPROVEMENT_RECEIPT_V1[] hash-chained receipts (see tsf/domain/self-improvement-receipt-chain.mjs, tsf/server/self-improvement-receipt-store.mjs)
  attentionNotificationEvents: {}, // eventId -> TSF_ATTENTION_NOTIFICATION_EVENT_V1 (see tsf/domain/attention-notification-event.mjs, tsf/server/attention-notification-event-store.mjs)
  projectExecutionHolds: {}, // projectId -> TSF_PROJECT_EXECUTION_HOLD_V1 (see tsf/domain/project-execution-hold.mjs, tsf/server/project-execution-hold-store.mjs)
  projectCanonicalBases: {}, // projectId -> TSF_PROJECT_CANONICAL_BASE_V1 (see tsf/server/project-canonical-base-store.mjs)
  commandFocus: null // TSF_COMMAND_FOCUS_V1 | null -- durable Command conversation focus (see tsf/domain/command-conversation-focus.mjs). A durable pointer, not an append-only log -- deliberately NOT nested inside chatThreads.
  // Resource Pressure Governor leases are NOT stored here -- see
  // server/resource-pressure-lease-store.mjs: they must be host-wide
  // (shared across every worktree's own TSF server process), not scoped to
  // this per-worktree opState file.
}

// Exposes the real state file path (honoring the same TSF_UI_STATE_FILE
// test-isolation override loadState/saveState use) so a caller that needs
// its own file-based lock scoped to this exact file -- keep-going-run-
// store.mjs's cross-process lock -- can derive a sibling lock path
// without duplicating the override logic.
export function getStateFilePath() {
  return resolveStateFile()
}

export function loadState() {
  const stateFile = resolveStateFile()
  if (!existsSync(stateFile)) {
    return structuredClone(DEFAULTS)
  }
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(stateFile, 'utf8')) }
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
      if (
        process.platform !== 'win32' ||
        !retryable ||
        attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length
      ) {
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
  const stateFile = resolveStateFile()
  mkdirSync(path.dirname(stateFile), { recursive: true })
  const tmp = `${stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  withWindowsRenameRetry(() => rename(tmp, stateFile))
}
