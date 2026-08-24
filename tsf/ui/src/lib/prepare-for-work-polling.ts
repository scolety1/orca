// V1 live-use defect fix: a real bulk Prepare for Work attempt (multiple
// projects, each chaining a live re-scan + baseline + repairs) ran ~9m45s
// and outlived the TSF desktop host's own process -- the one long-lived
// fetch this used to be died with "Failed to fetch," and all progress was
// lost since it lived only in that request's own memory. Prepare for Work
// is now a durable, server-persisted operation (domain/prepare-for-work-
// operation.mjs): POST creates/reacquires it and returns immediately, and
// prepareForWork() here polls its real status until every project
// settles -- so the actual work no longer depends on this fetch, this
// browser tab, or this TSF desktop process instance staying alive for the
// whole duration. Keeps the exact same PrepareForWorkResponse shape
// callers already expect (BulkActionBar/HomePage need no changes).
import type {
  PrepareForWorkOperation,
  PrepareForWorkOperationResponse,
  PrepareForWorkResponse,
  PrepareForWorkResult,
  PrepareForWorkStartResponse
} from './prepare-for-work-types'

const PREPARE_FOR_WORK_POLL_MS = 2000
// Independent review finding (real, confirmed): the poll loop below used
// to be an unbounded `for(;;)` -- if the server keeps responding 200 but
// an operation never reaches COMPLETED (it crashes again and never
// restarts, or gets stuck), the awaiting UI call spun silently forever
// with no visible error and no way out. A genuinely large bulk operation
// can legitimately run a long time, so this stays generous rather than
// racing real work -- it exists to surface a clear, actionable error
// instead of a silent infinite spinner, not to cap normal operation.
const PREPARE_FOR_WORK_POLL_TIMEOUT_MS = 30 * 60 * 1000

// Real V1 stabilization finding: a real "Cannot read properties of
// undefined (reading 'filter')" crash traced back to a mixed-version
// deployment -- the TSF backend was restarted onto this durable-operation
// code without also redeploying the UI bundle, so the still-running old
// frontend received this new {operationId, operation} response shape
// where it expected the old {results: [...]} shape directly, and
// result.results.filter(...) threw. The redeploy fixes THAT specific
// mismatch, but any future skew (a partial deploy, a stale cached bundle,
// a proxy serving an old asset) hits the same class of bug -- so every
// response this module receives from the server is validated before use,
// throwing one clear, catchable error instead of feeding a malformed
// shape into code that assumes it's well-formed. Callers (BulkActionBar,
// HomePage) already catch and display thrown errors -- this turns a page
// crash into an honest, visible message.
function isWellFormedOperation(value: unknown): value is PrepareForWorkOperation {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as PrepareForWorkOperation).projectIds) &&
    typeof (value as PrepareForWorkOperation).results === 'object' &&
    (value as PrepareForWorkOperation).results !== null
  )
}

const VERSION_MISMATCH_HINT =
  'This usually means the TSF desktop app and its background server are running mismatched versions -- try restarting TSF.'

function isOperationSettled(operation: PrepareForWorkOperation): boolean {
  return operation.projectIds.every((id) => operation.results[id]?.settled)
}

// Independent review finding (real, narrow): a well-formed operation
// envelope (isWellFormedOperation already checked that) could still carry
// an individual entry marked settled but missing its own .stages array --
// BulkActionBar's analyzeSelected() calls r.stages.some(...), the same bug
// class one layer deeper. Checked explicitly rather than trusted on
// `settled` alone.
function isWellFormedSettledEntry(entry: unknown): entry is PrepareForWorkResult {
  return (
    !!entry && typeof entry === 'object' && Array.isArray((entry as PrepareForWorkResult).stages)
  )
}

function toPrepareForWorkResponse(operation: PrepareForWorkOperation): PrepareForWorkResponse {
  return {
    ok: true,
    results: operation.projectIds.map((projectId) => {
      const entry = operation.results[projectId]
      return entry?.settled && isWellFormedSettledEntry(entry)
        ? entry
        : { projectId, ok: false, error: 'did not settle', stages: [] }
    })
  }
}

// `get`/`start` are api.ts's own request()-backed calls, threaded through
// rather than imported directly -- avoids a circular import between this
// file and api.ts (api.ts's `prepareForWork` export delegates here).
export async function prepareForWork(
  projectIds: string[],
  start: (projectIds: string[]) => Promise<PrepareForWorkStartResponse>,
  get: (operationId: string) => Promise<PrepareForWorkOperationResponse>
): Promise<PrepareForWorkResponse> {
  const startResponse = await start(projectIds)
  if (typeof startResponse?.operationId !== 'string' || !startResponse.operationId) {
    throw new Error(
      `Prepare for Work did not return a usable operation id. ${VERSION_MISMATCH_HINT}`
    )
  }
  const operation = await pollPrepareForWorkOperation(startResponse.operationId, get)
  return toPrepareForWorkResponse(operation)
}

export async function pollPrepareForWorkOperation(
  operationId: string,
  get: (operationId: string) => Promise<PrepareForWorkOperationResponse>,
  timeoutMs = PREPARE_FOR_WORK_POLL_TIMEOUT_MS
): Promise<PrepareForWorkOperation> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await get(operationId)
    if (!isWellFormedOperation(response?.operation)) {
      throw new Error(
        `Prepare for Work operation ${operationId} came back in an unrecognized shape. ${VERSION_MISMATCH_HINT}`
      )
    }
    const operation = response.operation
    if (isOperationSettled(operation) || operation.status === 'COMPLETED') {
      return operation
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Prepare for Work operation ${operationId} is still running after ${Math.round(timeoutMs / 60000)} minutes -- it has not failed, TSF gave up watching it here. Check back later; the server continues it independently of this page.`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, PREPARE_FOR_WORK_POLL_MS))
  }
}
