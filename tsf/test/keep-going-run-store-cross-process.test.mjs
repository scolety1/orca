import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// A real, independent-verifier finding: keep-going-run-store.mjs's whole
// atomicity argument ("Node's single-threaded event loop only yields at
// an await") only holds WITHIN one OS process. This test proves the fix
// (cross-process-file-lock.mjs) against genuinely separate OS processes --
// not two same-process fakes, which cannot exercise a cross-process race
// at all -- racing two real `node` child processes against the SAME real
// state file.
const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-cross-process-${process.pid}.json`
)
const WORKER = path.join(HERE, 'fixtures', 'cross-process-lock-worker.mjs')
const PROJECT_ID = 'fixture:cross-process'
const START_MARKER_A = `${STATE_FILE}.worker-a.start`
const START_MARKER_B = `${STATE_FILE}.worker-b.start`
// Overlap window loose enough for real process-spawn jitter on a loaded
// CI runner, tight enough that two processes started sequentially (one
// finishing before the other begins) could never satisfy it.
const OVERLAP_WINDOW_MS = 2_000

test.afterEach(() => {
  rmSync(STATE_FILE, { force: true })
  rmSync(`${STATE_FILE}.tmp`, { force: true })
  rmSync(`${STATE_FILE}.lock`, { force: true })
  rmSync(START_MARKER_A, { force: true })
  rmSync(START_MARKER_B, { force: true })
})

test(
  'two genuinely separate OS processes racing withKeepGoingRun against the same real state file never lose an update',
  { timeout: 60_000 },
  async () => {
    const env = { ...process.env, TSF_UI_STATE_FILE: STATE_FILE }
    // Enough iterations that, combined with the lock's own retry interval,
    // real overlap is overwhelmingly likely rather than merely possible --
    // a real review finding against a smaller count that could pass even
    // without genuine contention.
    const perProcess = 200

    // Both processes start "at the same time" -- real OS scheduling, not
    // simulated interleaving -- so this genuinely exercises the lock
    // rather than relying on one process happening to finish first.
    await Promise.all([
      execFileAsync(process.execPath, [WORKER, PROJECT_ID, String(perProcess), START_MARKER_A], {
        env
      }),
      execFileAsync(process.execPath, [WORKER, PROJECT_ID, String(perProcess), START_MARKER_B], {
        env
      })
    ])

    // Confirms genuine overlap rather than accidental serialization by
    // process-spawn timing (a real review finding: the prior version had
    // no instrumentation proving the two processes actually raced).
    const startedA = Number(readFileSync(START_MARKER_A, 'utf8'))
    const startedB = Number(readFileSync(START_MARKER_B, 'utf8'))
    assert.ok(
      Math.abs(startedA - startedB) < OVERLAP_WINDOW_MS,
      `the two worker processes must genuinely overlap to exercise the lock (started ${Math.abs(startedA - startedB)}ms apart)`
    )

    const finalState = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    assert.equal(
      finalState.keepGoingRuns[PROJECT_ID].counter,
      perProcess * 2,
      'every increment from BOTH real OS processes must land -- a lost update means the ' +
        'cross-process lock did not actually serialize the two processes'
    )
  }
)
