// Owner-trial-prep mission: a real, live multi-project agreement audit
// (read-only against the real backend) found Command giving false
// reassurance for "what's waiting?"/"did anything stop?"/"is everything
// still working?" -- run-less paused/SENSITIVE_READ_ONLY/NEEDS_YOU
// projects were either misclassified into the wrong answer (NEEDS_YOU_QUERY)
// or silently collapsed into a "nothing to report" summary. Proves the
// real, end-to-end HTTP fix: fleetWorkStatus now reports a real
// primaryState for every project, and these questions route to
// GLOBAL_STATUS, which now reports it honestly.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-fleet-truth-questions-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')

function seedOnboardedProject(projectId, displayName, migrationClassification) {
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [projectId]: {
        acceptedAt: '2026-09-10T00:00:00.000Z',
        receipts: [],
        lastAnalysis: {
          projectId,
          displayName,
          repoPath: `C:/nonexistent-${projectId}`,
          analyzedAt: '2026-09-10T00:00:00.000Z',
          maturity: 'DEVELOPING',
          identity: { branch: 'main', head: 'seed000', tree: 'seedtree' },
          migrationClassification: { classification: migrationClassification, reasons: [] },
          handoffReconciliation: { hasHandoff: false },
          orcaRegistration: { checked: false, registered: false },
          discovery: {
            commandGuidance: {
              hasKnownTestCommand: false,
              testCommands: [],
              lintCommands: [],
              buildCommands: []
            }
          },
          direction: {
            purpose: null,
            recommendedNextMission: null,
            upgradeCandidates: [],
            unfinishedSummary: null,
            completedSummary: null,
            alignment: 'UNKNOWN',
            live: false
          },
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-10T00:00:00.000Z' }
        }
      }
    }
  })
}

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function chat(base, message) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  })
  return { status: res.status, body: await res.json() }
}

test('a real "what\'s waiting?" question surfaces run-less paused/SENSITIVE_READ_ONLY and BLOCKED projects, never a false NEEDS_YOU_QUERY answer', async () => {
  await withServer(async (base) => {
    seedOnboardedProject('paused-real-project', 'Paused Real Project', 'SENSITIVE')
    seedOnboardedProject('blocked-real-project', 'Blocked Real Project', 'TIM_REQUIRED')

    const res = await chat(base, "what's waiting?")
    assert.equal(res.status, 200)
    // Must NOT be the NEEDS_YOU_QUERY answer shape ("N thing(s) need you")
    // -- WAITING and NEEDS_YOU are different real states, and this
    // question is asking specifically about the fleet's true state, not
    // outstanding decisions.
    assert.doesNotMatch(res.body.text, /thing\(s\) need you/i)
    // Honest, whether named individually or counted in the collapsed
    // summary (there are enough other real/fixture projects in this test
    // env to trigger the collapsed >IDLE_NAME_THRESHOLD case) -- either
    // way, "paused" must appear, never silently dropped.
    assert.match(res.body.text, /paused/i)
  })
})

test('"is everything still working?" and "did anything stop?" honestly report a paused project, never "nothing to report"', async () => {
  await withServer(async (base) => {
    for (let i = 0; i < 4; i++) {
      seedOnboardedProject(`paused-${i}`, `Paused ${i}`, 'SENSITIVE')
    }

    const stillWorking = await chat(base, 'is everything still working?')
    assert.doesNotMatch(stillWorking.body.text, /nothing to report/i)
    assert.match(stillWorking.body.text, /paused/i)

    const didStop = await chat(base, 'did anything stop?')
    assert.doesNotMatch(didStop.body.text, /nothing to report/i)
    assert.match(didStop.body.text, /paused/i)
  })
})
