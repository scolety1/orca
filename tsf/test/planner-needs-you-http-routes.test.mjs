// POST /api/planner-missions/:missionId/needs-you/:needsYouId/resolve --
// isolated route-handler test (fake req/res, no real HTTP server), mirroring
// attention-http-routes.test.mjs's own idiom. Pre-UI Productization V1,
// Priority 5: the real, previously-unwired planner needsYou resolution path.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-planner-needs-you-http-routes-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { handlePlannerNeedsYouRoute } = await import('../server/planner-needs-you-http-routes.mjs')
const { withPlannerMissionRecord, readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, raisePlannerNeedsYou } = await import('../domain/planner-mission-checkpoint.mjs')

test.after(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.tmp`, { force: true })
})

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(code) { this.statusCode = code },
    end(payload) { this.body = payload ? JSON.parse(payload) : null }
  }
}

function jsonHelper(res, status, body) {
  res.writeHead(status)
  res.end(JSON.stringify(body))
}

function notFoundHelper(res, message) {
  res.writeHead(404)
  res.end(JSON.stringify({ ok: false, error: message }))
}

function helpersWithBody(body) {
  return { json: jsonHelper, notFound: notFoundHelper, readBody: async () => body }
}

const clock = () => new Date('2026-01-01T00:00:00.000Z')

async function seedMissionWithNeedsYou(missionId, question) {
  await withPlannerMissionRecord(missionId, () => {
    const checkpoint = createPlannerMissionCheckpoint(
      { missionId, missionGoal: 'test goal', phase: 'PLANNING', repoState: { branch: 'main', sha: 'a'.repeat(40) } },
      clock
    )
    return { lease: null, checkpoint: raisePlannerNeedsYou(checkpoint, { question }, clock) }
  })
  const record = readPlannerMissionRecord(missionId)
  return record.checkpoint.needsYou[0].id
}

test('a non-matching route is left unhandled (returns false, never touches res)', async () => {
  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(['api', 'work'], {}, res, {}, helpersWithBody({}))
  assert.equal(handled, false)
  assert.equal(res.statusCode, null)
})

test('a GET on the resolve path is left unhandled (POST-only route)', async () => {
  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', 'm1', 'needs-you', 'n1', 'resolve'],
    { method: 'GET' },
    res,
    {},
    helpersWithBody({})
  )
  assert.equal(handled, false)
})

test('an unknown planner mission is a clean 404, not a crash', async () => {
  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', 'does-not-exist', 'needs-you', 'n1', 'resolve'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({ resolution: 'yes' })
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 404)
})

test('a real mission but an unknown Needs-You id is a clean 404', async () => {
  const missionId = 'mission-unknown-needsyou-fixture'
  await seedMissionWithNeedsYou(missionId, 'Is this OK to proceed?')

  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', missionId, 'needs-you', 'not-a-real-id', 'resolve'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({ resolution: 'yes' })
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 404)
})

test('an empty/missing resolution is honestly rejected, never silently resolved', async () => {
  const missionId = 'mission-empty-resolution-fixture'
  const needsYouId = await seedMissionWithNeedsYou(missionId, 'Which branch should this target?')

  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', missionId, 'needs-you', needsYouId, 'resolve'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({})
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 422)
  const record = readPlannerMissionRecord(missionId)
  assert.equal(record.checkpoint.needsYou[0].resolvedAt, null, 'never resolved by an empty request')
})

// REAL PROOF: this is the real, previously-unwired gap this route closes --
// a genuine answer, written durably through the real atomic
// mutateCheckpoint/resolvePlannerNeedsYou primitives, verified by a FRESH
// read (not just the response body) so this proves a real durable write,
// not merely an echoed request.
test('REAL PROOF: a real owner answer durably resolves the real planner Needs-You item', async () => {
  const missionId = 'mission-real-resolve-fixture'
  const needsYouId = await seedMissionWithNeedsYou(missionId, 'Confirm before touching the release branch?')

  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', missionId, 'needs-you', needsYouId, 'resolve'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({ resolution: 'Yes, confirmed by the owner.' })
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)

  const entry = res.body.checkpoint.needsYou.find((n) => n.id === needsYouId)
  assert.equal(entry.resolution, 'Yes, confirmed by the owner.')
  assert.ok(entry.resolvedAt, 'resolvedAt must be a real timestamp, not left null')

  // Fresh read, independent of the response body -- proves the write is
  // genuinely durable, not just echoed back.
  const record = readPlannerMissionRecord(missionId)
  const durableEntry = record.checkpoint.needsYou.find((n) => n.id === needsYouId)
  assert.equal(durableEntry.resolution, 'Yes, confirmed by the owner.')
  assert.ok(durableEntry.resolvedAt)
})

// Real bug found and fixed (Manual Self-Improvement Finding Disposition
// V1's own acceptance test caught this same shape on a sibling route): a
// real missionId can genuinely contain a literal colon (e.g. a self-
// improvement repair mission's own `mission:selfimprove:<findingId>`
// shape, computeRepairMissionId). http-server.mjs's own real `parts`
// array comes from `url.pathname.split('/')` with NO decoding, so a
// colon survives as its raw `%3A` percent-encoding in the REAL dispatch
// path -- a hand-built parts array (every other test in this file) never
// exercises that encoding and so never caught it.
test('a real percent-encoded missionId (the real shape a colon-bearing id takes in an actual URL) is decoded correctly, not looked up literally', async () => {
  const missionId = 'mission:selfimprove:percent-encoded-fixture'
  const needsYouId = await seedMissionWithNeedsYou(missionId, 'Does this real, colon-bearing missionId round-trip correctly?')
  const realUrlPart = encodeURIComponent(missionId)
  assert.notEqual(realUrlPart, missionId, 'sanity: encodeURIComponent must actually change a colon-bearing id')

  const res = fakeRes()
  const handled = await handlePlannerNeedsYouRoute(
    ['api', 'planner-missions', realUrlPart, 'needs-you', needsYouId, 'resolve'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({ resolution: 'Yes.' })
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200, 'the real, decoded missionId must be found, never a false 404')
  assert.equal(res.body.ok, true)
})
