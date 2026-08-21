// M8 wave 8: orchestrates the real pieces built in waves 2 and 6-7 into
// one TSF_DELIVERY_PLAN_V1 -- proposed calendar dates (computeCriticalPath
// Schedule + hourOffsetToDate), a real deadline-hit probability (reusing
// runMonteCarloEstimate unchanged, never a second probability engine),
// and an honest ON_TRACK/AT_RISK/UNREALISTIC/NO_DEADLINE_SET status. Pure
// domain logic, no I/O -- deterministic for the same WBS/seed/calendar.
import {
  computeCriticalPathSchedule,
  hourOffsetToDate,
  workingHoursBetween
} from './delivery-scheduling.mjs'
import { runMonteCarloEstimate } from './estimation.mjs'

// Deliberately conservative, documented thresholds (not Tim-specified
// exact numbers) -- ON_TRACK requires a real, comfortable margin above
// a coin-flip, AT_RISK is a genuine warning zone, anything below is
// honestly UNREALISTIC rather than softened.
const ON_TRACK_AT_OR_ABOVE = 0.8
const AT_RISK_AT_OR_ABOVE = 0.4

export function buildDeliveryPlan({
  wbs,
  startDate,
  deadlineDate = null,
  maxConcurrent = 1,
  calendarOptions = {},
  seed = 1,
  runs = 10_000
}) {
  const schedule = computeCriticalPathSchedule(wbs, { maxConcurrent })
  const scheduleWithDates = schedule.schedule.map((entry) => ({
    ...entry,
    startDate: hourOffsetToDate(entry.startHour, { startDate, ...calendarOptions }),
    endDate: hourOffsetToDate(entry.endHour, { startDate, ...calendarOptions })
  }))
  const projectEndDate = hourOffsetToDate(schedule.totalDurationHours, {
    startDate,
    ...calendarOptions
  })

  const deadlineHours = deadlineDate
    ? workingHoursBetween(startDate, deadlineDate, calendarOptions)
    : null
  const estimate = runMonteCarloEstimate(wbs, { seed, runs, deadlineHours })

  let status
  if (deadlineDate === null) {
    status = 'NO_DEADLINE_SET'
  } else if (estimate.deadlineProbability >= ON_TRACK_AT_OR_ABOVE) {
    status = 'ON_TRACK'
  } else if (estimate.deadlineProbability >= AT_RISK_AT_OR_ABOVE) {
    status = 'AT_RISK'
  } else {
    status = 'UNREALISTIC'
  }

  return {
    schemaVersion: 'TSF_DELIVERY_PLAN_V1',
    schedule: scheduleWithDates,
    projectEndDate,
    deadlineDate,
    deadlineProbability: estimate.deadlineProbability,
    status,
    estimate
  }
}
