import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readJson = async (name) => JSON.parse(await readFile(
  new URL(`../fixtures/long-autonomous-runtime-v1/${name}`, import.meta.url),
  'utf8'
))

test('real long autonomous runtime evidence preserves governance and release isolation', async () => {
  const state = await readJson('state.json')
  assert.equal(state.verdict, 'GREEN_TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_V1_PROVEN')
  assert.equal(state.mission.state, 'ADOPTED')
  assert.equal(state.mission.workItems.length, 4)
  assert.equal(state.mission.results.length, 4)
  assert.equal(state.mission.plannerIdentity.orcaSessionId, state.planner.sessionId)
  assert.equal(state.candidate.state, 'ADOPTED')
  assert.equal(state.release.upgrade.state, 'READY_FOR_PROMOTION')
  assert.equal(state.release.testing.disposition, 'PASS')
  assert.equal(state.stableInvariant.unchanged, true)
  assert.equal(state.publishedInvariant.unchanged, true)
  assert.equal(state.health.status, 'HEALTHY')
  assert.equal(state.workers.filter((worker) => worker.usageMode === 'ECONOMY').length, 1)
  assert.equal(state.workers.filter((worker) => worker.usageMode === 'MAXIMUM').length, 1)
  assert.equal(state.workers.filter((worker) => worker.recovery).length, 2)
})

test('real long autonomous runtime evidence binds verifier, browser, and Work Set gate', async () => {
  const [verifier, browser, gate] = await Promise.all([
    readJson('verifier-result.json'),
    readJson('browser-proof.json'),
    readJson('work-set-gate-proof.json')
  ])
  assert.equal(verifier.verdict, 'GREEN')
  assert.equal(verifier.evidence.find((item) => item.check === 'INDEPENDENT_TESTS').passed, 22)
  assert.deepEqual(browser.initial.missions, ['M-1', 'M-2', 'M-3', 'M-4'])
  assert.deepEqual(browser.filtered.missions, ['M-1'])
  assert.match(gate.removal.newDispatchBlocked, /outside Work Set/)
  assert.equal(gate.removal.existingWorkerSettlement, 'THREE_PREEXISTING_DISPATCHES_COMPLETED')
})
