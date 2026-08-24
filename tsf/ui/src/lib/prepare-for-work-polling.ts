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

function isOperationSettled(operation: PrepareForWorkOperation): boolean {
  return operation.projectIds.every((id) => operation.results[id]?.settled)
}

function toPrepareForWorkResponse(operation: PrepareForWorkOperation): PrepareForWorkResponse {
  return {
    ok: true,
    results: operation.projectIds.map((projectId) => {
      const entry = operation.results[projectId]
      return entry?.settled ? entry : { projectId, ok: false, error: 'did not settle', stages: [] }
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
  const { operationId } = await start(projectIds)
  const operation = await pollPrepareForWorkOperation(operationId, get)
  return toPrepareForWorkResponse(operation)
}

export async function pollPrepareForWorkOperation(
  operationId: string,
  get: (operationId: string) => Promise<PrepareForWorkOperationResponse>,
  timeoutMs = PREPARE_FOR_WORK_POLL_TIMEOUT_MS
): Promise<PrepareForWorkOperation> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { operation } = await get(operationId)
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
