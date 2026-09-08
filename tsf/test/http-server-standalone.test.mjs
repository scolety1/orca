import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startStandaloneServer } from '../server/http-server.mjs'
import { getUiBuildActionState, resetUiBuildActionStateForTest } from '../server/ui-build-orchestrator.mjs'

// M6: startStandaloneServer previously had no direct test coverage at all
// (only ever exercised manually, e.g. M4's real restart proof) -- this
// covers the new static-UI wiring specifically, not the whole /api surface
// (already covered extensively elsewhere).
test('the standalone server serves both /api and the static tsf/ui build from one process', async () => {
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-ui-'))
  writeFileSync(path.join(distDir, 'index.html'), '<html><body>standalone-tsf-ui</body></html>')
  const server = startStandaloneServer(0, { uiDistDir: distDir })
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`

    const apiRes = await fetch(`${base}/api/meta`)
    assert.equal(apiRes.status, 200)
    const apiBody = await apiRes.json()
    assert.equal(apiBody.product, 'Thousand Sunny Fleet — Orca Foundation')

    const uiRes = await fetch(`${base}/`)
    assert.equal(uiRes.status, 200)
    assert.match(await uiRes.text(), /standalone-tsf-ui/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(distDir, { recursive: true, force: true })
  }
})

// Resource-scoping finding (this session's own full-suite run): without
// this gate, ANY test spawning a real server with no build-identity.json
// in its distDir (both tests above included -- a fresh temp dir always
// looks UI_BUNDLE_STALE) would trigger a real `npm run build` attempt.
// TSF_UI_AUTO_REBUILD=1 is only ever set by the real live-plugin spawn
// path (main.mjs's realSpawnFn), mirroring TSF_KEEP_GOING_FLEET_DRIVER.
test('startStandaloneServer never triggers a real UI rebuild by default (no TSF_UI_AUTO_REBUILD) even against a genuinely stale distDir', async () => {
  resetUiBuildActionStateForTest()
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-ui-gate-'))
  const uiDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-uidir-gate-'))
  delete process.env.TSF_UI_AUTO_REBUILD
  const server = startStandaloneServer(0, { uiDistDir: distDir, uiDir })
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    // Give any (incorrectly) fired fire-and-forget trigger a real chance
    // to have started before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(getUiBuildActionState().status, 'IDLE', 'no rebuild should ever be attempted for a test-spawned server')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(distDir, { recursive: true, force: true })
    rmSync(uiDir, { recursive: true, force: true })
  }
})

test('startStandaloneServer DOES attempt a real UI rebuild when TSF_UI_AUTO_REBUILD=1 is explicitly set (the real live-plugin-spawn opt-in)', async () => {
  resetUiBuildActionStateForTest()
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-ui-gate-on-'))
  const uiDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-uidir-gate-on-'))
  process.env.TSF_UI_AUTO_REBUILD = '1'
  const server = startStandaloneServer(0, { uiDistDir: distDir, uiDir })
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    // uiDir has no node_modules -- the orchestrator's own real, honest
    // FAILED path (never an uncontrolled npm install), but proves the
    // gate let the real attempt through at all.
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.notEqual(getUiBuildActionState().status, 'IDLE', 'the real opt-in must actually reach the orchestrator')
  } finally {
    delete process.env.TSF_UI_AUTO_REBUILD
    resetUiBuildActionStateForTest()
    await new Promise((resolve) => server.close(resolve))
    rmSync(distDir, { recursive: true, force: true })
    rmSync(uiDir, { recursive: true, force: true })
  }
})

test('a non-/api path 404s honestly when no uiDistDir build exists', async () => {
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'tsf-standalone-ui-empty-'))
  const server = startStandaloneServer(0, { uiDistDir: emptyDir })
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(res.status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(emptyDir, { recursive: true, force: true })
  }
})
