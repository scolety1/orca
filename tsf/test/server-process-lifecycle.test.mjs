import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { startServerLifecycle } from '../server/server-process-lifecycle.mjs'

// A fake child process: real EventEmitter (exit/stdout/stderr data events),
// no real process spawned. spawnCalls records every spawnFn invocation so
// tests can assert on restart behavior deterministically.
function makeFakeSpawner() {
  const children = []
  const spawnFn = () => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.killed = false
    proc.kill = () => {
      proc.killed = true
    }
    children.push(proc)
    return proc
  }
  return { spawnFn, children }
}

function immediateSchedule(fn) {
  fn()
}

test('a clean unexpected exit restarts once, up to maxRestarts, then gives up', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const logs = []
  startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    log: (level, msg) => logs.push({ level, msg }),
    maxRestarts: 2,
    scheduleRestart: immediateSchedule
  })
  assert.equal(children.length, 1, 'spawned once on start')

  children[0].emit('exit', 1, null)
  assert.equal(children.length, 2, 'restarted after the first unexpected exit')

  children[1].emit('exit', 1, null)
  assert.equal(
    children.length,
    3,
    'restarted after the second unexpected exit (2nd attempt, at maxRestarts)'
  )

  children[2].emit('exit', 1, null)
  assert.equal(children.length, 3, 'did NOT restart a 3rd time -- maxRestarts exceeded, gave up')
  assert.ok(
    logs.some((l) => l.level === 'error' && /exceeded 2 restart attempts/.test(l.msg)),
    'logs an honest give-up message'
  )
})

test('an EADDRINUSE exit is treated as already-running, not restarted', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const logs = []
  const lifecycle = startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    log: (level, msg) => logs.push({ level, msg }),
    scheduleRestart: immediateSchedule
  })
  children[0].stderr.emit(
    'data',
    Buffer.from('Error: listen EADDRINUSE: address already in use 127.0.0.1:4610')
  )
  children[0].emit('exit', 1, null)

  assert.equal(
    children.length,
    1,
    'did not spawn a second server on top of the one already running'
  )
  assert.equal(lifecycle.getSawPortInUse(), true)
  assert.ok(logs.some((l) => l.level === 'warn' && /already in use/.test(l.msg)))
})

test('stop() prevents any restart on the exit it itself causes', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const lifecycle = startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    scheduleRestart: immediateSchedule
  })
  lifecycle.stop()
  assert.equal(children[0].killed, true, 'the real child was killed')
  children[0].emit('exit', null, 'SIGTERM')
  assert.equal(children.length, 1, 'an intentional stop never triggers a restart')
})

test('restart uses the configured backoff delay, not an immediate synchronous respawn', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const scheduled = []
  startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    restartBackoffMs: 5000,
    scheduleRestart: (fn, ms) => scheduled.push({ fn, ms })
  })
  children[0].emit('exit', 1, null)
  assert.equal(children.length, 1, 'no respawn happened until the scheduled callback actually runs')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].ms, 5000)
  scheduled[0].fn()
  assert.equal(children.length, 2, 'respawn happens once the backoff callback fires')
})

test('a clean exit (code 0, no signal) is not restarted -- it is a graceful shutdown, not a crash', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const logs = []
  const lifecycle = startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    log: (level, msg) => logs.push({ level, msg }),
    scheduleRestart: immediateSchedule
  })
  children[0].emit('exit', 0, null)
  assert.equal(children.length, 1, 'a clean exit(0) does not trigger a respawn')
  assert.equal(lifecycle.getRestartCount(), 0)
  assert.ok(logs.some((l) => l.level === 'info' && /exited cleanly/.test(l.msg)))
})

test('getRestartCount reflects the real number of restarts performed', async () => {
  const { spawnFn, children } = makeFakeSpawner()
  const lifecycle = startServerLifecycle({
    spawnFn,
    serverEntryPath: '/fake/http-server.mjs',
    port: 4610,
    maxRestarts: 5,
    scheduleRestart: immediateSchedule
  })
  children[0].emit('exit', 1, null)
  children[1].emit('exit', 1, null)
  assert.equal(lifecycle.getRestartCount(), 2)
})
