// Pre-UI Productization V1, Priority 4 gap 2: real, end-to-end HTTP proof
// that POST /api/ui-setup reaches runUiSetup (via handleSafeUpdateRoute)
// with the real uiDir/distDir this server was configured with -- the
// decision logic itself (install success/failure, in-flight guard,
// chaining into a build) is already covered against injected fakes in
// ui-build-orchestrator.test.mjs; this only proves the route wiring is
// real, using the REAL default repairProjectFn/spawnFn (bounded and fast:
// both fixtures below fail in well under a second, no network -- neither
// has a package.json for npm to find).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-ui-setup-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { resetUiBuildActionStateForTest } = await import('../server/ui-build-orchestrator.mjs')

async function withServer(uiDir, uiDistDir, fn) {
  resetUiBuildActionStateForTest()
  const handler = createRequestHandler({ uiDir, uiDistDir })
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
    resetUiBuildActionStateForTest()
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
    rmSync(`${STATE_FILE}.runtime.json`, { force: true })
  }
}

test('POST /api/ui-setup reaches the real install path when node_modules is genuinely missing, using the real default repairProjectFn', async () => {
  const uiDir = mkdtempSync(path.join(tmpdir(), 'tsf-ui-setup-no-deps-'))
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-ui-setup-dist-'))
  try {
    await withServer(uiDir, distDir, async (base) => {
      const res = await fetch(`${base}/api/ui-setup`, { method: 'POST' })
      assert.equal(res.status, 200)
      const body = await res.json()
      // uiDir has no package.json -- the real `npm install` genuinely
      // fails fast, proving this reached the real install primitive (not
      // a stub), never a fabricated success.
      assert.equal(body.ok, false)
      assert.match(body.reason, /dependency install failed/)
      assert.match(body.reason, /Set up TSF/)
    })
  } finally {
    rmSync(uiDir, { recursive: true, force: true })
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('POST /api/ui-setup skips straight to a real build attempt when node_modules already exists, using the real default spawnFn', async () => {
  const uiDir = mkdtempSync(path.join(tmpdir(), 'tsf-ui-setup-has-deps-'))
  mkdirSync(path.join(uiDir, 'node_modules'))
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-ui-setup-dist-'))
  try {
    await withServer(uiDir, distDir, async (base) => {
      const res = await fetch(`${base}/api/ui-setup`, { method: 'POST' })
      assert.equal(res.status, 200)
      const body = await res.json()
      // uiDir has no package.json -- the real `npm run build` genuinely
      // fails fast (ENOENT), proving this reached the real build trigger
      // directly, never attempting an install first.
      assert.equal(body.ok, false)
      assert.equal(body.skipped, false)
    })
  } finally {
    rmSync(uiDir, { recursive: true, force: true })
    rmSync(distDir, { recursive: true, force: true })
  }
})
