// Phase 12 (Durable State / Restart Gauntlet, category 4 -- Needs You).
// Reconciliation: F19 (Phase 6) fixed fleetNeedsYouStatus to READ a
// planner-raised Needs You item; F6's own crash test never raises one at
// all (its crash happens strictly before any escalation). No existing
// crash/restart test in this repo actually raises a Needs You item, kills
// the real process holding it, and confirms it is both durably intact AND
// correctly surfaced by the real aggregation afterward -- this closes that
// specific explicit-assertion gap for ResearchMission. Mirrors F6's own
// research-mission-process-crash-survival.test.mjs template exactly
// (REUSE_PATTERN, same spawn/SIGKILL mechanics, same generic fixture).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'research-mission-needs-you-crash-worker.mjs')
const MISSION_ID = 'mission:needs-you-crash-survival-fixture'
const NODE_ID = 'node:needs-you-crash-survival-fixture'

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'REAL process crash after a Needs You question is raised: the open question survives a real SIGKILL and is correctly surfaced by the real fleet aggregation afterward',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-research-needs-you-crash-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'raised.json')
    // Set BEFORE the in-process dynamic import below -- data-store.mjs
    // captures TSF_UI_STATE_FILE into a module-level const at import time.
    process.env.TSF_UI_STATE_FILE = stateFile
    const { readResearchMission } = await import('../server/research-mission-store.mjs')
    const { fleetNeedsYouStatus } = await import('../domain/fleet-work-status.mjs')

    const child = spawn(process.execPath, [WORKER, MISSION_ID, NODE_ID, stateFile, resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await waitFor(() => {
        try {
          return JSON.parse(readFileSync(resultPath, 'utf8')).needsYouRaised === true
        } catch {
          return false
        }
      })
      const marker = JSON.parse(readFileSync(resultPath, 'utf8'))

      // WHILE THE CHILD IS STILL ALIVE: a fresh reader already sees the
      // real, open Needs You entry -- ResearchMission has no lease/ownership
      // gate (see F6's own test), so this is a plain, uncontested read.
      const live = readResearchMission(MISSION_ID)
      const liveEntry = live.needsYou.find((entry) => entry.id === marker.needsYouId)
      assert.ok(liveEntry, 'the raised entry is visible before the crash')
      assert.equal(liveEntry.resolvedAt, null)
      assert.equal(live.state, 'NEEDS_YOU')

      // Kill -9 -- no relinquish, no graceful shutdown.
      child.kill('SIGKILL')
      await exited

      // POST-CRASH: a genuinely separate read proves the open question
      // itself -- not just the dispatched node -- survived intact.
      const afterCrash = readResearchMission(MISSION_ID)
      const entryAfterCrash = afterCrash.needsYou.find((entry) => entry.id === marker.needsYouId)
      assert.ok(entryAfterCrash, 'the Needs You entry must not be lost by the crash')
      assert.equal(entryAfterCrash.question, marker.question)
      assert.equal(entryAfterCrash.resolvedAt, null, 'still open, not silently resolved by the crash')
      assert.equal(afterCrash.state, 'NEEDS_YOU')

      // And the real production aggregation (F19's own fix) correctly
      // surfaces it from THIS post-crash record, in a fresh process with no
      // memory of the crashed child -- proving durability alone is not
      // enough without also proving what "what needs me?" would actually
      // report after a restart.
      const status = fleetNeedsYouStatus([], {}, { [MISSION_ID]: afterCrash }, {})
      const surfaced = status.find((item) => item.id === marker.needsYouId)
      assert.ok(surfaced, 'the post-crash entry is discoverable through the real fleet aggregation')
      assert.equal(surfaced.source, 'RESEARCH')
      assert.equal(surfaced.question, marker.question)
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
