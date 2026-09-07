import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { bootstrapSelfImprovementFleetDriverIfEnabled } from '../server/self-improvement-fleet-driver-bootstrap.mjs'
import { advanceOneFinding, pickOneActionableFinding, startSelfImprovementFleetDriver } from '../server/self-improvement-fleet-driver.mjs'

test('the autonomous driver flag is genuinely off by default: a real test asserting the loop does nothing when unset', () => {
  assert.equal(process.env.TSF_SELF_IMPROVEMENT_LOOP_ENABLED, undefined, 'this test suite must never set the real flag as ambient state')
  const fakeServer = new EventEmitter()
  let onCalled = false
  fakeServer.on = (...args) => {
    onCalled = true
    return EventEmitter.prototype.on.apply(fakeServer, args)
  }
  bootstrapSelfImprovementFleetDriverIfEnabled(fakeServer)
  assert.equal(onCalled, false, 'a disabled driver must never even register a close handler -- it must be a true no-op')
})

test('when explicitly enabled (a value ONLY this test sets, restored immediately after), the bootstrap genuinely starts the driver', () => {
  process.env.TSF_SELF_IMPROVEMENT_LOOP_ENABLED = '1'
  try {
    const fakeServer = new EventEmitter()
    let closeHandlerRegistered = false
    const originalOn = fakeServer.on.bind(fakeServer)
    fakeServer.on = (event, handler) => {
      if (event === 'close') { closeHandlerRegistered = true }
      return originalOn(event, handler)
    }
    bootstrapSelfImprovementFleetDriverIfEnabled(fakeServer, { canonicalRepoPath: 'C:/fixture' })
    assert.equal(closeHandlerRegistered, true)
    fakeServer.emit('close') // stop the real setInterval this created
  } finally {
    delete process.env.TSF_SELF_IMPROVEMENT_LOOP_ENABLED
  }
})

test('pickOneActionableFinding: stable declared order (content-addressed findingId), skips terminal statuses', () => {
  const findings = {
    'finding:b': { findingId: 'finding:b', status: 'RESOLVED' },
    'finding:a': { findingId: 'finding:a', status: 'FIX_IN_PROGRESS' },
    'finding:c': { findingId: 'finding:c', status: 'ELIGIBLE_FOR_AUTOFIX' }
  }
  const picked = pickOneActionableFinding(findings)
  assert.equal(picked.findingId, 'finding:a')
})

test('pickOneActionableFinding: null when nothing is actionable', () => {
  assert.equal(pickOneActionableFinding({ x: { findingId: 'finding:x', status: 'RESOLVED' } }), null)
  assert.equal(pickOneActionableFinding({}), null)
})

test('advanceOneFinding routes ELIGIBLE_FOR_AUTOFIX to origination and nothing else', async () => {
  let originateCalled = false
  let repairCalled = false
  const result = await advanceOneFinding(
    { findingId: 'finding:x', status: 'ELIGIBLE_FOR_AUTOFIX' },
    {
      canonicalRepoPath: 'C:/fixture',
      deps: {
        originateRepairMission: async () => {
          originateCalled = true
          return { created: true, missionId: 'mission:selfimprove:x' }
        },
        runRepairAttempt: async () => {
          repairCalled = true
          return { outcome: 'READY_FOR_ADOPTION' }
        }
      }
    }
  )
  assert.equal(result.action, 'ORIGINATED')
  assert.equal(originateCalled, true)
  assert.equal(repairCalled, false)
})

test('advanceOneFinding routes FIX_IN_PROGRESS to a repair attempt, and records a verifier-failure lesson only on VERIFIED_FAIL', async () => {
  let lessonRecorded = false
  const result = await advanceOneFinding(
    { findingId: 'finding:x', status: 'FIX_IN_PROGRESS' },
    {
      canonicalRepoPath: 'C:/fixture',
      deps: {
        runRepairAttempt: async () => ({ outcome: 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK', verification: { verdict: 'VERIFIED_FAIL', reasons: ['x'] } }),
        recordVerifierFailureLesson: async () => {
          lessonRecorded = true
        }
      }
    }
  )
  assert.equal(result.action, 'REPAIR_ATTEMPT')
  assert.equal(lessonRecorded, true)
})

test('advanceOneFinding on READY_FOR_ADOPTION with no recorded passing verification evidence reports NOTHING_TO_DO rather than guessing a worktree path', async () => {
  const result = await advanceOneFinding(
    { findingId: 'finding:x', status: 'READY_FOR_ADOPTION' },
    { canonicalRepoPath: 'C:/fixture', deps: { readPlannerMissionRecord: () => ({ checkpoint: { verifierResults: [] } }) } }
  )
  assert.equal(result.action, 'NOTHING_TO_DO')
})

test('startSelfImprovementFleetDriver: one bounded action per tick, never overlaps a slow cycle', async () => {
  let ticks = 0
  let inProgressPeak = 0
  let concurrent = 0
  const driver = startSelfImprovementFleetDriver({
    canonicalRepoPath: 'C:/fixture',
    readFindings: () => ({ 'finding:x': { findingId: 'finding:x', status: 'ELIGIBLE_FOR_AUTOFIX' } }),
    intervalMs: 5,
    deps: {
      originateRepairMission: async () => {
        concurrent += 1
        inProgressPeak = Math.max(inProgressPeak, concurrent)
        await new Promise((r) => setTimeout(r, 30))
        concurrent -= 1
        ticks += 1
        return { created: true, missionId: 'mission:selfimprove:x' }
      }
    }
  })
  await new Promise((r) => setTimeout(r, 80))
  driver.stop()
  assert.equal(inProgressPeak, 1, 'a slow cycle must never overlap with the next tick')
  assert.ok(ticks >= 1)
})
