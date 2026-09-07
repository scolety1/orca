// Finding F6 (Autonomous Reliability Hardening Overnight V1, Phase 1):
// every prior "ResearchMission restart" test was same-process/in-memory
// re-invocation -- never a real killed OS process + real durable-state
// recovery. This is the real end-to-end proof, mirroring Finding F4's
// planner-mission-lease-crash-reclaim.test.mjs spawn-and-SIGKILL template
// (itself reused from resource-pressure-lease-host-wide.test.mjs).
//
// HONEST DIVERGENCE FROM THE F4 TEMPLATE (read research-mission-store.mjs
// and research-mission.mjs in full before writing this): ResearchMission
// has NO lease/holder/TTL/ownership concept at all, unlike Planner Context
// Lifecycle's PlannerSessionLifecycle+planner-mission-lease.mjs.
// research-mission-store.mjs's withResearchMission is a bare compare-and-
// swap over a cross-process file lock (cross-process-file-lock.mjs) keyed
// only by missionId -- there is no "holder" identity, no acquire/refuse
// step, and nothing for a successor to be denied by. So this test proves
// the REAL model that actually exists: state is durably written to disk
// BEFORE the crash, and a fresh reader in a genuinely separate process
// picks it up cleanly with zero resume ceremony -- not a fabricated
// lease-reclaim test grafted onto a system that has no lease. The
// "no lease" claim itself is proven below (readResearchMission succeeds
// with no denial/lock-out WHILE the child is still alive), not merely
// asserted from reading the source.
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FIELD_NAME, PERIOD_SCOPE } from './fixtures/generic-research-crash-fixture.mjs'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'research-mission-crash-dispatch-worker.mjs')
const MISSION_ID = 'mission:crash-survival-fixture'
const NODE_ID = 'node:crash-survival-fixture'
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
  'REAL process crash mid-mission: a durably-dispatched node survives a real SIGKILL, then the mission is driven to a real terminal state by a fresh process',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-research-mission-crash-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'dispatched.json')
    // Set BEFORE the in-process dynamic import below -- data-store.mjs
    // captures TSF_UI_STATE_FILE into a module-level const at import time.
    process.env.TSF_UI_STATE_FILE = stateFile
    const { readResearchMission } = await import('../server/research-mission-store.mjs')
    const { advanceOneMission } = await import('../server/research-mission-fleet-driver.mjs')

    const child = spawn(process.execPath, [WORKER, MISSION_ID, NODE_ID, stateFile, resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    // Registered immediately (not after the later kill) so a real exit is
    // never missed by a listener attached too late -- Node's ChildProcess
    // only ever fires 'exit' once, at actual exit time.
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      // Confirms the child genuinely got past a real dispatch (durable on
      // disk) before anything else happens -- not merely spawned.
      await waitFor(() => {
        try {
          return JSON.parse(readFileSync(resultPath, 'utf8')).dispatched === true
        } catch {
          return false
        }
      })
      const marker = JSON.parse(readFileSync(resultPath, 'utf8'))

      // WHILE THE CHILD IS STILL ALIVE: a fresh reader in this (separate)
      // process already sees the real dispatched state, with no denial and
      // no ceremony -- the concrete proof that ResearchMission has no
      // lease/ownership concept the way Planner Context Lifecycle does.
      // Contrast with F4's test, which asserts a genuine TSF_PLANNER_LEASE_DENIED
      // here -- there is no analogous refusal possible for a research
      // mission at all.
      const liveMission = readResearchMission(MISSION_ID)
      const liveNode = liveMission.nodes.find((n) => n.id === NODE_ID)
      assert.equal(liveNode.status, 'DISPATCHED')
      assert.equal(liveNode.dispatchRecords.length, 1)
      assert.equal(liveNode.dispatchRecords[0].taskFingerprint, marker.taskFingerprint)

      // Kill -9 -- no relinquish, no graceful shutdown, no result admitted:
      // exactly a real crash (cross-platform: Node maps SIGKILL to
      // TerminateProcess on Windows).
      child.kill('SIGKILL')
      await exited

      // POST-CRASH: a genuinely separate read (no shared in-memory state
      // with the crashed child) proves the dispatched node's state
      // survived intact -- not lost, not duplicated.
      const afterCrash = readResearchMission(MISSION_ID)
      const nodeAfterCrash = afterCrash.nodes.find((n) => n.id === NODE_ID)
      assert.equal(nodeAfterCrash.status, 'DISPATCHED')
      assert.equal(nodeAfterCrash.dispatchRecords.length, 1, 'must not be lost or duplicated by the crash')
      assert.deepEqual(nodeAfterCrash.dispatchRecords[0].workerRunRef, marker.workerRunRef)
      assert.equal(afterCrash.revision, liveMission.revision, 'no phantom mutation happened after the crash')

      // CONTINUE: a fresh fixture worker standing in for a real remote
      // provider -- fetchResult is scripted purely from the durably-known
      // workerRunRef/taskFingerprint (not from any in-memory run-tracking
      // populated at dispatch time), because that in-memory correlation
      // died with the child. A real remote provider (Exa/Parallel) is
      // queryable this same way -- by a durable run reference, from any
      // process -- so this models that correctly rather than papering over
      // it. dispatch() must never be called again: the durable dispatch
      // already recorded above must be the only one.
      const resumeWorker = {
        dispatch: async () => { throw new Error('must not redispatch an already-dispatched node') },
        fetchResult: async (workerRunRef) => {
          assert.equal(workerRunRef.providerRunId, marker.workerRunRef.providerRunId)
          return {
            ok: true,
            status: 'READY',
            result: {
              schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
              nodeId: NODE_ID,
              taskFingerprint: marker.taskFingerprint,
              provider: 'FAKE',
              providerRunRef: workerRunRef,
              status: 'SUCCEEDED',
              observations: [{ rawContent: 'fixture observation', extractedAt: clock().toISOString(), providerConfidence: 0.9, providerReasoning: 'fixture' }],
              proposedClaims: [{ fieldName: FIELD_NAME, proposedValue: 'fixture-value', temporalScope: PERIOD_SCOPE, providerConfidence: 0.9, providerReasoning: 'fixture' }],
              evidence: [{ claimFieldName: FIELD_NAME, sourceRef: 'src:fixture-1', snippet: 'fixture snippet', supportsClaim: true }],
              sourceReferences: [{ sourceRef: 'src:fixture-1', url: 'https://example.invalid/fixture', publisher: 'fixture-publisher', retrievedAt: clock().toISOString() }],
              sourceSnapshotsOrSnapshotRefs: [{ sourceRef: 'src:fixture-1', contentHash: 'sha256:fixture', rawContentRef: 'fixture://value' }],
              newGapProposals: [],
              warnings: [],
              unresolvedQuestions: [],
              usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 },
              failureDetails: null
            }
          }
        }
      }

      // Drive via the REAL production autonomy driver (research-mission-
      // fleet-driver.mjs's advanceOneMission), never hand-inlined domain
      // calls -- bounded loop, same discipline as this repo's other
      // crash/resume tests. Expected real sequence for this fixture:
      // POLL (admits the result) -> VERIFY_AND_RECONCILE_FIELD
      // (canonicalizes the single verified claim) -> CHECK_COMPLETE
      // (mission reaches COMPLETE). POLL/VERIFY/CHECK_COMPLETE are never
      // gated by the Resource Pressure Governor (only DISPATCH/RETRY_DISPATCH
      // are, per research-mission-fleet-driver.mjs's own comment), so no
      // forced-HEALTHY memory override is needed here.
      const actionsSeen = []
      let finalResult = null
      for (let tick = 0; tick < 6; tick += 1) {
        const result = await advanceOneMission(MISSION_ID, clock, { worker: resumeWorker }) // eslint-disable-line no-await-in-loop
        actionsSeen.push(result.action)
        if (result.action === 'COMPLETED') {
          finalResult = result
          break
        }
      }
      assert.ok(finalResult, `mission never reached COMPLETED within the tick budget; actions seen: ${actionsSeen.join(', ')}`)
      assert.deepEqual(actionsSeen, ['POLLED', 'VERIFIED_AND_RECONCILED', 'COMPLETED'])

      const finalMission = readResearchMission(MISSION_ID)
      assert.equal(finalMission.state, 'COMPLETE')
      const finalNode = finalMission.nodes.find((n) => n.id === NODE_ID)
      assert.equal(finalNode.dispatchRecords.length, 1, 'the pre-crash dispatch must still be the only one')
      assert.equal(finalNode.rawResults.length, 1, 'the post-crash poll must not duplicate result admission')
      assert.equal(finalNode.canonicalFacts.length, 1)
      assert.equal(finalNode.canonicalFacts[0].value, 'fixture-value')
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
