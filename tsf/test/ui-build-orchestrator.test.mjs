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

test('stale + healthy env triggers a real npm run build via argv spawn (never a shell string)', async () => {
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
