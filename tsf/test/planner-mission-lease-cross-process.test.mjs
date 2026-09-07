// Real cross-process proof for 2B's race-handling requirement: two
// GENUINELY SEPARATE OS processes (not two in-process fakes, which could
// never exercise the actual cross-process-file-lock.mjs serialization)
// racing to acquire the same mission lease -- exactly one must win. Mirrors
// resource-pressure-lease-host-wide.test.mjs's own real-process discipline.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'planner-mission-lease-worker.mjs')

function freshEnv(stateFile) {
  return { ...process.env, TSF_UI_STATE_FILE: stateFile }
}

test('two real OS processes racing to acquire the same planner mission lease: exactly one wins', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-mission-lease-test-'))
  const stateFile = path.join(dir, 'operator-state.json')
  const resultA = path.join(dir, 'result-a.json')
  const resultB = path.join(dir, 'result-b.json')
  const startA = path.join(dir, 'race.start-a')
  const startB = path.join(dir, 'race.start-b')
  try {
    await Promise.all([
      execFileAsync(process.execPath, [WORKER, 'acquire', 'mission:cross-process-race', 'planner-A', resultA, startA], { env: freshEnv(stateFile) }),
      execFileAsync(process.execPath, [WORKER, 'acquire', 'mission:cross-process-race', 'planner-B', resultB, startB], { env: freshEnv(stateFile) })
    ])

    const startedA = Number(readFileSync(startA, 'utf8'))
    const startedB = Number(readFileSync(startB, 'utf8'))
    assert.ok(Math.abs(startedA - startedB) < 2000, 'the two racing processes must genuinely overlap to exercise the lock')

    const grantedA = JSON.parse(readFileSync(resultA, 'utf8')).granted
    const grantedB = JSON.parse(readFileSync(resultB, 'utf8')).granted
    assert.notEqual(grantedA, grantedB, 'exactly one racer must win -- never both, never neither')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a genuinely separate process sees the lease released by another process (a real backend-restart-style handoff)', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-mission-lease-test-'))
  const stateFile = path.join(dir, 'operator-state.json')
  const resultAcquire = path.join(dir, 'result-acquire.json')
  const resultRelinquish = path.join(dir, 'result-relinquish.json')
  const resultReacquire = path.join(dir, 'result-reacquire.json')
  try {
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'mission:cross-process-handoff', 'planner-A', resultAcquire], { env: freshEnv(stateFile) })
    assert.equal(JSON.parse(readFileSync(resultAcquire, 'utf8')).granted, true)

    await execFileAsync(process.execPath, [WORKER, 'relinquish', 'mission:cross-process-handoff', 'planner-A', resultRelinquish], { env: freshEnv(stateFile) })
    assert.equal(JSON.parse(readFileSync(resultRelinquish, 'utf8')).released, true)

    // A brand-new process, no memory of the prior one, sees the released
    // durable state and can acquire.
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'mission:cross-process-handoff', 'planner-B', resultReacquire], { env: freshEnv(stateFile) })
    assert.equal(JSON.parse(readFileSync(resultReacquire, 'utf8')).granted, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
