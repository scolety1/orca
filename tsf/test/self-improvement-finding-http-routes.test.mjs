// GET/POST /api/self-improvement/findings/:findingId[/start-fix|/apply-fix|/dismiss]
// -- isolated route-handler test (fake req/res, no real HTTP server),
// mirroring planner-needs-you-http-routes.test.mjs's own idiom. The real
// disposition logic (git fixtures, gate/hold/lock behavior) is already
// exhaustively covered by self-improvement-finding-disposition.test.mjs --
// this file proves routing/dispatch and the JSON envelope, not the
// underlying mechanism a second time.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-selfimprove-finding-http-routes-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { handleSelfImprovementFindingRoute } = await import('../server/self-improvement-finding-http-routes.mjs')
const { withFinding, readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')

test.after(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.tmp`, { force: true })
  rmSync(`${STATE_FILE}.self-improvement-finding.lock`, { force: true })
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

function helpersWithBody(body = {}) {
  return { json: jsonHelper, notFound: notFoundHelper, readBody: async () => body }
}

const clock = () => new Date('2026-01-01T00:00:00.000Z')

async function seedNeedsOwnerFinding(findingIdSuffix) {
  let finding = createFinding(
    {
      sourceDetector: 'UI_DOGFOOD',
      severity: 'P2',
      evidence: { note: 'route fixture' },
      reproduction: { steps: [`route-fixture-${findingIdSuffix}`] },
      affectedSurface: `tsf/route-fixture-${findingIdSuffix}.mjs`,
      confidence: 0.8,
      verificationMethod: 'MANUAL_RECHECK'
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  return withFinding(finding.findingId, () => finding)
}

test('a non-matching route is left unhandled', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(['api', 'work'], {}, res, {}, helpersWithBody())
  assert.equal(handled, false)
  assert.equal(res.statusCode, null)
})

test('a request missing the findingId segment is left unhandled', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(['api', 'self-improvement', 'findings'], {}, res, {}, helpersWithBody())
  assert.equal(handled, false)
})

test('an unknown action segment is left unhandled', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', 'finding:x', 'not-a-real-action'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, false)
})

// ---- GET detail ----

test('GET detail: unknown finding is a clean 404', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', 'finding:does-not-exist'],
    { method: 'GET' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 404)
})

// Real proof that "clicking into details" preserves what the owner's own
// brief requires: what TSF found (evidence), why it matters (severity/
// affectedSurface), the proposed fix (candidateFixScope), and
// verification status (status/transitions) -- the real, unredacted
// finding record, not a trimmed summary.
test('GET detail: a real finding returns the real, complete record -- evidence, proposed fix, verification status all present', async () => {
  const finding = await seedNeedsOwnerFinding('detail')
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', finding.findingId],
    { method: 'GET' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.finding.evidence, { note: 'route fixture' })
  assert.equal(res.body.finding.status, 'NEEDS_OWNER')
  assert.equal(res.body.finding.severity, 'P2')
  assert.ok(res.body.finding.transitions.length >= 2, 'the real transition history must be present')
})

// ---- start-fix ----

test('start-fix: a GET on this path is left unhandled (POST-only)', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', 'finding:x', 'start-fix'],
    { method: 'GET' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, false)
})

test('start-fix: reaches the real disposition function -- unknown finding is honestly reported through the route', async () => {
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', 'finding:does-not-exist-2', 'start-fix'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.reason, 'FINDING_NOT_FOUND')
})

test('start-fix: a real NEEDS_OWNER finding reaches the real origination attempt through the route (fails honestly against process.cwd(), never crashes the route)', async () => {
  const finding = await seedNeedsOwnerFinding('startfix-route')
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', finding.findingId, 'start-fix'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(typeof res.body.ok, 'boolean')
})

// ---- apply-fix ----

test('apply-fix: a NEEDS_OWNER finding is honestly NOT_READY_FOR_ADOPTION through the route', async () => {
  const finding = await seedNeedsOwnerFinding('applyfix-route')
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', finding.findingId, 'apply-fix'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.reason, 'NOT_READY_FOR_ADOPTION')
})

// ---- dismiss ----

test('dismiss: real dismissal reaches the real disposition function and durably persists through the route', async () => {
  const finding = await seedNeedsOwnerFinding('dismiss-route')
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', finding.findingId, 'dismiss'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({ reason: 'not a priority right now' })
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.finding.status, 'DISMISSED_BY_OWNER')
  assert.deepEqual(res.body.finding.transitions.at(-1).evidence, [{ ownerNote: 'not a priority right now' }])

  // Fresh read, independent of the response body -- proves the write is
  // genuinely durable, not just echoed back.
  assert.equal(readFinding(finding.findingId).status, 'DISMISSED_BY_OWNER')
})

test('dismiss: an empty reason is honestly treated as no reason given, never a fabricated string', async () => {
  const finding = await seedNeedsOwnerFinding('dismiss-noreason-route')
  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', finding.findingId, 'dismiss'],
    { method: 'POST' },
    res,
    {},
    helpersWithBody({})
  )
  assert.equal(handled, true)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.finding.transitions.at(-1).evidence, [])
})

// Real bug found and fixed (this feature's own acceptance test caught
// it): a real findingId always contains a literal colon
// (findingIdFor's own `finding:<fingerprint>` shape). http-server.mjs's
// own real `parts` array comes from `url.pathname.split('/')` with NO
// decoding, so a colon survives as its raw `%3A` percent-encoding in the
// REAL dispatch path -- a hand-built parts array (every other test in
// this file) never exercises that encoding and so never caught it. This
// test models the REAL segment shape a genuine URL produces, closing
// that real coverage gap directly at this route's own level too.
test('a real percent-encoded findingId (the real shape a colon-bearing id takes in an actual URL) is decoded correctly, not looked up literally', async () => {
  const finding = await seedNeedsOwnerFinding('percent-encoded-route')
  const realUrlPart = encodeURIComponent(finding.findingId)
  assert.notEqual(realUrlPart, finding.findingId, 'sanity: encodeURIComponent must actually change a colon-bearing id')

  const res = fakeRes()
  const handled = await handleSelfImprovementFindingRoute(
    ['api', 'self-improvement', 'findings', realUrlPart],
    { method: 'GET' },
    res,
    {},
    helpersWithBody()
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200, 'the real, decoded findingId must be found, never a false 404')
  assert.equal(res.body.finding.findingId, finding.findingId)
})
