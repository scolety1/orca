import type {
  BaselineCheckResult,
  RepairActionResult,
  RepairSelectedResult
} from './health-repair-types'

export type HealthRepairActivityKind = 'BASELINE' | 'REPAIR' | 'REPAIR_SELECTED'
export type HealthRepairActivityResult =
  | BaselineCheckResult
  | RepairActionResult
  | RepairSelectedResult

export type HealthRepairActivity = {
  operationId: string
  kind: HealthRepairActivityKind
  projectIds: string[]
  cause?: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  startedAt: string
  result?: HealthRepairActivityResult
  error?: string
}

const activities = new Map<string, HealthRepairActivity>()
const listeners = new Set<(value: HealthRepairActivity[]) => void>()
let sequence = 0

export function listHealthRepairActivities(): HealthRepairActivity[] {
  return [...activities.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function notify() {
  const snapshot = listHealthRepairActivities()
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function subscribeHealthRepairActivities(
  listener: (value: HealthRepairActivity[]) => void
): () => void {
  listeners.add(listener)
  listener(listHealthRepairActivities())
  return () => listeners.delete(listener)
}

export function startHealthRepairActivity({
  kind,
  projectIds,
  cause,
  run
}: {
  kind: HealthRepairActivityKind
  projectIds: string[]
  cause?: string
  run: () => Promise<HealthRepairActivityResult>
}): HealthRepairActivity {
  const existing = listHealthRepairActivities().find(
    (activity) =>
      activity.status === 'RUNNING' &&
      activity.kind === kind &&
      activity.cause === cause &&
      activity.projectIds.length === projectIds.length &&
      activity.projectIds.every((id) => projectIds.includes(id))
  )
  if (existing) {
    return existing
  }

  const operationId = `health-${Date.now()}-${++sequence}`
  const activity: HealthRepairActivity = {
    operationId,
    kind,
    projectIds: [...projectIds],
    ...(cause ? { cause } : {}),
    status: 'RUNNING',
    startedAt: new Date().toISOString()
  }
  activities.set(operationId, activity)
  notify()
  Promise.resolve()
    .then(run)
    .then((result) => {
      activities.set(operationId, { ...activity, status: 'COMPLETED', result })
      notify()
    })
    .catch((error) => {
      activities.set(operationId, {
        ...activity,
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error)
      })
      notify()
    })
  return activity
}
