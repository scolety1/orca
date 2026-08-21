import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startStandaloneServer } from '../server/http-server.mjs'

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
