// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 5. Route-glue coverage --
// operator-snapshot.mjs's own real assembly logic is tested independently
// in operator-snapshot.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { handleOperatorSnapshotRoute } from '../server/operator-snapshot-http-routes.mjs'

function fakeRes() {
  const res = new EventEmitter()
  res.statusCode = null
  res.headers = null
  res.body = ''
  res.writeHead = (code, headers) => {
    res.statusCode = code
    res.headers = headers
  }
  res.write = (chunk) => {
    res.body += chunk
  }
  res.end = (chunk) => {
    if (chunk) {
      res.body += chunk
    }
  }
  return res
}

function jsonHelper(res, code, body) {
  res.statusCode = code
  res.jsonBody = body
}

function notFoundHelper(res, message) {
  res.statusCode = 404
  res.notFoundMessage = message
}

test('GET /api/operator-snapshot returns the real buildOperatorSnapshot() result', async () => {
  const res = fakeRes()
  const snapshot = { revision: 1, generatedAt: 'x', projects: [] }
  const handled = await handleOperatorSnapshotRoute(
    ['api', 'operator-snapshot'],
    { method: 'GET' },
    res,
    {},
    { json: jsonHelper, notFound: notFoundHelper },
    { buildOperatorSnapshot: () => snapshot }
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, snapshot)
})

test('an unrelated route is left unhandled (returns false, writes nothing)', async () => {
  const res = fakeRes()
  const handled = await handleOperatorSnapshotRoute(
    ['api', 'portfolio'],
    { method: 'GET' },
    res,
    {},
    { json: jsonHelper, notFound: notFoundHelper }
  )
  assert.equal(handled, false)
  assert.equal(res.statusCode, null)
})

test('GET /api/operator-events emits an immediate revision event, then again only when the real revision actually changes', async () => {
  const req = new EventEmitter()
  req.url = '/api/operator-events?since=5'
  req.method = 'GET'
  const res = fakeRes()
  let revision = 6
  const timers = []
  const handled = await handleOperatorSnapshotRoute(
    ['api', 'operator-events'],
    req,
    res,
    {},
    { json: jsonHelper, notFound: notFoundHelper },
    {
      currentOperatorRevision: () => revision,
      setInterval: (fn, ms) => {
        timers.push(fn)
        return { fn, ms }
      },
      clearInterval: () => {}
    }
  )
  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'text/event-stream')
  // Immediate emission: since=5, real revision is already 6 -> one event now.
  assert.equal((res.body.match(/^data: /gm) ?? []).length, 1)
  assert.match(res.body, /"revision":6/)

  // No real change yet -- the next poll tick must NOT emit a duplicate.
  timers[0]()
  assert.equal((res.body.match(/^data: /gm) ?? []).length, 1)

  // A real change -- the next poll tick emits exactly once more.
  revision = 7
  timers[0]()
  assert.equal((res.body.match(/^data: /gm) ?? []).length, 2)
  assert.match(res.body, /"revision":7/)
})

test('GET /api/operator-events clears its poll timer when the client disconnects', async () => {
  const req = new EventEmitter()
  req.url = '/api/operator-events'
  req.method = 'GET'
  const res = fakeRes()
  let cleared = null
  await handleOperatorSnapshotRoute(
    ['api', 'operator-events'],
    req,
    res,
    {},
    { json: jsonHelper, notFound: notFoundHelper },
    {
      currentOperatorRevision: () => 1,
      setInterval: () => 'the-timer-handle',
      clearInterval: (handle) => {
        cleared = handle
      }
    }
  )
  req.emit('close')
  assert.equal(cleared, 'the-timer-handle')
})
