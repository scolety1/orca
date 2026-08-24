// TSF Health Repair Center V1 -- Health Cause Model + repair classification.
// Product rule under test throughout: a repair pipeline must never report a
// project as safely repairable/ready when a real, unresolved cause remains
// -- these tests exist to catch exactly that class of regression.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HEALTH_CAUSES,
  REPAIR_CLASSES,
  DEFAULT_REPAIR_CLASS,
  diagnoseProjectHealth,
  overallRepairClass,
  isReadyForWork
} from '../domain/health-repair.mjs'

test('every HEALTH_CAUSES entry has a DEFAULT_REPAIR_CLASS mapping to a real REPAIR_CLASSES value', () => {
  for (const code of Object.values(HEALTH_CAUSES)) {
    const repairClass = DEFAULT_REPAIR_CLASS[code]
    assert.ok(repairClass, `${code} has no default repair class`)
    assert.ok(
      Object.values(REPAIR_CLASSES).includes(repairClass),
      `${code}'s default repair class ${repairClass} is not a real REPAIR_CLASSES value`
    )
  }
})

function baseAnalysis(overrides = {}) {
  return {
    ok: true,
    migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
    handoffReconciliation: { hasHandoff: false },
    orcaRegistration: { checked: true, registered: true, status: 'REGISTERED' },
    discovery: {
      commandGuidance: {
        hasKnownTestCommand: true,
        packageManager: 'npm',
        dependenciesInstalled: true
      }
    },
    health: { findings: [] },
    direction: { live: true, recommendedNextMission: null },
    currentState: { dirty: false },
    ...overrides
  }
}

test('an unanalyzed project (no successful analysis) diagnoses as UNKNOWN/NOT_A_DEFECT', () => {
  const causes = diagnoseProjectHealth({ analysis: { ok: false } })
  assert.deepEqual(
    causes.map((c) => c.cause),
    [HEALTH_CAUSES.UNKNOWN]
  )
  assert.equal(causes[0].repairClass, REPAIR_CLASSES.NOT_A_DEFECT)
})

test('a fully healthy project with no real findings diagnoses with zero causes', () => {
  const causes = diagnoseProjectHealth({ analysis: baseAnalysis() })
  assert.deepEqual(causes, [])
  assert.equal(overallRepairClass(causes), REPAIR_CLASSES.NOT_A_DEFECT)
  assert.equal(isReadyForWork(causes), true)
})

// Real V1 stabilization finding, reproduced live (Maintenance Loop, a
// genuinely clean project with all real typecheck/test/build/lint
// passing): STALE_PROJECT_STATE's own trigger checks Work Set membership,
// not any actual repository-state staleness -- Work Set membership is an
// operator scheduling choice, not a defect. It used to default
// AUTO_REPAIR_SAFE with only one possible repair action (REFRESH_ANALYSIS,
// a fresh analyzeRepository call) that can never resolve it since
// re-analysis doesn't touch Work Set membership -- permanently BLOCKED a
// clean project. Now NOT_A_DEFECT, matching DIRTY_PRESERVE/
// PAUSED_BY_DESIGN's own posture: real, honestly surfaced, not something
// TSF tries and fails to fix forever.
test('STALE_PROJECT_STATE (a recommended mission not yet in the Work Set) is NOT_A_DEFECT -- Work Set membership is a scheduling choice, not a blocker', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({ direction: { live: true, recommendedNextMission: 'do the thing' } }),
    membership: { activeFleet: true, workSet: false }
  })
  assert.deepEqual(
    causes.map((c) => c.cause),
    [HEALTH_CAUSES.STALE_PROJECT_STATE]
  )
  assert.equal(causes[0].repairClass, REPAIR_CLASSES.NOT_A_DEFECT)
  assert.equal(overallRepairClass(causes), REPAIR_CLASSES.NOT_A_DEFECT)
  // The real, concrete regression this fix closes: a genuinely clean
  // project with a recommended-but-unscheduled mission must not read as
  // permanently blocked.
  assert.equal(isReadyForWork(causes), true)
})

test('a recommended mission already in the Work Set never raises STALE_PROJECT_STATE at all', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({ direction: { live: true, recommendedNextMission: 'do the thing' } }),
    membership: { activeFleet: true, workSet: true }
  })
  assert.deepEqual(causes, [])
})

test('SENSITIVE always diagnoses SENSITIVE_RESTRICTION/TIM_REQUIRED, even alongside other causes', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      migrationClassification: { classification: 'SENSITIVE', reasons: ['real secret found'] },
      orcaRegistration: { checked: true, registered: false, status: 'NOT_REGISTERED' }
    })
  })
  const codes = causes.map((c) => c.cause)
  assert.ok(codes.includes(HEALTH_CAUSES.SENSITIVE_RESTRICTION))
  assert.ok(codes.includes(HEALTH_CAUSES.ORCA_NOT_REGISTERED))
  assert.equal(
    overallRepairClass(causes),
    REPAIR_CLASSES.TIM_REQUIRED,
    'TIM_REQUIRED always wins the rollup'
  )
})

test('UNRESOLVED_HANDOFF_DISCREPANCY diagnoses HANDOFF_RECONCILIATION_REQUIRED/AUTO_REPAIR_SAFE', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      migrationClassification: { classification: 'UNRESOLVED_HANDOFF_DISCREPANCY', reasons: [] },
      handoffReconciliation: { hasHandoff: true, discrepancies: ['branch drift'] }
    })
  })
  assert.equal(causes.length, 1)
  assert.equal(causes[0].cause, HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED)
  assert.equal(causes[0].repairClass, REPAIR_CLASSES.AUTO_REPAIR_SAFE)
})

test('genuine repository-identity ambiguity (TIM_REQUIRED + identityAmbiguous) diagnoses REPOSITORY_IDENTITY_AMBIGUOUS/TIM_REQUIRED', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      migrationClassification: { classification: 'TIM_REQUIRED', reasons: [] },
      handoffReconciliation: { hasHandoff: true, identityAmbiguous: true }
    })
  })
  assert.equal(causes.length, 1)
  assert.equal(causes[0].cause, HEALTH_CAUSES.REPOSITORY_IDENTITY_AMBIGUOUS)
  assert.equal(causes[0].repairClass, REPAIR_CLASSES.TIM_REQUIRED)
})

test('DIRTY_PRESERVE and READ_ONLY_ONBOARDING_ONLY both diagnose as NOT_A_DEFECT -- paused/dirty-preserve is not automatically a defect', () => {
  const dirty = diagnoseProjectHealth({
    analysis: baseAnalysis({
      migrationClassification: { classification: 'DIRTY_PRESERVE', reasons: [] },
      currentState: { dirty: true }
    })
  })
  assert.deepEqual(
    dirty.map((c) => [c.cause, c.repairClass]),
    [[HEALTH_CAUSES.DIRTY_PRESERVE, REPAIR_CLASSES.NOT_A_DEFECT]]
  )

  const readOnly = diagnoseProjectHealth({
    analysis: baseAnalysis({
      migrationClassification: { classification: 'READ_ONLY_ONBOARDING_ONLY', reasons: [] }
    })
  })
  assert.deepEqual(
    readOnly.map((c) => [c.cause, c.repairClass]),
    [[HEALTH_CAUSES.PAUSED_BY_DESIGN, REPAIR_CLASSES.NOT_A_DEFECT]]
  )
})

test('a fallen-back direction analysis diagnoses PLANNER_UNAVAILABLE/AUTO_REPAIR_SAFE', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({ direction: { live: false, recommendedNextMission: null } })
  })
  assert.deepEqual(
    causes.map((c) => c.cause),
    [HEALTH_CAUSES.PLANNER_UNAVAILABLE]
  )
})

test('Orca registration causes: NOT_REGISTERED and ORCA_TEMPORARILY_UNAVAILABLE/ORCA_UNKNOWN both AUTO_REPAIR_SAFE', () => {
  const notRegistered = diagnoseProjectHealth({
    analysis: baseAnalysis({
      orcaRegistration: { checked: true, registered: false, status: 'NOT_REGISTERED' }
    })
  })
  assert.deepEqual(
    notRegistered.map((c) => c.cause),
    [HEALTH_CAUSES.ORCA_NOT_REGISTERED]
  )

  for (const status of ['ORCA_TEMPORARILY_UNAVAILABLE', 'ORCA_UNKNOWN']) {
    const causes = diagnoseProjectHealth({
      analysis: baseAnalysis({ orcaRegistration: { checked: true, registered: false, status } })
    })
    assert.deepEqual(
      causes.map((c) => c.cause),
      [HEALTH_CAUSES.ORCA_TEMPORARILY_UNAVAILABLE],
      status
    )
  }
})

test('no discoverable test command diagnoses BASELINE_UNKNOWN/AUTO_REPAIR_SAFE', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      discovery: {
        commandGuidance: {
          hasKnownTestCommand: false,
          packageManager: 'npm',
          dependenciesInstalled: true
        }
      }
    })
  })
  assert.deepEqual(
    causes.map((c) => c.cause),
    [HEALTH_CAUSES.BASELINE_UNKNOWN]
  )
})

test('a package manifest with dependencies not installed diagnoses DEPENDENCY_HEALTH/AUTO_REPAIR_SAFE', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      discovery: {
        priorityFiles: [{ relativePath: 'package.json', kind: 'PACKAGE_MANIFEST' }],
        commandGuidance: {
          hasKnownTestCommand: true,
          packageManager: 'npm',
          dependenciesInstalled: false
        }
      }
    })
  })
  assert.deepEqual(
    causes.map((c) => c.cause),
    [HEALTH_CAUSES.DEPENDENCY_HEALTH]
  )
})

// Real bug found via live UI validation (not a synthetic case): packageManager
// is the literal string 'UNKNOWN' -- truthy! -- when no lockfile exists at
// all, so a plain repo with no package manager in use whatsoever (just a
// README) wrongly diagnosed DEPENDENCY_HEALTH. hasPackageManifest is the
// real fact this cause is about, not packageManager's mere truthiness.
test('a repo with no package manifest at all never diagnoses DEPENDENCY_HEALTH, even though packageManager reads "UNKNOWN" (a truthy string)', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      discovery: {
        priorityFiles: [{ relativePath: 'README.md', kind: 'README' }],
        commandGuidance: {
          hasKnownTestCommand: false,
          packageManager: 'UNKNOWN',
          dependenciesInstalled: false
        }
      }
    })
  })
  assert.ok(
    !causes.some((c) => c.cause === HEALTH_CAUSES.DEPENDENCY_HEALTH),
    'a repo with no package.json at all must never diagnose DEPENDENCY_HEALTH'
  )
})

test('a real security finding diagnoses SECURITY_FINDINGS/TIM_REQUIRED -- never auto-remediated', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      health: {
        findings: [
          {
            code: 'SECURITY_FINDINGS_PRESENT',
            status: 'NEEDS_ATTENTION',
            summary: 'Dependencies 2 HIGH',
            evidence: { scannerName: 'stub-scanner' }
          }
        ]
      }
    })
  })
  assert.deepEqual(
    causes.map((c) => [c.cause, c.repairClass]),
    [[HEALTH_CAUSES.SECURITY_FINDINGS, REPAIR_CLASSES.TIM_REQUIRED]]
  )
})

test('baseline verification failures diagnose the correct *_FAILING cause per command, all GOVERNED_REPAIR_MISSION', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis(),
    baseline: { typecheck: 'FAIL', test: 'FAIL', build: 'PASS', lint: 'PASS' }
  })
  assert.deepEqual(
    causes.map((c) => [c.cause, c.repairClass]).sort(),
    [
      [HEALTH_CAUSES.TESTS_FAILING, REPAIR_CLASSES.GOVERNED_REPAIR_MISSION],
      [HEALTH_CAUSES.TYPECHECK_FAILING, REPAIR_CLASSES.GOVERNED_REPAIR_MISSION]
    ].sort()
  )
})

test('a baseline that fully passes contributes no failing causes', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis(),
    baseline: { typecheck: 'PASS', test: 'PASS', build: 'PASS', lint: 'PASS' }
  })
  assert.deepEqual(causes, [])
})

test('overallRepairClass rolls up to the worst class present: TIM_REQUIRED > GOVERNED_REPAIR_MISSION > AUTO_REPAIR_SAFE > NOT_A_DEFECT', () => {
  const c = (repairClass) => ({ cause: 'X', repairClass, summary: '', evidence: {} })
  assert.equal(overallRepairClass([]), REPAIR_CLASSES.NOT_A_DEFECT)
  assert.equal(overallRepairClass([c('NOT_A_DEFECT')]), REPAIR_CLASSES.NOT_A_DEFECT)
  assert.equal(
    overallRepairClass([c('NOT_A_DEFECT'), c('AUTO_REPAIR_SAFE')]),
    REPAIR_CLASSES.AUTO_REPAIR_SAFE
  )
  assert.equal(
    overallRepairClass([c('AUTO_REPAIR_SAFE'), c('GOVERNED_REPAIR_MISSION')]),
    REPAIR_CLASSES.GOVERNED_REPAIR_MISSION
  )
  assert.equal(
    overallRepairClass([c('GOVERNED_REPAIR_MISSION'), c('TIM_REQUIRED'), c('AUTO_REPAIR_SAFE')]),
    REPAIR_CLASSES.TIM_REQUIRED
  )
})

test('isReadyForWork is true only when every cause is NOT_A_DEFECT', () => {
  const c = (repairClass) => ({ cause: 'X', repairClass, summary: '', evidence: {} })
  assert.equal(isReadyForWork([]), true)
  assert.equal(isReadyForWork([c('NOT_A_DEFECT')]), true)
  assert.equal(isReadyForWork([c('NOT_A_DEFECT'), c('AUTO_REPAIR_SAFE')]), false)
  assert.equal(isReadyForWork([c('TIM_REQUIRED')]), false)
})

// Real V1 stabilization-adjacent regression guard: a project must never be
// reported ready for work while a real cause remains unresolved, even one
// classified AUTO_REPAIR_SAFE -- "safe to auto-repair" is not the same as
// "already repaired". This is the exact bug class the acceptance criteria
// (no cosmetic green) exist to prevent.
test('a project with only an AUTO_REPAIR_SAFE cause is NOT reported ready for work until that cause is gone', () => {
  const causes = diagnoseProjectHealth({
    analysis: baseAnalysis({
      orcaRegistration: { checked: true, registered: false, status: 'NOT_REGISTERED' }
    })
  })
  assert.equal(isReadyForWork(causes), false)
  assert.equal(overallRepairClass(causes), REPAIR_CLASSES.AUTO_REPAIR_SAFE)
})
