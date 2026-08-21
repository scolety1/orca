// M8 wave 6: dependency-aware delivery scheduling over a normalized WBS
// (tsf/domain/estimation.mjs's own normalizeWbs output). Replaces wave 2's
// honestly-disclosed "wallClockHours is a naive no-parallelism sum" with a
// real critical-path-aware schedule.
//
// Deliberately a simple, deterministic GREEDY heuristic, not a globally
// optimal solver -- resource-constrained project scheduling is NP-hard in
// general, and Tim's own M12 spec explicitly reserves a heavier solver
// (OR-Tools/CP-SAT, OPTIONAL_SOLVER_BACKEND) for the harder MULTI-PROJECT
// fleet-optimization problem later. For one project's own delivery
// schedule, a real dependency/conflict-respecting greedy placement is
// what this wave delivers; conceptually the same "batch by conflict, cap
// concurrency" idea keep-going.mjs's own planWave already uses for a
// single wave, extended here with real topological dependency ordering
// (planWave has none -- it only avoids scope conflicts within one
// already-ready batch).
//
// Uses each task's EXPECTED (not P50/P80/P95) active-effort hours for a
// single deterministic calendar placement -- overall uncertainty is
// reported separately via estimation.mjs's own runMonteCarloEstimate
// percentiles; this module answers a different question ("what order
// and dates result from real dependency/conflict/concurrency
// constraints"), not "how uncertain is the total."

// Kahn's algorithm, stable order among tasks with no remaining
// dependencies (input array order, for determinism). Throws honestly on
// a real dependency cycle rather than silently guessing an order --
// normalizeWbs already guarantees every dependency id exists, but not
// that the graph is acyclic.
export function topologicalOrder(wbsTasks) {
  const remaining = new Map(wbsTasks.map((t) => [t.id, new Set(t.dependencies)]))
  const placed = new Set()
  const order = []
  while (placed.size < wbsTasks.length) {
    const ready = wbsTasks.filter(
      (t) => !placed.has(t.id) && [...remaining.get(t.id)].every((d) => placed.has(d))
    )
    if (ready.length === 0) {
      const unplaced = wbsTasks.filter((t) => !placed.has(t.id)).map((t) => t.id)
      const error = new Error(`WBS has a dependency cycle among: ${unplaced.join(', ')}`)
      error.code = 'TSF_WBS_DEPENDENCY_CYCLE'
      throw error
    }
    for (const task of ready) {
      order.push(task)
      placed.add(task.id)
    }
  }
  return order
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

// Greedily places every task in topological order, respecting: (1) a
// task can't start before all its dependencies finish; (2) two tasks
// sharing a conflictsWith relationship never run in overlapping time
// windows, in either direction; (3) at most `maxConcurrent` tasks are
// ever in flight (started but not finished) at the same instant.
export function computeCriticalPathSchedule(wbsTasks, { maxConcurrent = 1 } = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('maxConcurrent must be a positive integer')
  }
  const order = topologicalOrder(wbsTasks)
  const finishHour = new Map()
  const scheduled = []

  for (const task of order) {
    const duration = task.activeEffortHours.expected
    let candidateStart = task.dependencies.length
      ? Math.max(...task.dependencies.map((d) => finishHour.get(d)))
      : 0

    // Repeatedly push the candidate start forward until it satisfies
    // both the conflict-exclusion and concurrency-cap constraints --
    // bounded by the schedule size, so a real logic bug fails loudly
    // (TSF_SCHEDULING_DID_NOT_CONVERGE) instead of looping forever.
    const maxAttempts = scheduled.length + 2
    let converged = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const conflicting = scheduled.filter(
        (other) =>
          (task.conflictsWith.includes(other.id) || other.conflictsWith.includes(task.id)) &&
          intervalsOverlap(
            candidateStart,
            candidateStart + duration,
            other.startHour,
            other.endHour
          )
      )
      if (conflicting.length > 0) {
        candidateStart = Math.max(...conflicting.map((c) => c.endHour))
        continue
      }
      const inFlightAtStart = scheduled.filter((other) =>
        intervalsOverlap(candidateStart, candidateStart + duration, other.startHour, other.endHour)
      )
      if (inFlightAtStart.length >= maxConcurrent) {
        candidateStart = Math.min(...inFlightAtStart.map((o) => o.endHour))
        continue
      }
      converged = true
      break
    }
    if (!converged) {
      const error = new Error(
        'scheduling did not converge -- this is a real logic bug, not bad input'
      )
      error.code = 'TSF_SCHEDULING_DID_NOT_CONVERGE'
      throw error
    }

    const end = candidateStart + duration
    finishHour.set(task.id, end)
    scheduled.push({
      id: task.id,
      title: task.title,
      conflictsWith: task.conflictsWith,
      startHour: candidateStart,
      endHour: end,
      durationHours: duration
    })
  }

  const totalDurationHours = scheduled.length ? Math.max(...scheduled.map((s) => s.endHour)) : 0
  return {
    schemaVersion: 'TSF_DELIVERY_SCHEDULE_V1',
    schedule: scheduled,
    totalDurationHours,
    maxConcurrent
  }
}

// A trivial working calendar: N working hours/day, Monday-Friday by
// default, skipping any date in `blackoutDates` (an array of 'YYYY-MM-DD'
// strings). Converts an hour-offset (from computeCriticalPathSchedule)
// into a real calendar Date, honestly -- no attempt to model partial-day
// task-splitting precision beyond whole hours.
export function hourOffsetToDate(
  hourOffset,
  { startDate, hoursPerDay = 8, workingWeekdays = [1, 2, 3, 4, 5], blackoutDates = [] } = {}
) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    throw new Error('startDate must be a real Date')
  }
  const blackoutSet = new Set(blackoutDates)
  const cursor = new Date(startDate.getTime())
  let remainingHours = hourOffset
  while (remainingHours > 0) {
    const dateKey = cursor.toISOString().slice(0, 10)
    const isWorkingDay = workingWeekdays.includes(cursor.getUTCDay()) && !blackoutSet.has(dateKey)
    if (isWorkingDay) {
      const consumed = Math.min(remainingHours, hoursPerDay)
      remainingHours -= consumed
      if (remainingHours <= 0) {
        return cursor
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return cursor
}

// Inverse of hourOffsetToDate: counts real working hours between
// startDate and a target endDate under the same calendar rules. Used to
// turn a Tim-supplied deadline calendar date into an hour budget
// runMonteCarloEstimate's own deadlineHours parameter can consume.
// Returns 0 (never negative) if endDate is on/before startDate.
export function workingHoursBetween(
  startDate,
  endDate,
  { hoursPerDay = 8, workingWeekdays = [1, 2, 3, 4, 5], blackoutDates = [] } = {}
) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    throw new Error('startDate must be a real Date')
  }
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    throw new Error('endDate must be a real Date')
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return 0
  }
  const blackoutSet = new Set(blackoutDates)
  const cursor = new Date(startDate.getTime())
  let hours = 0
  while (cursor.getTime() < endDate.getTime()) {
    const dateKey = cursor.toISOString().slice(0, 10)
    if (workingWeekdays.includes(cursor.getUTCDay()) && !blackoutSet.has(dateKey)) {
      hours += hoursPerDay
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return hours
}
