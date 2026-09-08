// Real decision logic for the UI rebuild trigger, against a fake spawn (same
// fake-child-process pattern as server-process-lifecycle.test.mjs -- a real
// EventEmitter with stdout/stderr EventEmitters, no real npm ever spawned).
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import {
  triggerUiRebuildIfStale,
  getUiBuildActionState,
  getRuntimeIdentityWithBuildState,
  resetUiBuildActionStateForTest
} from '../server/ui-build-orchestrator.mjs'

function makeFakeSpawner() {
  const calls = []
  const children = []
  const spawnFn = (args, cwd) => {
    calls.push({ args, cwd })
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    children.push(proc)
    return proc
  }
  return { spawnFn, calls, children }
}

function identityFn(state, extra = {}) {
  return async () => ({
    state,
    reason: `fixture: ${state}`,
    runningCommit: 'a',
    diskCommit: 'a',
    uiBundleCommit: null,
    ...extra
  })
}

// triggerUiRebuildIfStale awaits getRuntimeIdentityFn before it ever spawns,
// so a caller that just started it (without awaiting the whole promise, e.g.
// to assert an in-progress guard) needs one real macrotask tick for that
// internal await to resolve and the spawn to actually happen -- setImmediate
// reliably flushes it regardless of exact microtask-count.
function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

test.beforeEach(() => {
  resetUiBuildActionStateForTest()
})

test('stale + healthy env triggers a real npm run build via the injected spawnFn seam, with the exact fixed (args, cwd) shape defaultSpawn itself receives', async () => {
  const { spawnFn, calls, children } = makeFakeSpawner()
  const trigger = triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  await flush()
  assert.equal(calls.length, 1, 'spawned exactly once')
  assert.deepEqual(calls[0].args, ['run', 'build'])
  assert.equal(calls[0].cwd, '/fake/tsf/ui')
  assert.equal(getUiBuildActionState().status, 'BUILDING')
  children[0].emit('exit', 0)
  const result = await trigger
  assert.equal(result.ok, true)
  assert.equal(getUiBuildActionState().status, 'IDLE')
})

test('stale + missing node_modules does NOT auto-install and reports honestly, never attempting a spawn', async () => {
  const { spawnFn, calls } = makeFakeSpawner()
  const result = await triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => false,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  assert.equal(calls.length, 0, 'never spawned npm install or npm run build')
  assert.equal(result.ok, false)
  assert.match(result.reason, /node_modules is missing/)
  assert.match(result.reason, /npm install/)
  const state = getUiBuildActionState()
  assert.equal(state.status, 'FAILED')
  assert.match(state.reason, /node_modules is missing/)
})

test('already UP_TO_DATE does not trigger a build', async () => {
  const { spawnFn, calls } = makeFakeSpawner()
  const result = await triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UP_TO_DATE')
  })
  assert.equal(calls.length, 0)
  assert.equal(result.skipped, true)
  assert.equal(getUiBuildActionState().status, 'IDLE')
})

test('LIVE_RUNTIME_STALE never triggers a build (needs a process restart, out of scope here)', async () => {
  const { spawnFn, calls } = makeFakeSpawner()
  const result = await triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('LIVE_RUNTIME_STALE')
  })
  assert.equal(calls.length, 0)
  assert.equal(result.skipped, true)
})

test('a build already in progress is never triggered a second time concurrently', async () => {
  const { spawnFn, calls, children } = makeFakeSpawner()
  const first = triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  await flush()
  assert.equal(calls.length, 1, 'first trigger spawned')

  const second = await triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  assert.equal(calls.length, 1, 'second call did NOT spawn a concurrent build')
  assert.equal(second.skipped, true)
  assert.match(second.reason, /already in progress/)

  children[0].emit('exit', 0)
  await first
})

test('a real build failure produces BUILD_FAILED with the real captured exit code + stderr, never a silent UP_TO_DATE', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const trigger = triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  await flush()
  children[0].stderr.emit('data', Buffer.from('TypeScript error: something real broke\n'))
  children[0].emit('exit', 1)
  const result = await trigger
  assert.equal(result.ok, false)
  assert.match(result.reason, /exited with code 1/)
  assert.match(result.reason, /something real broke/)
  const state = getUiBuildActionState()
  assert.equal(state.status, 'FAILED')
  assert.match(state.reason, /exited with code 1/)
})

test('getRuntimeIdentityWithBuildState composes the real identity read with the current in-memory build action', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const trigger = triggerUiRebuildIfStale({
    uiDir: '/fake/tsf/ui',
    distDir: '/fake/tsf/ui/dist',
    spawnFn,
    existsFn: () => true,
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  await flush()
  const midBuild = await getRuntimeIdentityWithBuildState('/fake/tsf/ui/dist', {
    getRuntimeIdentityFn: identityFn('UI_BUNDLE_STALE')
  })
  assert.equal(midBuild.state, 'UI_BUILDING')
  children[0].emit('exit', 0)
  await trigger
})

// Real live-acceptance finding: the desktop's own real npm.cmd spawn threw
// a real, synchronous `spawn EINVAL` on Windows (CVE-2024-27980 Node
// hardening refuses to exec a .cmd directly under this module's own former
// `shell: false` default). Everything above exercises the injectable
// spawnFn seam with a fake process -- this is the one test that lets
// triggerUiRebuildIfStale use its REAL default spawn (no spawnFn override)
// against the real tsf/ui, proving the actual Windows fix, not just the
// decision logic around it. Real, but bounded and fast (~2s): a real
// `npm run build`, same one a live desktop launch would run.
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

test(
  'REAL PROOF: triggerUiRebuildIfStale, with no spawnFn override, actually runs a real npm run build against the real tsf/ui on this host without throwing spawn EINVAL, and build-identity.json advances to the real current HEAD',
  { skip: process.platform !== 'win32' ? 'Windows-specific spawn fix; nothing to prove on this platform' : false },
  async () => {
    const realUiDir = path.join(import.meta.dirname, '..', 'ui')
    const scratchDistDir = mkdtempSync(path.join(tmpdir(), 'tsf-real-ui-rebuild-proof-'))
    try {
      const result = await triggerUiRebuildIfStale({ uiDir: realUiDir, distDir: scratchDistDir })
      assert.equal(result.ok, true, `real build must succeed, got: ${JSON.stringify(result)}`)
      assert.equal(getUiBuildActionState().status, 'IDLE', 'self-heals to IDLE on real success')
      // The real build always writes to the real tsf/ui/dist regardless of
      // the scratch distDir passed above (that param only controls where
      // staleness is READ from) -- confirm it actually advanced there.
      const { getRuntimeIdentity } = await import('../server/runtime-identity-tracker.mjs')
      const { getCurrentCommit } = await import('../adapters/git-identity.mjs')
      const disk = await getCurrentCommit(realUiDir)
      const identity = await getRuntimeIdentity(path.join(realUiDir, 'dist'))
      assert.equal(identity.uiBundleCommit, disk.commit, 'the real dist build-identity.json now matches the real current HEAD')
    } finally {
      rmSync(scratchDistDir, { recursive: true, force: true })
    }
  }
)
