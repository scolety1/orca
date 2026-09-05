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
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'resource-pressure-lease-worker.mjs')

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
