// TSF UI FINDINGS #2-#16 CLOSURE, Gate 3B: real, live-observed divergence
// this closure pass caught -- Command's "What needs me?" answered "nothing
// needs you" while HQ's own tile read 2 for the SAME real fleet state (a
// run-less READY_FOR_ADOPTION candidate and a legacy-BLOCKED mission
// state, neither of which buildFleetAttentionItems' own NEEDS_OWNER
// category ever included -- see command-global-scope-bridge.mjs's own
// legacyNeedsYouGapItems header for the full trace).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { createProjectExecutionHold } from '../domain/project-execution-hold.mjs'

const NONEXISTENT = path.join(import.meta.dirname, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
const STATE_FILE = path.join(
  import.meta.dirname,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-global-scope-bridge-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)
const { respondCommand } = await import('../server/command-responder.mjs')

const clock = () => new Date('2026-08-25T00:00:00.000Z')
const opState = { keepGoingRuns: {} }

function project(id, displayName, overrides = {}) {
  return {
    id,
    displayName,
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] },
    ...overrides
  }
}

test('NEEDS_YOU_QUERY: a run-less READY_FOR_ADOPTION candidate and a legacy-BLOCKED project are both discoverable via "what needs me?", matching HQ\'s own needsYouCards', async () => {
  const readyProject = project('ready-candidate', 'Ready', {
    candidate: { state: 'READY_FOR_ADOPTION' }
  })
  const blockedProject = project('blocked-project', 'Blocked', {
    mission: { state: 'BLOCKED_TIM_REQUIRED', id: null, blockedReason: 'needs a real decision' }
  })
  const result = await respondCommand({
    message: 'what needs me?',
    projects: [readyProject, blockedProject],
    opState,
    clock
  })
  assert.match(result.text, /Ready/)
  assert.match(result.text, /Blocked/)
  assert.match(result.text, /needs a real decision/)
  assert.deepEqual([...result.resolvedProjectIds].sort(), ['blocked-project', 'ready-candidate'])
})

// A run-based real needsYou question must not be double-counted alongside
// its own legacy-* item -- legacyNeedsYouGapItems is scoped to exactly the
// legacy-candidate:/legacy-blocked: id prefixes, never run:-sourced items.
test('NEEDS_YOU_QUERY: a project with a real, run-sourced needsYou question is counted exactly once, not twice', async () => {
  const withRun = {
    keepGoingRuns: {
      'has-run': {
        needsYou: [{ id: 'q1', question: 'A real decision is pending', resolvedAt: null }],
        checkpoints: [],
        waves: []
      }
    }
  }
  const result = await respondCommand({
    message: 'what needs me?',
    projects: [project('has-run', 'Has Run')],
    opState: withRun,
    clock
  })
  const matches = result.text.match(/Has Run/g) ?? []
  assert.equal(matches.length, 1, `expected exactly one mention, got ${matches.length}`)
})

// Real Codex adversarial-review finding, independently reproduced: a
// project can genuinely be BOTH run-based (with a real, open needsYou
// question) AND legacy-BLOCKED at the same time (owner-work-model.mjs's
// own "BUG-14" comment: "legacy BLOCKED is independent of run existence").
// Without the existingProjectIds exclusion, this project would appear
// TWICE in Command's own answer -- once via buildFleetAttentionItems' own
// needsYouItems, once via legacyNeedsYouGapItems' legacy-blocked: entry.
test('NEEDS_YOU_QUERY: a project that is BOTH run-based-needsYou AND legacy-BLOCKED is counted exactly once', async () => {
  const opStateWithBoth = {
    keepGoingRuns: {
      'both-conditions': {
        needsYou: [{ id: 'q1', question: 'A real decision is pending', resolvedAt: null }],
        checkpoints: [],
        waves: []
      }
    }
  }
  const bothProject = project('both-conditions', 'Both Conditions', {
    mission: { state: 'BLOCKED_TIM_REQUIRED', id: null, blockedReason: 'also legacy-blocked' }
  })
  const result = await respondCommand({
    message: 'what needs me?',
    projects: [bothProject],
    opState: opStateWithBoth,
    clock
  })
  const matches = result.text.match(/Both Conditions/g) ?? []
  assert.equal(matches.length, 1, `expected exactly one mention, got ${matches.length}`)
})

test('NEEDS_YOU_QUERY: a BLOCKED_EXTERNAL execution hold is informational, not something the owner must answer', async () => {
  const heldProject = project('held-project', 'Held Project')
  const hold = createProjectExecutionHold(
    { projectId: 'held-project', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'tim' },
    clock
  )
  const result = await respondCommand({
    message: 'what needs me?',
    projects: [heldProject],
    opState: { ...opState, projectExecutionHolds: { 'held-project': hold } },
    clock
  })
  assert.match(result.text, /Nothing needs you right now/)
  assert.doesNotMatch(result.text, /Held Project/)
  assert.deepEqual(result.resolvedProjectIds, [])
  assert.deepEqual(result.resultItems, [])
})
