// Wave D Phase 10, chaos scenario 6: the SAME finding detected twice in
// quick succession -- dedupes via the real content-addressed findingId
// through the FULL detector -> origination path (Wave C already proved the
// underlying PlannerSessionLifecycle.startMission race is closed at the
// generic-checkpoint level; this proves the self-improvement layer's own
// end-to-end path -- recordFindingDetection through originateRepairMission
// -- also dedupes correctly under real concurrency, never two missions).
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-chaos-duplicate-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { recordFindingDetection, readAllFindings } = await import('../server/self-improvement-finding-store.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { applyMechanicalVerification } = await import('../domain/self-improvement-mechanical-verification.mjs')
const { withFinding } = await import('../server/self-improvement-finding-store.mjs')
const { originateRepairMission, computeRepairMissionId } = await import('../server/self-improvement-mission-origination.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

const raw = {
  sourceDetector: 'RUNTIME_ASSERTION',
  severity: 'P1',
  evidence: { x: 1 },
  reproduction: { command: 'node -e "process.exit(1)"' },
  affectedSurface: 'tsf/domain/chaos-duplicate-fixture.mjs',
  confidence: 0.95,
  verificationMethod: 'RECHECK',
  candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: [] },
  projectId: null
}

test('the SAME defect detected twice concurrently dedupes to ONE finding record, occurrences incremented, never two records', async () => {
  const [first, second] = await Promise.all([recordFindingDetection(raw, () => new Date()), recordFindingDetection(raw, () => new Date())])
  assert.equal(first.findingId, second.findingId, 'both detections of the identical symptom must resolve to the identical content-addressed findingId')

  const all = readAllFindings()
  assert.equal(Object.keys(all).length, 1, 'exactly one finding record must exist, never two')
  assert.equal(all[first.findingId].occurrences, 2, 'a real re-detection increments occurrences rather than creating a second record')
})

test('the FULL detector -> origination path dedupes under real concurrency -- exactly one mission ever originates', async () => {
  const canonicalRepoPath = path.resolve(import.meta.dirname, '..', '..')
  let finding = await recordFindingDetection({ ...raw, affectedSurface: 'tsf/domain/chaos-duplicate-origination-fixture.mjs' }, () => new Date())
  const reproResult = { passed: false, exitCode: 1 }
  finding = await withFinding(finding.findingId, (current) => applyMechanicalVerification(current, reproResult, () => new Date()))
  finding = await withFinding(finding.findingId, (current) => applyAutofixEligibility(current, () => new Date()))
  assert.equal(finding.status, 'ELIGIBLE_FOR_AUTOFIX')

  // A genuine concurrent race: two independent originateRepairMission calls
  // for the identical finding, fired together.
  const deps = { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  const [resultA, resultB] = await Promise.all([
    originateRepairMission(finding, { canonicalRepoPath, clock: () => new Date(), deps }),
    originateRepairMission(finding, { canonicalRepoPath, clock: () => new Date(), deps })
  ])

  const createdFlags = [resultA.created, resultB.created].sort()
  assert.deepEqual(createdFlags, [false, true], 'exactly one call must report created:true, the other created:false -- never two missions')
  assert.equal(resultA.missionId, resultB.missionId)
  assert.equal(resultA.missionId, computeRepairMissionId(finding.findingId))

  const record = readPlannerMissionRecord(resultA.missionId)
  assert.ok(record?.checkpoint, 'exactly one durable checkpoint exists for this mission')
})
