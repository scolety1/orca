// Real bulk pause/resume ("pause everything except X") -- split out of
// command-responder.test.mjs to keep that file under the repo's max-lines
// lint cap, mirroring command-quantified-run-action.mjs's own reason for
// being a separate production file.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-quantified-run-action-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const { respondCommand } = await import('../server/command-responder.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-13T12:00:00.000Z')

function project(id, displayName) {
  return {
    id,
    displayName,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      { id: `run-${projectId}`, projectId, originalGoal: 'x', acceptanceCriteria: ['X'] },
      clock
    )
  )
}

// A real, unrelated prior turn referenced `resolvedProjectIds` -- the
// quantifier in THIS turn's own message must win over it regardless.
function opStateWithLastTurn(resolvedProjectIds) {
  return {
    keepGoingRuns: {},
    chatThreads: {
      __command__: [
        {
          role: 'assistant',
          content: 'ok',
          at: clock().toISOString(),
          decisionClass: 'AUTO_DECIDE',
          intent: 'STATUS',
          resolvedProjectIds,
          scope: 'PROJECT'
        }
      ]
    }
  }
}

test('Stage 7: "pause everything" (no exclusions) really, durably pauses every real project with a run', async () => {
  const bulkProjects = [
    project('bulk-pause-a', 'BulkPauseA'),
    project('bulk-pause-b', 'BulkPauseB')
  ]
  await seedActiveRun('bulk-pause-a')
  await seedActiveRun('bulk-pause-b')
  const result = await respondCommand({
    message: 'pause everything',
    projects: bulkProjects,
    opState: { keepGoingRuns: {} },
    clock
  })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.match(result.text, /Paused/)
  assert.deepEqual(new Set(result.resolvedProjectIds), new Set(['bulk-pause-a', 'bulk-pause-b']))
  assert.equal(readKeepGoingRun('bulk-pause-a').state, 'PAUSED')
  assert.equal(readKeepGoingRun('bulk-pause-b').state, 'PAUSED')
})

// Formerly a disclosed gap (bulk pause fell through to a stale back-
// reference resolver, ignoring the quantifier/exclusion entirely) -- now a
// real, built capability (Stage 7's own required regression).
test('Stage 7: "pause everything except X" durably pauses every project EXCEPT the excluded one, even with a stale prior back-reference present', async () => {
  const bulkProjects = [
    project('bulk-pause-c', 'BulkPauseC'),
    project('bulk-pause-d', 'BulkPauseD')
  ]
  await seedActiveRun('bulk-pause-c')
  await seedActiveRun('bulk-pause-d')
  // opStateWithLastTurn references the SAME project this message excludes -- must never override the exclusion.
  const result = await respondCommand({
    message: 'pause everything except bulk-pause-d',
    projects: bulkProjects,
    opState: opStateWithLastTurn(['bulk-pause-d']),
    clock
  })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.deepEqual(result.resolvedProjectIds, ['bulk-pause-c'])
  assert.equal(readKeepGoingRun('bulk-pause-c').state, 'PAUSED')
  assert.equal(
    readKeepGoingRun('bulk-pause-d').state,
    'ACTIVE',
    'the excluded project must never be paused'
  )
  assert.doesNotMatch(
    result.text,
    /BulkPauseD[\s\S]*Paused/,
    'must never claim the excluded project was paused'
  )
})
