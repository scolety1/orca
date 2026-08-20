import assert from 'node:assert/strict'
import test from 'node:test'
import { runKeepGoingDogfood } from '../fixtures/keep-going-dogfood.mjs'

test('Keep Going dogfood proves multi-wave, revision, pause/resume, Needs You, and no-duplicate-settled-work end to end', () => {
  const report = runKeepGoingDogfood()
  assert.equal(report.schemaVersion, 'TSF_KEEP_GOING_DOGFOOD_REPORT_V1')
  assert.equal(report.status, 'GREEN_KEEP_GOING_DOGFOOD')
  assert.equal(report.wavesCompleted, 2)
  assert.equal(report.revisionProven, true)
  assert.equal(report.noDuplicateOnReplay, true)
  assert.equal(report.pauseResumeProven, true)
  assert.equal(report.needsYouProven, true)
  assert.equal(report.verifierNeverTrustedWorkerClaim, true)
  assert.equal(report.orchestrationAdapterComposed, true)
  assert.equal(report.stallsDetected, 0)
  assert.equal(report.finalState, 'COMPLETE')
  assert.equal(report.checkpointCount, 2)
  assert.equal(report.checkpointsHashChained, true)
  assert.equal(report.summary.state, 'COMPLETE')
  assert.equal(report.summary.wavesCompleted, 2)
  assert.deepEqual(report.summary.openNeedsYou, [])
})
