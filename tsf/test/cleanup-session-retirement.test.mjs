// Real spawned disposable Node child processes -- never a real Tim
// session/process. Every retirement call targets an exact PID this test
// itself spawned and tracks.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fork, spawn } from 'node:child_process'
import path from 'node:path'
import { retireSessionGracefully } from '../server/cleanup-session-retirement.mjs'

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const poll = () => {
      if (!isAlive(pid)) {
        resolve(true)
        return
      }
      if (Date.now() > deadline) {
        resolve(false)
        return
      }
      setTimeout(poll, 25)
    }
    poll()
  })
}

test('a real IPC-cooperative child exits cleanly on the graceful message -- never escalates to force', async () => {
  const child = fork(path.join(import.meta.dirname, 'fixtures', 'cleanup-cooperative-child.mjs'), { stdio: 'ignore' })
  await new Promise((resolve) => child.once('message', (m) => m === 'ready' && resolve()))
  const outcome = await retireSessionGracefully({ pid: child.pid, send: (msg) => child.send(msg), graceMs: 3000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.escalatedToForce, false)
  assert.equal(outcome.alreadyStopped, false)
  assert.equal(await waitForExit(child.pid, 3000), true)
})

test('a child with no IPC/cooperative handler is escalated to a PID-targeted forceful stop after the grace period', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  const outcome = await retireSessionGracefully({ pid: child.pid, graceMs: 500 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.escalatedToForce, true, 'a non-cooperative process must be escalated, never left running forever')
  assert.equal(await waitForExit(child.pid, 3000), true)
})

test('identity verification refuses to signal a PID whose identity does not match -- the process is left untouched', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 200))
    await assert.rejects(
      () => retireSessionGracefully({ pid: child.pid, verifyIdentity: () => false, graceMs: 500 }),
      (error) => error.code === 'TSF_CLEANUP_IDENTITY_MISMATCH'
    )
    assert.equal(isAlive(child.pid), true, 'a mismatched-identity PID must never be signaled')
  } finally {
    process.kill(child.pid)
    await waitForExit(child.pid, 3000)
  }
})

test('an already-stopped PID is a no-op success, not an error', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  await waitForExit(child.pid, 3000)
  const outcome = await retireSessionGracefully({ pid: child.pid, graceMs: 500 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.alreadyStopped, true)
})

test('retireSessionGracefully rejects a non-positive-integer pid rather than silently no-oping', async () => {
  await assert.rejects(() => retireSessionGracefully({ pid: -1 }))
  await assert.rejects(() => retireSessionGracefully({ pid: 'not-a-pid' }))
})

test('static proof: no kill-by-executable-name mechanism exists anywhere in the session retirement source (no taskkill /IM, no pkill by name)', () => {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'server', 'cleanup-session-retirement.mjs'), 'utf8')
  // Only real, executable code lines -- this file's own comments freely
  // DISCUSS "/IM" (to explain why it's avoided), which would otherwise
  // false-positive this scan.
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.equal(/['"]\/IM['"]/i.test(codeOnly), false, 'taskkill must never be invoked with a literal /IM (name-based) argument')
  assert.equal(/\bpkill\b/.test(codeOnly), false, 'pkill (name-based) must never appear in real code')
  assert.ok(/['"]\/PID['"]/.test(codeOnly), 'the forceful path must be PID-targeted (a literal /PID argument)')
})
