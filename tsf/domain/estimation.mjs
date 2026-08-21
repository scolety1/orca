// M8: pure, deterministic project-estimation engine (TSF_PROJECT_ESTIMATE_V1,
// see tsf/contracts/project-estimate.schema.v1.json). No I/O, no provider
// calls, no randomness that isn't seed-derived -- the same fixed WBS +
// seed always produces byte-identical output (Tim's own #1 acceptance
// requirement). Reimplements the "Simple Project Estimates"/"EstimatorX"
// harvested CONCEPTS (three-point ranges, clarity/confidence-weighted
// uncertainty, seeded Monte Carlo, percentile output) from scratch as a
// small domain module -- no external estimation library/runtime is
// installed, per the harvest-concepts-not-runtimes discipline this whole
// program has followed since M2.
//
// Deliberately bounded (wave 2's own scope): this module sums each task's
// three-point ranges independently -- it does NOT do dependency-graph/
// critical-path scheduling (a task's `dependencies`/`conflictsWith`
// fields are validated but otherwise unused here). Real dependency-aware
// wall-clock scheduling is the Delivery Planner's job (a later wave);
// this module's own "wallClockHours" output is an honestly-labeled,
// no-parallelism sum (active effort + human review + external wait),
// not a scheduled delivery date.

const VALID_RISKS = new Set(['LOW', 'MODERATE', 'HIGH', null, undefined])
const VALID_ROLES = new Set([
  'PLANNER_DEEP',
  'PLANNER_BALANCED',
  'WORKER_CHEAP',
  'WORKER_BALANCED',
  'WORKER_DEEP',
  'VERIFIER_INDEPENDENT',
  null,
  undefined
])

function assertThreePoint(value, label) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} must be a {min, expected, max} object`)
  }
  const { min, expected, max } = value
  for (const [key, n] of [
    ['min', min],
    ['expected', expected],
    ['max', max]
  ]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new Error(`${label}.${key} must be a finite number >= 0`)
    }
  }
  if (!(min <= expected && expected <= max)) {
    throw new Error(
      `${label} must satisfy min <= expected <= max (got ${min}, ${expected}, ${max})`
    )
  }
  return { min, expected, max }
}

const ZERO_THREE_POINT = Object.freeze({ min: 0, expected: 0, max: 0 })

// Validates and normalizes one raw WBS task into a computation-ready
// shape with every optional field defaulted explicitly (never silently
// `undefined` mid-calculation). Throws on any real structural problem --
// no partial/best-effort acceptance, matching this program's own
// fail-closed-on-malformed-input discipline (M7's own memory-record
// validation is the direct precedent).
export function normalizeWbsTask(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('WBS task must be an object')
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('WBS task requires a non-empty id')
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new Error(`WBS task ${raw.id} requires a non-empty title`)
  }
  const clarity = raw.clarity ?? 0.7
  const confidence = raw.confidence ?? 0.7
  for (const [key, n] of [
    ['clarity', clarity],
    ['confidence', confidence]
  ]) {
    if (typeof n !== 'number' || n < 0 || n > 1) {
      throw new Error(`WBS task ${raw.id}: ${key} must be a number in [0, 1]`)
    }
  }
  if (!VALID_RISKS.has(raw.risk ?? null)) {
    throw new Error(`WBS task ${raw.id}: invalid risk value ${raw.risk}`)
  }
  if (!VALID_ROLES.has(raw.providerRoleHint ?? null)) {
    throw new Error(`WBS task ${raw.id}: invalid providerRoleHint ${raw.providerRoleHint}`)
  }
  return {
    id: raw.id,
    title: raw.title,
    stage: raw.stage ?? null,
    category: raw.category ?? null,
    dependencies: [...(raw.dependencies ?? [])],
    conflictsWith: [...(raw.conflictsWith ?? [])],
    activeEffortHours: assertThreePoint(
      raw.activeEffortHours,
      `WBS task ${raw.id}.activeEffortHours`
    ),
    humanReviewHours: raw.humanReviewHours
      ? assertThreePoint(raw.humanReviewHours, `WBS task ${raw.id}.humanReviewHours`)
      : ZERO_THREE_POINT,
    externalWaitHours: raw.externalWaitHours
      ? assertThreePoint(raw.externalWaitHours, `WBS task ${raw.id}.externalWaitHours`)
      : ZERO_THREE_POINT,
    clarity,
    confidence,
    risk: raw.risk ?? null,
    providerRoleHint: raw.providerRoleHint ?? null,
    assumptions: [...(raw.assumptions ?? [])],
    evidence: [...(raw.evidence ?? [])],
    blockers: [...(raw.blockers ?? [])],
    directCostItems: [...(raw.directCostItems ?? [])]
  }
}

export function normalizeWbs(rawTasks) {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new Error('a WBS must be a non-empty array of tasks')
  }
  const tasks = rawTasks.map(normalizeWbsTask)
  const seen = new Set()
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`duplicate WBS task id: ${task.id}`)
    }
    seen.add(task.id)
  }
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (!seen.has(depId)) {
        throw new Error(`WBS task ${task.id} depends on unknown task id ${depId}`)
      }
    }
    // Matches the dependencies check above -- a typo'd or dangling
    // conflictsWith id would otherwise silently fail to produce its
    // intended scheduling constraint (delivery-scheduling.mjs's own
    // conflict check simply never matches a nonexistent id), with no
    // error at any layer. A real, independently-found gap (M8 wave 6
    // review) -- fixed here rather than left asymmetric with dependencies.
    for (const conflictId of task.conflictsWith) {
      if (!seen.has(conflictId)) {
        throw new Error(`WBS task ${task.id} conflictsWith unknown task id ${conflictId}`)
      }
    }
  }
  return tasks
}

// Clarity/confidence widen the effective range around `expected` when
// low -- distinct multipliers (EstimatorX's own "Clarity separate from
// Confidence" concept), capped so a single task can never dominate a
// simulation with an unbounded tail.
const MAX_WIDEN_MULTIPLIER = 3
function widenedRange({ min, expected, max }, clarity, confidence) {
  const widenFactor = 1 + (1 - clarity) * 1 + (1 - confidence) * 1
  const cappedFactor = Math.min(widenFactor, MAX_WIDEN_MULTIPLIER)
  const belowSpread = (expected - min) * cappedFactor
  const aboveSpread = (max - expected) * cappedFactor
  return { min: Math.max(0, expected - belowSpread), expected, max: expected + aboveSpread }
}

// Deterministic, seedable PRNG (mulberry32) -- no external dependency,
// same seed always produces the same sequence.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Samples a triangular distribution (min a, mode c, max b) given a
// uniform random draw u in [0, 1) -- the standard closed-form inverse
// CDF, no rejection sampling needed.
export function sampleTriangular(min, mode, max, u) {
  if (min === max) {
    return min
  }
  const modeCdf = (mode - min) / (max - min)
  if (u < modeCdf) {
    return min + Math.sqrt(u * (max - min) * (mode - min))
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode))
}

function percentile(sortedValues, p) {
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((p / 100) * (sortedValues.length - 1)))
  )
  return sortedValues[idx]
}

// Runs the deterministic-seeded Monte Carlo simulation over a normalized
// WBS. Returns per-clock percentiles (active engineering effort, human/
// operator effort, wall-clock -- kept as 3 separate distributions,
// never collapsed into one number) plus deadline-hit probabilities if
// deadlineHours values are supplied. `runs` defaults to 10,000 (Tim's
// own spec: "Typical simulations: 10,000+").
export function runMonteCarloEstimate(
  wbsTasks,
  { seed = 1, runs = 10_000, deadlineHours = null } = {}
) {
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be an integer for reproducibility')
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('runs must be a positive integer')
  }
  const rand = mulberry32(seed)
  const activeTotals = Array.from({ length: runs })
  const humanTotals = Array.from({ length: runs })
  const wallClockTotals = Array.from({ length: runs })

  for (let i = 0; i < runs; i++) {
    let active = 0
    let human = 0
    let wait = 0
    for (const task of wbsTasks) {
      const activeRange = widenedRange(task.activeEffortHours, task.clarity, task.confidence)
      active += sampleTriangular(
        activeRange.min,
        Math.min(Math.max(activeRange.expected, activeRange.min), activeRange.max),
        activeRange.max,
        rand()
      )
      const humanRange = widenedRange(task.humanReviewHours, task.clarity, task.confidence)
      human += sampleTriangular(
        humanRange.min,
        Math.min(Math.max(humanRange.expected, humanRange.min), humanRange.max),
        humanRange.max,
        rand()
      )
      const waitRange = widenedRange(task.externalWaitHours, task.clarity, task.confidence)
      wait += sampleTriangular(
        waitRange.min,
        Math.min(Math.max(waitRange.expected, waitRange.min), waitRange.max),
        waitRange.max,
        rand()
      )
    }
    activeTotals[i] = active
    humanTotals[i] = human
    // Wave-2 wall-clock: an honestly-labeled, no-parallelism sum of all 3
    // clocks -- NOT a scheduled delivery date (that needs the
    // dependency-aware Delivery Planner, a later wave).
    wallClockTotals[i] = active + human + wait
  }

  activeTotals.sort((a, b) => a - b)
  humanTotals.sort((a, b) => a - b)
  wallClockTotals.sort((a, b) => a - b)

  const percentilesOf = (sorted) => ({
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p80: percentile(sorted, 80),
    p95: percentile(sorted, 95),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length
  })

  const deadlineProbability =
    deadlineHours === null
      ? null
      : wallClockTotals.filter((total) => total <= deadlineHours).length / wallClockTotals.length

  return {
    schemaVersion: 'TSF_PROJECT_ESTIMATE_RESULT_V1',
    seed,
    runs,
    activeEffortHours: percentilesOf(activeTotals),
    humanEffortHours: percentilesOf(humanTotals),
    wallClockHours: percentilesOf(wallClockTotals),
    deadlineProbability
  }
}
