// Owner-trial-prep mission, Section 13 (concurrency/race tests on the
// critique pipeline): the two dogfood-specific race shapes not yet
// covered by test/dogfood-safety-review-round1.test.mjs (fleet-wide
// bypass, lost-update save) or test/dogfood-synthesis-crash-recovery.
// test.mjs (synthesis races) -- real concurrent captures against the
// SAME session, and an END racing a concurrent capture. Proves the
// existing withDogfoodSessions file lock actually serializes these, not
// just by inspection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-concurrent-race-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { readAllDogfoodSessions } = await import('../server/dogfood-session-store.mjs')

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

test('N concurrent captures against the same open session all land -- no lost update, no duplicate, no dropped turn', async () => {
  await withServer(async (base) => {
    await chat(base, { message: 'start dogfood mode' })

    const N = 12
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        chat(base, { message: `concurrent complaint number ${i}` })
      )
    )
    for (const r of results) {
      assert.equal(r.status, 200)
      assert.equal(r.body.dogfood, true)
    }

    const session = Object.values(readAllDogfoodSessions()).find((s) => s.projectId === null)
    assert.equal(
      session.transcript.length,
      N,
      'every concurrent turn must be captured -- none lost, none duplicated'
    )
    const contents = new Set(session.transcript.map((t) => t.content))
    assert.equal(
      contents.size,
      N,
      'every turn must be distinct -- the lock must serialize, never interleave/overwrite'
    )
    for (let i = 0; i < N; i++) {
      assert.ok(contents.has(`concurrent complaint number ${i}`), `turn ${i} must be present`)
    }
  })
})

test('a capture racing the END trigger is never silently dropped or double-counted, and is never both "captured" AND missing from the transcript', async () => {
  await withServer(async (base) => {
    await chat(base, { message: 'start dogfood mode' })
    await chat(base, { message: 'first real complaint' })

    const RACING_MESSAGE = 'a message racing the end trigger'
    const [captureRes, endRes] = await Promise.all([
      chat(base, { message: RACING_MESSAGE }),
      chat(base, { message: 'end dogfood mode' })
    ])
    assert.equal(captureRes.status, 200)
    assert.equal(endRes.status, 200)

    const session = Object.values(readAllDogfoodSessions()).find((s) => s.projectId === null)
    assert.equal(session.state, 'ENDED')
    const contents = session.transcript.map((t) => t.content)
    assert.ok(contents.includes('first real complaint'))
    const racingCount = contents.filter((c) => c === RACING_MESSAGE).length
    assert.ok(racingCount === 0 || racingCount === 1, 'the racing message must appear at most once')

    // The lock genuinely serializes the two requests in ONE real order --
    // whichever won, the racing message's own response must be honestly
    // self-consistent with the resulting transcript, not the other way
    // around (both outcomes are legitimate: it landed before END and was
    // captured, or END landed first and it correctly fell through to
    // normal, non-dogfood processing -- never captured-but-missing, and
    // never absent-but-still-claiming-dogfood:true).
    if (racingCount === 1) {
      assert.equal(
        captureRes.body.dogfood,
        true,
        'a message that DID land in the transcript must have been reported as captured'
      )
    } else {
      assert.notEqual(
        captureRes.body.dogfood,
        true,
        'a message that did NOT land in the transcript must never falsely claim to have been captured'
      )
    }
  })
})
