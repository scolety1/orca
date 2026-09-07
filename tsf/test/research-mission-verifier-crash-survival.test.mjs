// Phase 12 (Durable State / Restart Gauntlet, category 7 -- Verifier
// result). Reconciliation: F24's own test proves a Planner VERIFIER result
// (recordVerifierResult) is safe against a rollover race, but that is a
// simulated in-process timing window, not a real killed process. F6's own
// ResearchMission crash test crashes strictly BEFORE any verification runs.
// No existing test proves a ResearchMission's own verifier result --
// admitReconciliationDecision's CanonicalFact, the one function in this
// codebase that may construct one -- survives a real SIGKILL. Mirrors F6's
// own research-mission-process-crash-survival.test.mjs template exactly
// (REUSE_PATTERN, same spawn/SIGKILL mechanics, same generic fixture).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'research-mission-verifier-crash-worker.mjs')
const MISSION_ID = 'mission:verifier-crash-survival-fixture'
const NODE_ID = 'node:verifier-crash-survival-fixture'
const clock = () => new Date('2026-09-07T12:00:00.000Z')

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'REAL process crash after a verifier result (CanonicalFact) is recorded: it survives a real SIGKILL, and the mission still reaches a real terminal state from a fresh process',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-research-verifier-crash-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'verified.json')
    process.env.TSF_UI_STATE_FILE = stateFile
    const { readResearchMission } = await import('../server/research-mission-store.mjs')
    const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

    const child = spawn(process.execPath, [WORKER, MISSION_ID, NODE_ID, stateFile, resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await waitFor(() => {
        try {
          return JSON.parse(readFileSync(resultPath, 'utf8')).verified === true
        } catch {
          return false
        }
      })
      const marker = JSON.parse(readFileSync(resultPath, 'utf8'))

      // WHILE THE CHILD IS STILL ALIVE: a fresh reader already sees the
      // real, admitted CanonicalFact.
      const live = readResearchMission(MISSION_ID)
      const liveNode = live.nodes.find((n) => n.id === NODE_ID)
      const liveFact = liveNode.canonicalFacts.find((f) => f.id === marker.canonicalFactId)
      assert.ok(liveFact, 'the verifier result is visible before the crash')
      assert.equal(liveFact.value, marker.value)

      child.kill('SIGKILL')
      await exited

      // POST-CRASH: a genuinely separate read proves the verifier result
      // itself -- not just the dispatched node -- survived intact.
      const afterCrash = readResearchMission(MISSION_ID)
      const nodeAfterCrash = afterCrash.nodes.find((n) => n.id === NODE_ID)
      assert.equal(nodeAfterCrash.canonicalFacts.length, 1, 'must not be lost or duplicated by the crash')
      const factAfterCrash = nodeAfterCrash.canonicalFacts[0]
      assert.equal(factAfterCrash.id, marker.canonicalFactId)
      assert.equal(factAfterCrash.value, marker.value)
      assert.equal(afterCrash.revision, live.revision, 'no phantom mutation happened after the crash')

      // CONTINUE: the real production driver, from a fresh process, reaches
      // CHECK_COMPLETE against the already-canonicalized fact -- proving
      // the verifier result is not just present but genuinely USABLE by the
      // real completion path after a restart, never re-verified.
      const resumeWorker = {
        dispatch: async () => { throw new Error('must not redispatch an already-admitted node') },
        fetchResult: async () => { throw new Error('must not re-poll an already-admitted node') }
      }
      const result = await advanceOneMission(MISSION_ID, clock, { worker: resumeWorker })
      assert.equal(result.action, 'COMPLETED')

      const finalMission = readResearchMission(MISSION_ID)
      assert.equal(finalMission.state, 'COMPLETE')
      const finalNode = finalMission.nodes.find((n) => n.id === NODE_ID)
      assert.equal(finalNode.canonicalFacts.length, 1, 'the pre-crash verifier result must still be the only one')
      assert.equal(finalNode.canonicalFacts[0].value, marker.value)
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
