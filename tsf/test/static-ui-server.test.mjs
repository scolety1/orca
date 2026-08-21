import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStaticUiHandler } from '../server/static-ui-server.mjs'

function makeFixtureDist() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-static-ui-'))
  writeFileSync(path.join(dir, 'index.html'), '<html><body>tsf-ui</body></html>')
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("app")')
  writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{color:red}')
  return dir
}

async function withServer(distDir, run) {
  const serveStaticUi = createStaticUiHandler(distDir)
  const server = createServer((req, res) => {
    if (serveStaticUi(req, res)) {
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('a real request for a JS asset serves it with the right content-type', async () => {
  const distDir = makeFixtureDist()
  try {
    await withServer(distDir, async (base) => {
      const res = await fetch(`${base}/assets/app.js`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/javascript/)
      assert.equal(await res.text(), 'console.log("app")')
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('a real request for a CSS asset serves it with the right content-type', async () => {
  const distDir = makeFixtureDist()
  try {
    await withServer(distDir, async (base) => {
      const res = await fetch(`${base}/assets/app.css`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/css/)
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('a client-side route with no file extension falls back to index.html (SPA routing)', async () => {
  const distDir = makeFixtureDist()
  try {
    await withServer(distDir, async (base) => {
      const res = await fetch(`${base}/projects/some-project`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/html/)
      assert.match(await res.text(), /tsf-ui/)
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('a request for a missing asset (has a file extension) 404s honestly instead of silently serving index.html', async () => {
  const distDir = makeFixtureDist()
  try {
    await withServer(distDir, async (base) => {
      const res = await fetch(`${base}/assets/does-not-exist.js`)
      assert.equal(res.status, 404)
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('a plain ../ traversal never escapes distDir -- the WHATWG URL parser collapses it before the handler sees it, so it safely falls back to index.html rather than reading outside distDir', async () => {
  const distDir = makeFixtureDist()
  try {
    await withServer(distDir, async (base) => {
      const res = await fetch(`${base}/../../../../etc/passwd`)
      // A literal .. segment is unreachable here: the URL parser collapses
      // it against the URL's own root before the handler runs, so this
      // resolves to /etc/passwd, which has no dot in its last segment and
      // is therefore treated as a client-side route, not an asset request
      // -- it correctly falls back to index.html (200, tsf-ui content),
      // never reads anything outside distDir.
      assert.equal(res.status, 200)
      assert.match(await res.text(), /tsf-ui/)
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
})

test('a percent-encoded ../ (the classic normalize-then-decode bypass vector) does not escape distDir', async () => {
  const distDir = makeFixtureDist()
  // Real sentinel file placed OUTSIDE distDir (in its parent) with unique
  // content -- if traversal ever worked, this exact string would leak into
  // the response.
  const sentinelPath = path.join(path.dirname(distDir), `tsf-static-ui-sentinel-${Date.now()}.txt`)
  writeFileSync(sentinelPath, 'SENTINEL_SECRET_OUTSIDE_DISTDIR')
  try {
    await withServer(distDir, async (base) => {
      const sentinelName = path.basename(sentinelPath)
      // %2e%2e is NOT collapsed by URL dot-segment normalization (that only
      // recognizes the literal ASCII ".." bytes) -- it survives to the
      // handler's own decodeURIComponent call, which is the exact bypass
      // this test exists to catch if path.join ever stopped being safe.
      const res = await fetch(`${base}/%2e%2e/${sentinelName}`)
      const body = await res.text()
      assert.doesNotMatch(body, /SENTINEL_SECRET_OUTSIDE_DISTDIR/)
    })
  } finally {
    rmSync(distDir, { recursive: true, force: true })
    rmSync(sentinelPath, { force: true })
  }
})

test('when distDir/index.html does not exist at all, the handler declines every request (returns false)', async () => {
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'tsf-static-ui-empty-'))
  try {
    await withServer(emptyDir, async (base) => {
      const res = await fetch(`${base}/`)
      assert.equal(res.status, 404)
    })
  } finally {
    rmSync(emptyDir, { recursive: true, force: true })
  }
})
