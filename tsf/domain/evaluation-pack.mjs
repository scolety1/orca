// M9 wave 2: a pure, TSF-native evaluation engine. Concepts borrowed from
// Promptfoo and similar tooling (test cases/assertions, side-by-side
// comparison, regression thresholds) -- no external eval framework taken
// as a dependency, per wave 1's own research decision. Everything here is
// pure/deterministic given a real, already-produced actual output; this
// module never calls a planner/worker/verifier itself (that belongs to
// the caller -- see the per-category eval-pack wiring in later waves).
export const EVAL_CATEGORIES = Object.freeze([
  'PLANNER',
  'WORKER',
  'VERIFIER',
  'ROUTING',
  'MEMORY',
  'AUTONOMY',
  'ESTIMATOR',
  // Phase 1 (UI_DOGFOOD_AGENT_V0): scores the dogfood rubric (finding
  // taxonomy/severity/auto-fix-eligibility/dedup) -- see
  // tsf/domain/ui-dogfood-finding.mjs.
  'UI_DOGFOOD',
  // Phase 13 (Evaluation/Regression Quality): acceptance-level proof that
  // a whole real pipeline composes end to end in one run -- not another
  // per-function unit-test category. See platform-golden-path-eval-*.mjs
  // and research-golden-path-eval-*.mjs.
  'GOLDEN_PATH',
  // TSF Reconcile & Upgrade Protocol V1: the protocol's own disposable
  // pilot -- proves the 5 seeded classification outcomes (ALREADY_SOLVED,
  // PARTIALLY_SOLVED, REAL_BUG, STALE_DOC, UPGRADE_OPPORTUNITY) each
  // reach the real, expected disposition through real self-improvement-
  // finding.mjs/adoption machinery, never a hand-typed stand-in. See
  // reconcile-upgrade-eval-cases.mjs / reconcile-upgrade-eval-runner.mjs.
  'RECONCILE_UPGRADE'
])

const ASSERTION_TYPES = new Set(['EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'MATCHES', 'GTE', 'LTE'])

function getByPath(obj, path) {
  if (path === '') {
    return obj
  }
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj)
}

function deepEqual(a, b) {
  if (a === b) {
    return true
  }
  if (typeof a !== typeof b) {
    return false
  }
  if (a === null || b === null) {
    return false
  }
  if (typeof a !== 'object') {
    return false
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every((key) => deepEqual(a[key], b[key]))
}

// Fail-closed validation, matching the rest of this codebase's normalize*
// functions (estimation.mjs's normalizeWbsTask, project-memory.mjs's
// addMemoryRecord) -- an invalid pack is a thrown error, never silently
// patched into something runnable.
export function normalizeEvalPack(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('eval pack must be an object')
  }
  if (!EVAL_CATEGORIES.includes(raw.category)) {
    throw new Error(`eval pack ${raw.packId}: unknown category ${raw.category}`)
  }
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error(`eval pack ${raw.packId}: at least one case is required`)
  }
  const seen = new Set()
  const cases = raw.cases.map((rawCase) => {
    if (typeof rawCase.id !== 'string' || !rawCase.id.trim()) {
      throw new Error(`eval pack ${raw.packId}: every case requires a non-empty id`)
    }
    if (seen.has(rawCase.id)) {
      throw new Error(`eval pack ${raw.packId}: duplicate case id ${rawCase.id}`)
    }
    seen.add(rawCase.id)
    if (!Array.isArray(rawCase.assertions) || rawCase.assertions.length === 0) {
      throw new Error(`eval case ${rawCase.id}: at least one assertion is required`)
    }
    const assertions = rawCase.assertions.map((assertion, index) => {
      if (!ASSERTION_TYPES.has(assertion.type)) {
        throw new Error(
          `eval case ${rawCase.id}, assertion ${index}: unknown type ${assertion.type}`
        )
      }
      if (typeof assertion.path !== 'string') {
        throw new Error(`eval case ${rawCase.id}, assertion ${index}: path is required`)
      }
      // Without this, an assertion with a typo'd path (resolving to
      // undefined) AND a forgotten value field would silently PASS --
      // undefined === undefined -- rather than erroring or failing loudly,
      // defeating the entire point of an eval engine whose job is
      // trustworthy regression detection. `value: null` is a legitimate,
      // deliberate assertion and stays allowed; only a missing key is
      // rejected.
      if (!('value' in assertion)) {
        throw new Error(`eval case ${rawCase.id}, assertion ${index}: value is required`)
      }
      return { ...assertion }
    })
    return {
      id: rawCase.id,
      description: rawCase.description ?? '',
      input: rawCase.input ?? null,
      tags: [...(rawCase.tags ?? [])],
      assertions
    }
  })
  return {
    schemaVersion: 'TSF_EVAL_PACK_V1',
    packId: raw.packId,
    version: raw.version,
    category: raw.category,
    description: raw.description ?? '',
    cases
  }
}

// Scores exactly one assertion against a real actual output. Never throws
// on a mismatch -- a failed assertion is a normal, expected result, not an
// exceptional condition.
export function scoreAssertion(actualOutput, assertion) {
  const actual = getByPath(actualOutput, assertion.path)
  switch (assertion.type) {
    case 'EQUALS':
      return deepEqual(actual, assertion.value)
    case 'CONTAINS':
      if (typeof actual === 'string') {
        return actual.includes(assertion.value)
      }
      if (Array.isArray(actual)) {
        return actual.some((item) => deepEqual(item, assertion.value))
      }
      return false
    case 'NOT_CONTAINS':
      if (typeof actual === 'string') {
        return !actual.includes(assertion.value)
      }
      if (Array.isArray(actual)) {
        return !actual.some((item) => deepEqual(item, assertion.value))
      }
      return true
    case 'MATCHES':
      return typeof actual === 'string' && new RegExp(assertion.value).test(actual)
    case 'GTE':
      return typeof actual === 'number' && actual >= assertion.value
    case 'LTE':
      return typeof actual === 'number' && actual <= assertion.value
    default:
      return false
  }
}

// A case passes only if EVERY one of its assertions passes -- matching
// this program's fail-closed default everywhere else (a partially-correct
// output is not silently rounded up to a pass).
export function scoreCase(actualOutput, evalCase) {
  const assertionResults = evalCase.assertions.map((assertion) => ({
    type: assertion.type,
    path: assertion.path,
    passed: scoreAssertion(actualOutput, assertion)
  }))
  return {
    caseId: evalCase.id,
    passed: assertionResults.every((r) => r.passed),
    assertionResults
  }
}

// Runs a whole pack against a real, already-produced map of
// caseId -> actualOutput. A case with no actual output supplied is
// honestly reported as ERRORED (not silently skipped, and not counted as
// a pass) -- the caller failed to run it, which is itself real
// information (matches acceptance item 7: a broken/incomplete run must
// never be misreported as a clean pass).
export function runEvalPack(pack, actualOutputsByCaseId, clock = () => new Date()) {
  const results = pack.cases.map((evalCase) => {
    if (!(evalCase.id in actualOutputsByCaseId)) {
      return { caseId: evalCase.id, passed: false, errored: true, assertionResults: [] }
    }
    return { ...scoreCase(actualOutputsByCaseId[evalCase.id], evalCase), errored: false }
  })
  const passedCases = results.filter((r) => r.passed).length
  return {
    schemaVersion: 'TSF_EVAL_RUN_RESULT_V1',
    packId: pack.packId,
    packVersion: pack.version,
    category: pack.category,
    runAt: clock().toISOString(),
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    passRate: results.length ? passedCases / results.length : 0,
    results
  }
}

// Compares a baseline (current mapping) run against a candidate run of
// the SAME pack -- a per-case pass->fail transition is a regression, a
// fail->pass transition is an improvement. recommendation is
// DO_NOT_PROMOTE the instant ANY regression exists, regardless of how
// many improvements accompany it -- a candidate does not buy back a
// real regression with an unrelated improvement (acceptance item 5: "a
// candidate model/prompt can fail promotion on a regression").
export function compareEvalRuns(baselineRun, candidateRun) {
  if (baselineRun.packId !== candidateRun.packId) {
    throw new Error('cannot compare eval runs from different packs')
  }
  const baselineById = Object.fromEntries(baselineRun.results.map((r) => [r.caseId, r]))
  const candidateById = Object.fromEntries(candidateRun.results.map((r) => [r.caseId, r]))
  const regressions = []
  const improvements = []
  for (const caseId of Object.keys(baselineById)) {
    const before = baselineById[caseId]
    const after = candidateById[caseId]
    if (!after) {
      continue
    }
    if (before.passed && !after.passed) {
      regressions.push(caseId)
    }
    if (!before.passed && after.passed) {
      improvements.push(caseId)
    }
  }
  return {
    schemaVersion: 'TSF_EVAL_COMPARISON_V1',
    packId: baselineRun.packId,
    baselineRunAt: baselineRun.runAt,
    candidateRunAt: candidateRun.runAt,
    regressions,
    improvements,
    regressionCount: regressions.length,
    improvementCount: improvements.length,
    recommendation: regressions.length > 0 ? 'DO_NOT_PROMOTE' : 'PROMOTE'
  }
}
