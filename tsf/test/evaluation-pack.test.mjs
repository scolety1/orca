import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVAL_CATEGORIES,
  normalizeEvalPack,
  scoreAssertion,
  scoreCase,
  runEvalPack,
  compareEvalRuns
} from '../domain/evaluation-pack.mjs'

function fakePack(overrides = {}) {
  return {
    packId: 'planner-basics',
    version: 1,
    category: 'PLANNER',
    cases: [
      {
        id: 'case-1',
        description: 'retains the goal statement',
        assertions: [{ type: 'EQUALS', path: 'goal', value: 'ship the feature' }]
      },
      {
        id: 'case-2',
        description: 'avoids a previously rejected approach',
        assertions: [
          { type: 'NOT_CONTAINS', path: 'proposedApproaches', value: 'rewrite-from-scratch' }
        ]
      }
    ],
    ...overrides
  }
}

test('normalizeEvalPack rejects an unknown category', () => {
  assert.throws(() => normalizeEvalPack(fakePack({ category: 'NOT_REAL' })), /unknown category/)
})

test('normalizeEvalPack rejects an empty case list', () => {
  assert.throws(() => normalizeEvalPack(fakePack({ cases: [] })), /at least one case/)
})

test('normalizeEvalPack rejects a duplicate case id', () => {
  const pack = fakePack()
  pack.cases.push({ ...pack.cases[0] })
  assert.throws(() => normalizeEvalPack(pack), /duplicate case id/)
})

test('normalizeEvalPack rejects a case with no assertions', () => {
  const pack = fakePack()
  pack.cases[0].assertions = []
  assert.throws(() => normalizeEvalPack(pack), /at least one assertion/)
})

test('normalizeEvalPack rejects an unknown assertion type', () => {
  const pack = fakePack()
  pack.cases[0].assertions[0].type = 'FUZZY_VIBES'
  assert.throws(() => normalizeEvalPack(pack), /unknown type/)
})

test("REQUIRED PROOF: normalizeEvalPack rejects an assertion with no value field -- without this, a typo'd path resolving to undefined would silently PASS (undefined === undefined) instead of erroring or failing loudly", () => {
  const pack = fakePack()
  delete pack.cases[0].assertions[0].value
  assert.throws(() => normalizeEvalPack(pack), /value is required/)
})

test('normalizeEvalPack accepts an assertion whose value is deliberately null', () => {
  const pack = fakePack()
  pack.cases[0].assertions[0].value = null
  assert.doesNotThrow(() => normalizeEvalPack(pack))
})

test('normalizeEvalPack accepts and returns a well-formed pack unchanged in shape', () => {
  const normalized = normalizeEvalPack(fakePack())
  assert.equal(normalized.schemaVersion, 'TSF_EVAL_PACK_V1')
  assert.equal(normalized.cases.length, 2)
})

test('EVAL_CATEGORIES covers all 9 required capability categories (Phase 13 added GOLDEN_PATH)', () => {
  assert.deepEqual(
    [...EVAL_CATEGORIES].sort(),
    [
      'AUTONOMY',
      'ESTIMATOR',
      'GOLDEN_PATH',
      'MEMORY',
      'PLANNER',
      'ROUTING',
      'UI_DOGFOOD',
      'VERIFIER',
      'WORKER'
    ].sort()
  )
})

test('scoreAssertion: EQUALS does a real deep-equal, not reference equality', () => {
  assert.equal(
    scoreAssertion({ a: { b: 1 } }, { type: 'EQUALS', path: 'a', value: { b: 1 } }),
    true
  )
  assert.equal(
    scoreAssertion({ a: { b: 1 } }, { type: 'EQUALS', path: 'a', value: { b: 2 } }),
    false
  )
})

test('scoreAssertion: CONTAINS works over strings and arrays', () => {
  assert.equal(
    scoreAssertion({ s: 'hello world' }, { type: 'CONTAINS', path: 's', value: 'world' }),
    true
  )
  assert.equal(
    scoreAssertion({ arr: [1, 2, 3] }, { type: 'CONTAINS', path: 'arr', value: 2 }),
    true
  )
  assert.equal(
    scoreAssertion({ arr: [1, 2, 3] }, { type: 'CONTAINS', path: 'arr', value: 9 }),
    false
  )
})

test('scoreAssertion: NOT_CONTAINS is the real logical inverse of CONTAINS', () => {
  assert.equal(
    scoreAssertion(
      { arr: ['rewrite-from-scratch'] },
      { type: 'NOT_CONTAINS', path: 'arr', value: 'rewrite-from-scratch' }
    ),
    false
  )
  assert.equal(
    scoreAssertion(
      { arr: ['incremental-fix'] },
      { type: 'NOT_CONTAINS', path: 'arr', value: 'rewrite-from-scratch' }
    ),
    true
  )
})

test('scoreAssertion: MATCHES applies a real regex against a string', () => {
  assert.equal(
    scoreAssertion({ s: 'task-42' }, { type: 'MATCHES', path: 's', value: '^task-\\d+$' }),
    true
  )
  assert.equal(
    scoreAssertion({ s: 'task-x' }, { type: 'MATCHES', path: 's', value: '^task-\\d+$' }),
    false
  )
})

test('scoreAssertion: GTE/LTE are real numeric thresholds', () => {
  assert.equal(scoreAssertion({ n: 5 }, { type: 'GTE', path: 'n', value: 5 }), true)
  assert.equal(scoreAssertion({ n: 4 }, { type: 'GTE', path: 'n', value: 5 }), false)
  assert.equal(scoreAssertion({ n: 5 }, { type: 'LTE', path: 'n', value: 5 }), true)
  assert.equal(scoreAssertion({ n: 6 }, { type: 'LTE', path: 'n', value: 5 }), false)
})

test('scoreAssertion resolves a nested dot-path', () => {
  assert.equal(
    scoreAssertion({ a: { b: { c: 7 } } }, { type: 'EQUALS', path: 'a.b.c', value: 7 }),
    true
  )
})

test('REQUIRED PROOF: scoreCase requires EVERY assertion to pass -- a case is not a pass just because most assertions pass', () => {
  const evalCase = {
    id: 'multi',
    assertions: [
      { type: 'EQUALS', path: 'a', value: 1 },
      { type: 'EQUALS', path: 'b', value: 2 }
    ]
  }
  const allPass = scoreCase({ a: 1, b: 2 }, evalCase)
  assert.equal(allPass.passed, true)
  const onePasses = scoreCase({ a: 1, b: 999 }, evalCase)
  assert.equal(onePasses.passed, false)
})

test('REQUIRED PROOF: a case with no actual output supplied is honestly ERRORED, never silently counted as a pass', () => {
  const pack = normalizeEvalPack(fakePack())
  const run = runEvalPack(pack, { 'case-1': { goal: 'ship the feature' } }) // case-2 missing entirely
  const case2 = run.results.find((r) => r.caseId === 'case-2')
  assert.equal(case2.errored, true)
  assert.equal(case2.passed, false)
  assert.equal(run.passedCases, 1)
  assert.equal(run.failedCases, 1)
})

test('runEvalPack computes an honest passRate', () => {
  const pack = normalizeEvalPack(fakePack())
  const run = runEvalPack(
    pack,
    {
      'case-1': { goal: 'ship the feature' },
      'case-2': { proposedApproaches: ['incremental-fix'] }
    },
    () => new Date('2026-01-01T00:00:00.000Z')
  )
  assert.equal(run.totalCases, 2)
  assert.equal(run.passedCases, 2)
  assert.equal(run.passRate, 1)
  assert.equal(run.runAt, '2026-01-01T00:00:00.000Z')
})

test('compareEvalRuns rejects comparing runs from different packs', () => {
  assert.throws(
    () => compareEvalRuns({ packId: 'a', results: [] }, { packId: 'b', results: [] }),
    /different packs/
  )
})

test('compareEvalRuns detects a real pass-to-fail regression and a real fail-to-pass improvement', () => {
  const baseline = {
    packId: 'p',
    runAt: '2026-01-01T00:00:00.000Z',
    results: [
      { caseId: 'a', passed: true },
      { caseId: 'b', passed: false }
    ]
  }
  const candidate = {
    packId: 'p',
    runAt: '2026-01-02T00:00:00.000Z',
    results: [
      { caseId: 'a', passed: false },
      { caseId: 'b', passed: true }
    ]
  }
  const comparison = compareEvalRuns(baseline, candidate)
  assert.deepEqual(comparison.regressions, ['a'])
  assert.deepEqual(comparison.improvements, ['b'])
})

test('REQUIRED PROOF: a single regression blocks promotion even alongside many improvements -- a candidate does not buy back a regression with unrelated wins', () => {
  const baseline = {
    packId: 'p',
    runAt: '2026-01-01T00:00:00.000Z',
    results: [
      { caseId: 'a', passed: true },
      { caseId: 'b', passed: false },
      { caseId: 'c', passed: false },
      { caseId: 'd', passed: false }
    ]
  }
  const candidate = {
    packId: 'p',
    runAt: '2026-01-02T00:00:00.000Z',
    results: [
      { caseId: 'a', passed: false }, // 1 regression
      { caseId: 'b', passed: true }, // 3 improvements
      { caseId: 'c', passed: true },
      { caseId: 'd', passed: true }
    ]
  }
  const comparison = compareEvalRuns(baseline, candidate)
  assert.equal(comparison.regressionCount, 1)
  assert.equal(comparison.improvementCount, 3)
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})

test('a candidate with zero regressions and at least one improvement is recommended for promotion', () => {
  const baseline = {
    packId: 'p',
    runAt: '2026-01-01T00:00:00.000Z',
    results: [{ caseId: 'a', passed: false }]
  }
  const candidate = {
    packId: 'p',
    runAt: '2026-01-02T00:00:00.000Z',
    results: [{ caseId: 'a', passed: true }]
  }
  assert.equal(compareEvalRuns(baseline, candidate).recommendation, 'PROMOTE')
})
