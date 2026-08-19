import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { invokeLivePlanner, buildProjectContextCapsule, providerLabel, fallbackLabel, modelDisplayName } from '../server/live-planner.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

function project(overrides = {}) {
  return {
    id: 'weird-talent-marketplace',
    displayName: 'Weird Talent Marketplace',
    purpose: 'Synthetic, local-only marketplace demonstration.',
    branch: 'codex/semantic-challenger-shootout-20260812',
    lifecycle: 'IDEA_INCUBATOR_LOCAL',
    mission: { id: 'mission-5-local-talent-card-loop', state: 'BLOCKED', blockedReason: 'Locally authored opaque Talent IDs cannot receive matcher concept scores.' },
    release: { stable: { head: 'ef0e232888b0fe1689ab7433e3f1333807d3b00d' }, testing: 'BLOCKED_ARCHITECTURAL_CONFLICT', adoption: 'NOT_READY_NOT_ADOPTED', published: 'UNCHANGED_NO_PUBLICATION_ACTION', upgrade: null },
    health: { status: 'DEGRADED', findings: [{ code: 'HUMAN_DECISION_PENDING', status: 'DEGRADED', summary: 'A consequential decision is waiting for Tim.', remediation: 'Present the exact current binding and options.' }] },
    candidate: { state: 'BLOCKED', decidable: false, residualRisks: 'Matcher admission unresolved.', implementationSummary: null },
    receipts: { chain: [] },
    evidence: { resultCapsules: [] },
    ...overrides
  }
}

function opState(overrides = {}) {
  return { usageMode: 'BALANCED', workSet: ['weird-talent-marketplace'], plannerSessions: {}, ...overrides }
}

async function withStubEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) prior[key] = process.env[key]
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) delete process.env[key]
      else process.env[key] = prior[key]
    }
  }
}

test('buildProjectContextCapsule stays bound to the given project and does not fabricate fields', () => {
  const capsule = buildProjectContextCapsule(project())
  assert.equal(capsule.project_id, 'weird-talent-marketplace')
  assert.match(capsule.active_blockers.join(' '), /opaque Talent IDs/)
  assert.deepEqual(capsule.hq_escalation_history, [])
  assert.deepEqual(capsule.do_not_repeat_lessons, [])
})

test('successful live planner response: real text, real observed session/model, correctly labeled', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'live-ok-session', STUB_MODEL: 'stub-model-x' }, async () => {
    const result = await invokeLivePlanner({ project: project(), message: 'what is going on with this project?', opState: opState(), recentHistory: [] })
    assert.equal(result.ok, true)
    assert.match(result.text, /^stub-answer-for::/)
    assert.equal(result.sessionId, 'live-ok-session')
    assert.equal(result.model, 'stub-model-x')
    assert.equal(result.agentId, 'claude-code')
    const label = providerLabel({ agentId: result.agentId, model: result.model })
    assert.equal(label, 'PLANNER_DEEP · Claude Code · stub-model-x')
    // Unknown model id is shown verbatim, never invented a friendlier name for it.
    assert.equal(modelDisplayName('stub-model-x'), 'stub-model-x')
  })
})

test('project context is actually transmitted to the provider process, bound to the selected project', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 's1', STUB_DEBUG_FILE: debugFile }, async () => {
      await invokeLivePlanner({ project: project({ id: 'unique-project-marker-9182' }), message: 'status?', opState: opState(), recentHistory: [] })
    })
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const systemPromptArg = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(systemPromptArg, /unique-project-marker-9182/)
    assert.match(systemPromptArg, /opaque Talent IDs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persistent/resumed planner session: second turn resumes the first turn session id', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'sticky-session-1' }, async () => {
    const state = opState()
    const first = await invokeLivePlanner({ project: project(), message: 'first turn', opState: state, recentHistory: [] })
    assert.equal(first.ok, true)
    assert.equal(first.freshSession, true)
    state.plannerSessions = { [project().id]: first.binding }
    const second = await invokeLivePlanner({ project: project(), message: 'second turn', opState: state, recentHistory: [{ role: 'user', content: 'first turn' }] })
    assert.equal(second.ok, true)
    assert.equal(second.sessionId, 'sticky-session-1')
    assert.equal(second.freshSession, false)
  })
})

// PLANNER_DEEP's fallbackProfile (CODEX_SAFE) is real role abstraction, not
// decorative — invokeLivePlanner genuinely tries it when the preferred agent
// fails. These failure-mode tests stub codex too (to a fast, deterministic
// non-existent binary) so a real codex CLI call never fires mid-test.
const NO_FALLBACK = { TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary') }

test('unavailable provider produces an honest fallback signal, not a fabricated answer', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'), ...NO_FALLBACK }, async () => {
    const result = await invokeLivePlanner({ project: project(), message: 'status?', opState: opState(), recentHistory: [] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SPAWN_ERROR')
    assert.match(fallbackLabel(result.reason), /^Planner unavailable — using recorded project-state fallback/)
  })
})

test('malformed provider response is treated as a failure, not parsed into a fake answer', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'malformed', ...NO_FALLBACK }, async () => {
    const result = await invokeLivePlanner({ project: project(), message: 'status?', opState: opState(), recentHistory: [] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'MALFORMED_RESPONSE')
  })
})

test('provider error response (is_error:true) is treated as a failure', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'provider-error', ...NO_FALLBACK }, async () => {
    const result = await invokeLivePlanner({ project: project(), message: 'status?', opState: opState(), recentHistory: [] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'PROVIDER_ERROR')
  })
})

test('provider timeout is treated as a failure within the configured budget, not a hang', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'timeout', TSF_PLANNER_TIMEOUT_MS: '200', ...NO_FALLBACK }, async () => {
    const started = Date.now()
    const result = await invokeLivePlanner({ project: project(), message: 'status?', opState: opState(), recentHistory: [] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'TIMEOUT')
    assert.ok(Date.now() - started < 4000, 'must not wait for the full 5s stub sleep')
  })
})

test('a rejected/stale resumed session falls back to a fresh session rather than failing the turn', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'fresh-after-stale' }, async () => {
    const state = opState({ plannerSessions: { [project().id]: { role: 'PLANNER_DEEP', scope: 'PLANNING_EPISODE', providerId: 'anthropic', agentId: 'claude-code', orcaSessionId: 'tsf-planner-chat:weird-talent-marketplace', providerConversationId: 'a-stale-unknown-id' } } })
    const result = await invokeLivePlanner({ project: project(), message: 'status?', opState: state, recentHistory: [] })
    assert.equal(result.ok, true)
    assert.equal(result.freshSession, true)
    assert.equal(result.sessionId, 'fresh-after-stale')
  })
})

test('long chat message is transmitted without crashing the invocation', async () => {
  await withStubEnv({ TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'long-msg' }, async () => {
    const longMessage = 'why is this blocked? '.repeat(180) // ~3960 chars, under the 4000-char cap
    const result = await invokeLivePlanner({ project: project(), message: longMessage, opState: opState(), recentHistory: [] })
    assert.equal(result.ok, true)
    assert.match(result.text, /^stub-answer-for::/)
  })
})

test('project switch does not leak prior project context into the new project capsule', () => {
  const a = buildProjectContextCapsule(project({ id: 'project-a', purpose: 'PROJECT_A_ONLY_MARKER' }))
  const b = buildProjectContextCapsule(project({ id: 'project-b', purpose: 'PROJECT_B_ONLY_MARKER', mission: { id: null, state: 'ACTIVE', blockedReason: null }, health: { status: 'HEALTHY', findings: [] } }))
  assert.doesNotMatch(JSON.stringify(b), /PROJECT_A_ONLY_MARKER/)
  assert.doesNotMatch(JSON.stringify(a), /PROJECT_B_ONLY_MARKER/)
})
