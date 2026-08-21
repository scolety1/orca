// Mirrors tsf/domain/fleet-optimizer.mjs's real TSF_FLEET_SCHEDULE_V1
// shape as served by tsf/server/fleet-optimizer-http-routes.mjs. Kept in
// its own file rather than lib/types.ts to avoid growing that file past
// the repo's max-lines lint limit.
export type FleetScheduledTask = {
  id: string
  title: string
  startHour: number
  endHour: number
  durationHours: number
}

export type FleetProjectSchedule = {
  projectId: string
  priority: number
  schedule: FleetScheduledTask[]
  totalDurationHours: number | null
  deadlineHours: number | null
  deadlineMet: boolean | null
  reasoning: string
}

export type FleetSchedule = {
  schemaVersion: string
  requestedConcurrency: number
  effectiveConcurrency: number
  providerId: string
  capacityAction: string
  capacityReason: string
  projects: FleetProjectSchedule[]
}

export type FleetScheduleResponse = { ok: true; schedule: FleetSchedule }
export type FleetScheduleError = { ok: false; error: string; detail?: string }
