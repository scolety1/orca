// Wave 2: attachDueAttentionNotices wired into http-server.mjs's real
// POST /api/chat call sites, alongside (not replacing) attachDueCompletionNotices
// -- mirrors http-chat-dispatch.test.mjs's real end-to-end HTTP idiom (a real
// server, a real fetch, no mocked transport) rather than testing the
// reconciler module in isolation (attention-status-reconciler.test.mjs
// already covers that). Seeds a real, durable self-improvement finding via
// the real domain constructor + store (self-improvement-finding-store.mjs),
// written into the SAME state file the running server reads.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-attention-notice-${process.pid}.json`)
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.TSF_ORCA_CLI_COMMAND = NONEXISTENT
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { withFinding } = await import('../server/self-improvement-finding-store.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock', '.attention-notification-event.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-07T12:00:00.000Z')

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

async function seedNeedsOwnerFinding(surface) {
  let finding = createFinding(
    {
      sourceDetector: 'GOLDEN_PATH_EVAL',
      severity: 'P2',
      evidence: { caseId: 'case-1' },
      reproduction: { command: 'node --test' },
      affectedSurface: surface,
      confidence: 0.8,
      verificationMethod: 'EVAL_PACK_RERUN'
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  await withFinding(finding.findingId, () => finding)
  return finding
}

test('REQUIRED PROOF: a real self-improvement NEEDS_OWNER finding is delivered as an attention notice on the next unrelated chat turn, exactly once', async () => {
  await seedNeedsOwnerFinding('http-attention-notice-surface')
  await withServer(async (base) => {
    const first = await chat(base, { projectId: null, message: 'hello there, how is everything' })
    assert.equal(first.status, 200)
    assert.match(first.body.text, /needs you/i)
    assert.match(first.body.text, /http-attention-notice-surface/)

    // A second, later unrelated turn must NOT re-deliver the same notice.
    const second = await chat(base, { projectId: null, message: 'what a nice day' })
    assert.equal(second.status, 200)
    assert.doesNotMatch(second.body.text, /http-attention-notice-surface/)
  })
})

test('a chat response with no due notices is completely unaffected (honest no-op)', async () => {
  await withServer(async (base) => {
    const res = await chat(base, { projectId: null, message: 'a message with nothing due' })
    assert.equal(res.status, 200)
    assert.ok(res.body.text.length > 0)
  })
})
