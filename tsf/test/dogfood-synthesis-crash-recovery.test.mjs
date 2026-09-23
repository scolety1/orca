// Owner-trial-prep mission: proves the dogfood synthesis crash-recovery
// gap (disclosed as an accepted V1 limitation in the daytime mission's
// safety review) is now closed. Real HTTP for the END trigger, real
// locked store, real stub-planner-cli for both success and failure paths.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-synth-recovery-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { readAllDogfoodSessions, withDogfoodSessions } =
  await import('../server/dogfood-session-store.mjs')
const { recoverInterruptedDogfoodSynthesis } = await import('../server/dogfood-session-capture.mjs')
const { DOGFOOD_SYNTHESIS_MAX_ATTEMPTS, markDogfoodSynthesisFailed, markDogfoodSynthesisRunning } =
  await import('../domain/dogfood-session.mjs')

const clock = () => new Date('2026-09-23T00:00:00.000Z')
const FAILING_PROVIDER = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const REAL_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

function useFailingProvider() {
  process.env.TSF_PLANNER_CLAUDE_COMMAND = FAILING_PROVIDER
  process.env.TSF_PLANNER_CODEX_COMMAND = FAILING_PROVIDER
}

function useWorkingProvider(observations) {
  process.env.TSF_PLANNER_CLAUDE_COMMAND = REAL_STUB
  process.env.TSF_PLANNER_CODEX_COMMAND = FAILING_PROVIDER
  process.env.STUB_DOGFOOD_SYNTHESIS_JSON = JSON.stringify(observations)
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
}

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

const REAL_OBSERVATION = [
  {
    category: 'BUG',
    settledDescription: 'Crash-recovery test: a real actionable observation.',
    disposition: 'SAFE_TO_IMPLEMENT',
    evidenceTurnIndexes: [0],
    severity: 'P2',
    route: '/crash-recovery-test'
  }
]

test('a synthesis that fails transiently is marked FAILED, then a later recovery scan retries it and succeeds', async () => {
  await withServer(async (base) => {
    useFailingProvider()
    await chat(base, { message: 'start dogfood mode' })
    await chat(base, { message: 'the export button silently does nothing' })
    const endRes = await chat(base, { message: "that's everything" })
    assert.match(endRes.body.text, /automatically retried/)

    const sessionId = endRes.body.sessionId
    let session = readAllDogfoodSessions()[sessionId]
    assert.equal(session.state, 'ENDED')
    assert.equal(session.synthesisStatus, 'FAILED')
    assert.equal(session.synthesisAttempts, 1)
    assert.equal(session.synthesisFindingIds, null)

    useWorkingProvider(REAL_OBSERVATION)
    const recovered = await recoverInterruptedDogfoodSynthesis(clock)
    assert.deepEqual(recovered, [sessionId])

    session = readAllDogfoodSessions()[sessionId]
    assert.equal(session.synthesisStatus, 'DONE')
    assert.equal(session.synthesisAttempts, 2)
    assert.equal(session.synthesisFindingIds.length, 1)
  })
})

test('a session left RUNNING by a simulated crash (no follow-up write ever landed) is picked up and completed by the recovery scan', async () => {
  await withServer(async (base) => {
    useFailingProvider()
    await chat(base, { projectId: 'crash-mid-flight-project', message: 'start dogfood mode' })
    await chat(base, {
      projectId: 'crash-mid-flight-project',
      message: 'the settings page is confusing'
    })
    const endRes = await chat(base, {
      projectId: 'crash-mid-flight-project',
      message: 'end dogfood mode'
    })
    const sessionId = endRes.body.sessionId

    // Simulate the real crash: force the session back to RUNNING with NO
    // outcome ever recorded, exactly the state a process death between
    // markDogfoodSynthesisRunning and recordSynthesisOutcome leaves behind.
    await withDogfoodSessions((sessions) => ({
      ...sessions,
      [sessionId]: markDogfoodSynthesisRunning(sessions[sessionId], clock)
    }))
    let session = readAllDogfoodSessions()[sessionId]
    assert.equal(session.synthesisStatus, 'RUNNING')

    useWorkingProvider([
      {
        category: 'UX_PROBLEM',
        settledDescription: 'Crash-recovery test: settings page is confusing.',
        disposition: 'NEEDS_OWNER_DECISION',
        evidenceTurnIndexes: [0],
        severity: 'P3',
        route: '/settings'
      }
    ])
    const recovered = await recoverInterruptedDogfoodSynthesis(clock)
    assert.deepEqual(recovered, [sessionId])

    session = readAllDogfoodSessions()[sessionId]
    assert.equal(session.synthesisStatus, 'DONE')
    assert.equal(session.synthesisFindingIds.length, 1)
    assert.equal(
      session.transcript.length,
      1,
      'the raw transcript survived the simulated crash intact'
    )
  })
})

test('a session already synthesized DONE is never re-touched by the recovery scan -- no duplicate implementation batch', async () => {
  await withServer(async (base) => {
    useWorkingProvider(REAL_OBSERVATION)
    const startRes = await chat(base, { message: 'start dogfood mode' })
    void startRes
    await chat(base, { message: 'the export button silently does nothing' })
    const endRes = await chat(base, { message: "that's everything" })
    const sessionId = endRes.body.sessionId

    const before = readAllDogfoodSessions()[sessionId]
    assert.equal(before.synthesisStatus, 'DONE')
    assert.equal(before.synthesisAttempts, 1)
    const findingIdsBefore = before.synthesisFindingIds

    const recovered = await recoverInterruptedDogfoodSynthesis(clock)
    assert.deepEqual(recovered, [], 'a DONE session must never be picked up by the recovery scan')

    const after = readAllDogfoodSessions()[sessionId]
    assert.equal(
      after.synthesisAttempts,
      1,
      'attempts must be unchanged -- no re-synthesis happened'
    )
    assert.deepEqual(after.synthesisFindingIds, findingIdsBefore)
  })
})

test('retry budget is respected -- a session already at the max attempt count is left alone, not retried forever', async () => {
  await withServer(async (base) => {
    useFailingProvider()
    await chat(base, { message: 'start dogfood mode' })
    await chat(base, { message: 'the sync indicator never updates' })
    const endRes = await chat(base, { message: "that's everything" })
    const sessionId = endRes.body.sessionId

    // Force the attempt count up to the budget without going through the
    // real retry loop each time (keeps the test fast and deterministic).
    await withDogfoodSessions((sessions) => {
      let session = sessions[sessionId]
      while (session.synthesisAttempts < DOGFOOD_SYNTHESIS_MAX_ATTEMPTS) {
        session = markDogfoodSynthesisFailed(
          markDogfoodSynthesisRunning(session, clock),
          'PLANNER_UNAVAILABLE',
          clock
        )
      }
      return { ...sessions, [sessionId]: session }
    })
    const before = readAllDogfoodSessions()[sessionId]
    assert.equal(before.synthesisAttempts, DOGFOOD_SYNTHESIS_MAX_ATTEMPTS)

    useWorkingProvider(REAL_OBSERVATION)
    const recovered = await recoverInterruptedDogfoodSynthesis(clock)
    assert.deepEqual(recovered, [], 'a session at its retry budget must not be retried again')

    const after = readAllDogfoodSessions()[sessionId]
    assert.equal(after.synthesisStatus, 'FAILED')
    assert.equal(after.synthesisAttempts, DOGFOOD_SYNTHESIS_MAX_ATTEMPTS)
  })
})

test('GET /api/dogfood-session surfaces a stuck ENDED session (RUNNING or FAILED synthesis) but never a DONE one', async () => {
  await withServer(async (base) => {
    useFailingProvider()
    const projectId = 'get-route-stuck-synthesis-project'
    await chat(base, { projectId, message: 'start dogfood mode' })
    await chat(base, { projectId, message: 'the icon is misaligned' })
    const endRes = await chat(base, { projectId, message: 'end dogfood mode' })
    const sessionId = endRes.body.sessionId

    const stuckRes = await fetch(`${base}/api/dogfood-session`)
    const stuckBody = await stuckRes.json()
    const stuckOwn = stuckBody.sessions.find((s) => s.id === sessionId)
    assert.ok(stuckOwn, "this test's own stuck session must be surfaced")
    assert.equal(stuckOwn.state, 'ENDED')
    assert.equal(stuckOwn.synthesisStatus, 'FAILED')

    useWorkingProvider(REAL_OBSERVATION)
    await recoverInterruptedDogfoodSynthesis(clock)

    const doneRes = await fetch(`${base}/api/dogfood-session`)
    const doneBody = await doneRes.json()
    const doneOwn = doneBody.sessions.find((s) => s.id === sessionId)
    assert.equal(doneOwn, undefined, 'a DONE session must not appear in GET any more')
  })
})
