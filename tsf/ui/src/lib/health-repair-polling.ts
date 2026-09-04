// BUG-05 (bug-ledger.json): baseline/repair/repair-selected used to be one
// long-lived fetch tracked only in the calling component's own useState --
// navigating away before it resolved lost every way to see what happened,
// even though the real server-side work kept running. Same real defect
// prepare-for-work-polling.ts already fixed for Prepare for Work; this is
// the same fix for Health Repair's own durable operations
// (domain/health-repair-operation.mjs). Keeps the exact same
// BaselineCheckResult/RepairActionResult/RepairSelectedResult shapes every
// existing caller (ProjectHealthRepairCard/HealthRepairCenterPage)
// already expects -- they need no changes beyond which api.ts function
// they call.
import type {
  BaselineCheckResult,
  RepairActionResult,
  RepairSelectedResult,
  HealthRepairOperation,
  HealthRepairOperationResponse,
  HealthRepairOperationStartResponse
} from './health-repair-types'

const HEALTH_REPAIR_POLL_MS = 1000
// Same reasoning as prepare-for-work-polling.ts's own timeout: a genuinely
// slow baseline/repair-selected run should never be raced, but an
// operation that never reaches COMPLETED needs a clear, actionable error
// instead of a silent infinite spinner.
const HEALTH_REPAIR_POLL_TIMEOUT_MS = 30 * 60 * 1000

const VERSION_MISMATCH_HINT =
  'This usually means the TSF desktop app and its background server are running mismatched versions -- try restarting TSF.'

function isWellFormedOperation(value: unknown): value is HealthRepairOperation {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as HealthRepairOperation).projectIds) &&
    typeof (value as HealthRepairOperation).results === 'object' &&
    (value as HealthRepairOperation).results !== null
  )
}

function isOperationSettled(operation: HealthRepairOperation): boolean {
  return operation.projectIds.every((id) => operation.results[id]?.settled)
}

export async function pollHealthRepairOperation(
  operationId: string,
  get: (operationId: string) => Promise<HealthRepairOperationResponse>,
  timeoutMs = HEALTH_REPAIR_POLL_TIMEOUT_MS
): Promise<HealthRepairOperation> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await get(operationId)
    if (!isWellFormedOperation(response?.operation)) {
      throw new Error(
        `Health repair operation ${operationId} came back in an unrecognized shape. ${VERSION_MISMATCH_HINT}`
      )
    }
    const operation = response.operation
    if (isOperationSettled(operation) || operation.status === 'COMPLETED') {
      return operation
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Health repair operation ${operationId} is still running after ${Math.round(timeoutMs / 60000)} minutes -- it has not failed, TSF gave up watching it here. Check back later; the server continues it independently of this page.`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_REPAIR_POLL_MS))
  }
}

async function startAndSettle(
  start: () => Promise<HealthRepairOperationStartResponse>,
  get: (operationId: string) => Promise<HealthRepairOperationResponse>
): Promise<HealthRepairOperation> {
  const startResponse = await start()
  if (typeof startResponse?.operationId !== 'string' || !startResponse.operationId) {
    throw new Error(`Health repair did not return a usable operation id. ${VERSION_MISMATCH_HINT}`)
  }
  return pollHealthRepairOperation(startResponse.operationId, get)
}

export async function healthRepairBaselineDurable(
  projectId: string,
  start: () => Promise<HealthRepairOperationStartResponse>,
  get: (operationId: string) => Promise<HealthRepairOperationResponse>
): Promise<BaselineCheckResult> {
  const operation = await startAndSettle(start, get)
  const result = operation.results[projectId]
  if (!result?.settled || result.ok !== true) {
    throw new Error(
      (result && 'error' in result && typeof result.error === 'string' && result.error) ||
        'Baseline check did not complete successfully.'
    )
  }
  return result as unknown as BaselineCheckResult
}

export async function healthRepairRepairDurable(
  projectId: string,
  start: () => Promise<HealthRepairOperationStartResponse>,
  get: (operationId: string) => Promise<HealthRepairOperationResponse>
): Promise<RepairActionResult> {
  const operation = await startAndSettle(start, get)
  const result = operation.results[projectId]
  if (!result?.settled) {
    throw new Error('Repair did not settle.')
  }
  return result as unknown as RepairActionResult
}

export async function healthRepairSelectedDurable(
  start: () => Promise<HealthRepairOperationStartResponse>,
  get: (operationId: string) => Promise<HealthRepairOperationResponse>
): Promise<RepairSelectedResult> {
  const operation = await startAndSettle(start, get)
  return {
    ok: true,
    results: operation.projectIds.map((projectId) => {
      const entry = operation.results[projectId]
      return entry?.settled
        ? { projectId, ...(entry as unknown as Omit<RepairSelectedResult['results'][number], 'projectId'>) }
        : { projectId, ok: false, error: 'did not settle' }
    })
  }
}
