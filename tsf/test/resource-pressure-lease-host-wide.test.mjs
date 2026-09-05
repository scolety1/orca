// Main TSF overnight review of Resource Pressure Governor V0 -- bounded
// correction proof. The original candidate stored heavy-task leases inside
// opState (data-store.mjs), whose TSF_UI_STATE_FILE default resolves
// relative to the calling process's own worktree checkout. Every HQ in
// this environment runs its own TSF server from its own worktree, so that
// gave each HQ an independent, empty lease pool -- two different HQs could
// each acquire the same "kind" lease at once and run a full suite and a
// pilot simultaneously, exactly the destructive overlap the lease exists
// to prevent.
//
// This proves the fix (resource-pressure-lease-store.mjs, a host-wide
// store outside opState) against genuinely separate OS processes, each
// with a DIFFERENT TSF_UI_STATE_FILE (simulating two different HQs'
// independent opState) -- not two same-process fakes, which could never
// exercise the original bug at all.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'resource-pressure-lease-worker.mjs')

function freshLeaseDir() {
  return mkdtempSync(path.join(tmpdir(), 'tsf-resource-pressure-lease-test-'))
}

function hqEnv(leaseDir, hqName) {
  return {
    ...process.env,
    TSF_RESOURCE_PRESSURE_LEASE_DIR: leaseDir,
    TSF_UI_STATE_FILE: path.join(leaseDir, `${hqName}-operator-state.json`)
  }
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) {
      return
    }
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'a lease acquired by one simulated HQ process blocks acquisition by a genuinely separate HQ process, and releases visibly too',
  { timeout: 30_000 },
  async () => {
    const leaseDir = mkdtempSync(path.join(tmpdir(), 'tsf-resource-pressure-lease-test-'))
    const resultA1 = path.join(leaseDir, 'result-a1.json')
    const resultB1 = path.join(leaseDir, 'result-b1.json')
    const resultA2 = path.join(leaseDir, 'result-a2.json')
    const resultB2 = path.join(leaseDir, 'result-b2.json')
    try {
      // Two DIFFERENT TSF_UI_STATE_FILE values, one per simulated HQ --
      // exactly the condition under which the original opState-backed
      // lease would have given each process its own independent (empty)
      // lease pool.
      const envA = {
        ...process.env,
        TSF_RESOURCE_PRESSURE_LEASE_DIR: leaseDir,
        TSF_UI_STATE_FILE: path.join(leaseDir, 'hq-a-operator-state.json')
      }
      const envB = {
        ...process.env,
        TSF_RESOURCE_PRESSURE_LEASE_DIR: leaseDir,
        TSF_UI_STATE_FILE: path.join(leaseDir, 'hq-b-operator-state.json')
      }

      await execFileAsync(
        process.execPath,
        [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-a-mission', resultA1],
        { env: envA }
      )
      const acquiredA = JSON.parse(readFileSync(resultA1, 'utf8'))
      assert.equal(acquiredA.granted, true, 'the first, uncontested acquire must succeed')

      await execFileAsync(
        process.execPath,
        [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-b-mission', resultB1],
        { env: envB }
      )
      const blockedB = JSON.parse(readFileSync(resultB1, 'utf8'))
      assert.equal(
        blockedB.granted,
        false,
        'a genuinely separate HQ process (different TSF_UI_STATE_FILE) must see the same ' +
          'lease as held -- if this is granted, the lease pool is NOT host-wide'
      )
      assert.equal(blockedB.waitingFor, 'HEAVY_TASK_LEASE')

      await execFileAsync(
        process.execPath,
        [WORKER, 'release', 'FULL_TSF_REGRESSION', 'hq-a-mission', resultA2],
        { env: envA }
      )
      const released = JSON.parse(readFileSync(resultA2, 'utf8'))
      assert.equal(released.released, true)

      await execFileAsync(
        process.execPath,
        [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-b-mission', resultB2],
        { env: envB }
      )
      const nowGranted = JSON.parse(readFileSync(resultB2, 'utf8'))
      assert.equal(
        nowGranted.granted,
        true,
        'once HQ A releases, a genuinely separate HQ B process must be able to acquire it'
      )
    } finally {
      rmSync(leaseDir, { recursive: true, force: true })
    }
  }
)

// REQUIRED PROOF (Main TSF integration review): a full suite in one HQ and
// a pilot request in another must NOT deadlock or destructively overlap.
// By design, mutual exclusion here is PER KIND -- FULL_TSF_REGRESSION and
// BROWSER_PILOT are different kinds and are correctly allowed to run
// concurrently; the lease's job is only "never two of the SAME kind at
// once." Combined cross-kind memory pressure (a full suite AND a pilot
// both genuinely running at once) is the Resource Pressure Governor's
// TIER check's job (buildAdmissionPolicy), not this lease's -- disclosed
// explicitly here rather than assumed.
test('a full suite (HQ A) and a pilot (HQ B) acquire independently -- different kinds never block each other', { timeout: 15_000 }, async () => {
  const leaseDir = freshLeaseDir()
  const resultSuite = path.join(leaseDir, 'result-suite.json')
  const resultPilot = path.join(leaseDir, 'result-pilot.json')
  try {
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-a-mission', resultSuite], {
      env: hqEnv(leaseDir, 'hq-a')
    })
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'BROWSER_PILOT', 'hq-b-mission', resultPilot], {
      env: hqEnv(leaseDir, 'hq-b')
    })
    assert.equal(JSON.parse(readFileSync(resultSuite, 'utf8')).granted, true)
    assert.equal(JSON.parse(readFileSync(resultPilot, 'utf8')).granted, true)
  } finally {
    rmSync(leaseDir, { recursive: true, force: true })
  }
})

// REQUIRED PROOF: a real OS process crash (SIGKILL, not a clean release)
// while holding a lease must self-heal via TTL staleness -- never a
// permanent resource deadlock.
test('a real process crash while holding a lease self-heals via TTL -- no permanent deadlock', { timeout: 15_000 }, async () => {
  const leaseDir = freshLeaseDir()
  const resultHold = path.join(leaseDir, 'result-hold.json')
  const startMarker = path.join(leaseDir, 'held.start')
  const resultAfter = path.join(leaseDir, 'result-after.json')
  const holder = spawn(
    process.execPath,
    [WORKER, 'hold', 'FULL_TSF_REGRESSION', 'crashing-mission', resultHold, '150', startMarker],
    { env: hqEnv(leaseDir, 'hq-crashed'), stdio: 'ignore' }
  )
  try {
    await waitFor(() => {
      try {
        return JSON.parse(readFileSync(resultHold, 'utf8')).granted === true
      } catch {
        return false
      }
    })

    // A genuinely separate process (a fresh HQ, simulating the survivor)
    // sees it as held while it's still live.
    const resultStillHeld = path.join(leaseDir, 'result-still-held.json')
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-survivor', resultStillHeld], {
      env: hqEnv(leaseDir, 'hq-survivor')
    })
    assert.equal(JSON.parse(readFileSync(resultStillHeld, 'utf8')).granted, false)

    // Kill -9 -- no clean release, no graceful shutdown, exactly a real crash.
    holder.kill('SIGKILL')

    // Past the 150ms TTL, a fresh process must be able to reclaim it --
    // proving this is a genuine self-heal, not a permanent deadlock.
    await new Promise((resolve) => setTimeout(resolve, 250))
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-survivor', resultAfter], {
      env: hqEnv(leaseDir, 'hq-survivor')
    })
    assert.equal(JSON.parse(readFileSync(resultAfter, 'utf8')).granted, true, 'the stale lease from the crashed process must be reclaimable')
  } finally {
    holder.kill('SIGKILL')
    rmSync(leaseDir, { recursive: true, force: true })
  }
})

// REQUIRED PROOF: a genuinely corrupted lease file (not merely absent)
// must never crash a caller -- fails closed to an empty pool, the next
// successful write repairs it.
test('a malformed/corrupt lease state file never crashes the store -- fails closed to an empty pool', { timeout: 10_000 }, async () => {
  const leaseDir = freshLeaseDir()
  writeFileSync(path.join(leaseDir, 'leases.json'), '{ this is not valid JSON ]]]')
  const resultAcquire = path.join(leaseDir, 'result-acquire.json')
  try {
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-a-mission', resultAcquire], {
      env: hqEnv(leaseDir, 'hq-a')
    })
    assert.equal(
      JSON.parse(readFileSync(resultAcquire, 'utf8')).granted,
      true,
      'a corrupt pre-existing file must not block a real acquire -- treated as empty, not as a crash'
    )
    // The repair is durable: the file is no longer garbage.
    const repaired = JSON.parse(readFileSync(path.join(leaseDir, 'leases.json'), 'utf8'))
    assert.ok(repaired.FULL_TSF_REGRESSION)
  } finally {
    rmSync(leaseDir, { recursive: true, force: true })
  }
})

// REQUIRED PROOF: two genuinely separate OS processes racing to acquire
// the SAME kind at the SAME time -- exactly one must win; the loser must
// see an honest refusal, never a corrupted/double-granted state. Mirrors
// keep-going-run-store-cross-process.test.mjs's own real-race discipline
// (a start marker proves genuine overlap, not accidental serialization).
test('two real OS processes racing to acquire the same lease kind: exactly one wins, never both', { timeout: 15_000 }, async () => {
  const leaseDir = freshLeaseDir()
  const resultA = path.join(leaseDir, 'result-race-a.json')
  const resultB = path.join(leaseDir, 'result-race-b.json')
  const startA = path.join(leaseDir, 'race.start-a')
  const startB = path.join(leaseDir, 'race.start-b')
  try {
    await Promise.all([
      execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'racer-a', resultA, '', startA], {
        env: hqEnv(leaseDir, 'hq-racer-a')
      }),
      execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'racer-b', resultB, '', startB], {
        env: hqEnv(leaseDir, 'hq-racer-b')
      })
    ])

    const startedA = Number(readFileSync(startA, 'utf8'))
    const startedB = Number(readFileSync(startB, 'utf8'))
    assert.ok(
      Math.abs(startedA - startedB) < 2000,
      `the two racing processes must genuinely overlap to exercise the lock (started ${Math.abs(startedA - startedB)}ms apart)`
    )

    const grantedA = JSON.parse(readFileSync(resultA, 'utf8')).granted
    const grantedB = JSON.parse(readFileSync(resultB, 'utf8')).granted
    assert.notEqual(grantedA, grantedB, 'exactly one racer must win -- never both, never neither')
  } finally {
    rmSync(leaseDir, { recursive: true, force: true })
  }
})

// REQUIRED PROOF: a "backend restart" (a fresh process reading the SAME
// durable lease file, with zero in-memory state carried over -- exactly
// what a real TSF server restart looks like, since this store holds no
// in-memory cache) resumes correctly: state already on disk is what a
// fresh process sees, nothing is lost or duplicated.
test('a backend restart (fresh process, same durable lease file) sees exactly the pre-restart state', { timeout: 15_000 }, async () => {
  const leaseDir = freshLeaseDir()
  const resultBefore = path.join(leaseDir, 'result-before.json')
  const resultAfterRestart = path.join(leaseDir, 'result-after-restart.json')
  try {
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-a-mission', resultBefore], {
      env: hqEnv(leaseDir, 'hq-a')
    })
    assert.equal(JSON.parse(readFileSync(resultBefore, 'utf8')).granted, true)

    // A brand-new process (the "restarted backend") with no memory of the
    // prior one, reading the same lease dir, still sees it held.
    await execFileAsync(process.execPath, [WORKER, 'acquire', 'FULL_TSF_REGRESSION', 'hq-a-restarted', resultAfterRestart], {
      env: hqEnv(leaseDir, 'hq-a-restarted')
    })
    assert.equal(
      JSON.parse(readFileSync(resultAfterRestart, 'utf8')).granted,
      false,
      'a restarted process must resume from the real durable state, not a fresh empty pool'
    )
  } finally {
    rmSync(leaseDir, { recursive: true, force: true })
  }
})
