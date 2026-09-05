import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  invokeLivePlanner,
  invokeLiveStructuredAnalysis,
  buildProjectContextCapsule,
  providerLabel,
  fallbackLabel,
  modelDisplayName,
  stripSchemaMetaKeys
} from '../server/live-planner.mjs'
import {
  emptyProjectMemory,
  addMemoryRecord,
  supersedeMemoryRecord
} from '../domain/project-memory.mjs'
import { createOvernightRun } from '../domain/keep-going.mjs'

const HERE = import.meta.dirname
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

function project(overrides = {}) {
  return {
    id: 'weird-talent-marketplace',
    displayName: 'Weird Talent Marketplace',
    purpose: 'Synthetic, local-only marketplace demonstration.',
    branch: 'codex/semantic-challenger-shootout-20260812',
    lifecycle: 'IDEA_INCUBATOR_LOCAL',
    mission: {
      id: 'mission-5-local-talent-card-loop',
      state: 'BLOCKED',
      blockedReason: 'Locally authored opaque Talent IDs cannot receive matcher concept scores.'
    },
    release: {
      stable: { head: 'ef0e232888b0fe1689ab7433e3f1333807d3b00d' },
      testing: 'BLOCKED_ARCHITECTURAL_CONFLICT',
      adoption: 'NOT_READY_NOT_ADOPTED',
      published: 'UNCHANGED_NO_PUBLICATION_ACTION',
      upgrade: null
    },
    health: {
      status: 'DEGRADED',
      findings: [
        {
          code: 'HUMAN_DECISION_PENDING',
          status: 'DEGRADED',
          summary: 'A consequential decision is waiting for Tim.',
          remediation: 'Present the exact current binding and options.'
        }
      ]
    },
    candidate: {
      state: 'BLOCKED',
      decidable: false,
      residualRisks: 'Matcher admission unresolved.',
      implementationSummary: null
    },
    receipts: { chain: [] },
    evidence: { resultCapsules: [] },
    ...overrides
  }
}

function opState(overrides = {}) {
  return {
    usageMode: 'BALANCED',
    workSet: ['weird-talent-marketplace'],
    plannerSessions: {},
    ...overrides
  }
}

async function withStubEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
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

// BUG-13 (bug-ledger.json): no run supplied -> honestly null, never
// fabricated -- and unchanged behavior for every existing caller
// (planner-eval-runner.mjs) that never passes this 3rd argument at all.
test('buildProjectContextCapsule: no live run status supplied -> live_run_status is null', () => {
  assert.equal(buildProjectContextCapsule(project()).live_run_status, null)
})

test('buildProjectContextCapsule: a live run status string reaches the capsule verbatim', () => {
  const capsule = buildProjectContextCapsule(
    project(),
    emptyProjectMemory(),
    'Keep Going run run-1 is STALLED: run state is STALLED.'
  )
  assert.equal(capsule.live_run_status, 'Keep Going run run-1 is STALLED: run state is STALLED.')
})

test('buildProjectContextCapsule fills do_not_repeat_lessons from real project memory, bounded, when given one', () => {
  const clock = () => new Date()
  let memory = emptyProjectMemory()
  memory = addMemoryRecord(
    memory,
    {
      class: 'EXPERIENCE',
      statement: 'do not retry the flaky upload endpoint without backoff',
      source: { kind: 'RESULT_CAPSULE', ref: 'mission-1' }
    },
    clock
  )
  const capsule = buildProjectContextCapsule(project(), memory)
  assert.deepEqual(capsule.do_not_repeat_lessons, [
    'do not retry the flaky upload endpoint without backoff'
  ])
})

test('buildProjectContextCapsule never returns a superseded lesson', () => {
  const clock = () => new Date()
  let memory = emptyProjectMemory()
  memory = addMemoryRecord(
    memory,
    { class: 'EXPERIENCE', statement: 'stale lesson', source: { kind: 'CHAT', ref: 'msg-1' } },
    clock
  )
  const staleId = memory.records[0].id
  memory = supersedeMemoryRecord(
    memory,
    staleId,
    { statement: 'corrected lesson', source: { kind: 'CHAT', ref: 'msg-2' } },
    undefined,
    clock
  )
  const capsule = buildProjectContextCapsule(project(), memory)
  assert.deepEqual(capsule.do_not_repeat_lessons, ['corrected lesson'])
})

test('successful live planner response: real text, real observed session/model, correctly labeled', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      STUB_MODE: 'success',
      STUB_SESSION_ID: 'live-ok-session',
      STUB_MODEL: 'stub-model-x'
    },
    async () => {
      const result = await invokeLivePlanner({
        project: project(),
        message: 'what is going on with this project?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, true)
      assert.match(result.text, /^stub-answer-for::/)
      assert.equal(result.sessionId, 'live-ok-session')
      assert.equal(result.model, 'stub-model-x')
      assert.equal(result.agentId, 'claude-code')
      const label = providerLabel({ agentId: result.agentId, model: result.model })
      assert.equal(label, 'PLANNER_DEEP · Claude Code · stub-model-x')
      // Unknown model id is shown verbatim, never invented a friendlier name for it.
      assert.equal(modelDisplayName('stub-model-x'), 'stub-model-x')
    }
  )
})

test('project context is actually transmitted to the provider process, bound to the selected project', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: STUB,
        STUB_MODE: 'success',
        STUB_SESSION_ID: 's1',
        STUB_DEBUG_FILE: debugFile
      },
      async () => {
        await invokeLivePlanner({
          project: project({ id: 'unique-project-marker-9182' }),
          message: 'status?',
          opState: opState(),
          recentHistory: []
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const systemPromptArg = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(systemPromptArg, /unique-project-marker-9182/)
    assert.match(systemPromptArg, /opaque Talent IDs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Hands-on pilot round 3, Bug 5: real conversation showed Command falsely
// asserting continuity ("Same answer as a second ago", "Third time asking
// the exact same thing") about a project it had NEVER discussed in that
// project's own history -- with recentHistory genuinely empty each time.
// This is a model-behavior bug, not deterministic code -- the actual fix
// is the explicit system-prompt instruction added below; a stub CLI
// cannot verify what a real model would then choose to say. What CAN be
// deterministically proven, and is the real, previously-missing guardrail:
// (1) the instruction against fabricating continuity is actually present
// in every transmitted prompt, and (2) history is genuinely scoped
// per-project -- an empty history says so explicitly, and a DIFFERENT
// project's own history never leaks into this one's prompt. Real,
// end-to-end model-behavior verification happened separately, against the
// live pilot server with the real configured provider (see the round 3
// report's dogfood transcript).
test('Bug 5 guardrail: the system prompt explicitly forbids fabricated conversational continuity, and history is honestly scoped per project', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-continuity-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 's1', STUB_DEBUG_FILE: debugFile },
      async () => {
        await invokeLivePlanner({
          project: project({ id: 'nwr-fixture' }),
          message: 'what is nwr doing right now',
          opState: opState(),
          recentHistory: [] // genuinely no prior turns for THIS project
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const prompt = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(prompt, /never assert conversational continuity you cannot see/i)
    assert.match(prompt, /same as a second ago/i, 'the exact real-pilot phrasing must be named as an example to avoid')
    assert.match(prompt, /\(no prior turns in this session\)/, 'an honestly empty history must say so explicitly, not omit the block')
    assert.doesNotMatch(prompt, /nytheria/i, "a different project's own conversation must never leak into this project's prompt")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('UX polish guardrail: the system prompt instructs leading with state/blockers/whether Tim needs to care, not a low-value audit dump', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-ux-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 's1', STUB_DEBUG_FILE: debugFile },
      async () => {
        await invokeLivePlanner({
          project: project({ id: 'nytheria-fixture' }),
          message: 'how is nytheria doing',
          opState: opState(),
          recentHistory: []
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const prompt = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(prompt, /lead with: current state, any active work, any real blockers/i)
    assert.match(prompt, /do not open with a low-value audit dump/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// BUG-13 real reproduction + fix proof: before this fix, a real, currently
// STALLED Keep Going run for this exact project never reached the live
// conversational planner's transmitted context at all (buildProjectContextCapsule
// had no run/gap-derived field, and invokeLivePlanner never computed one) --
// asking anything other than the 3 narrow deterministic STATUS/NEXT_ACTION/
// FINISHED phrasings got an answer grounded only in the stale legacy
// mission/candidate model, blind to the real run. This proves the fix end to
// end through the real invokeLivePlanner wiring, not just the pure capsule
// builder in isolation.
test('BUG-13: a real Keep Going run for this project reaches the live planner system prompt, not just the 3 narrow deterministic intents', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-liverun-'))
  const debugFile = path.join(dir, 'argv.json')
  const projectId = 'unique-project-marker-liverun-1'
  const clock = () => new Date('2026-09-03T00:00:00.000Z')
  let run = createOvernightRun(
    { id: 'run-liverun-1', projectId, originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
  try {
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: STUB,
        STUB_MODE: 'success',
        STUB_SESSION_ID: 's1',
        STUB_DEBUG_FILE: debugFile
      },
      async () => {
        await invokeLivePlanner({
          project: project({ id: projectId }),
          // Deliberately NOT "what is it doing?"/"status"/etc -- an
          // ordinary question that classifies outside the 3 narrow
          // deterministic intents chat-responder.mjs already grounds, so
          // this exercises the live-planner capsule path specifically.
          message: 'why does this project matter?',
          opState: opState({ keepGoingRuns: { [projectId]: run } }),
          recentHistory: []
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const systemPromptArg = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(systemPromptArg, /Keep Going run run-liverun-1 is PLANNING/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Real V1 stabilization finding: the planner subprocess's cwd was nested
// inside THIS repo (tsf/server/.local-state/planner-cwd), so a real `claude
// -p` call there walked up, found this repo's own CLAUDE.md/AGENTS.md, and
// leaked them into onboarding direction-analysis narratives -- reproduced
// live against two real repos (both misidentified the analyzed project as
// "TSF Autonomy Program v1"). The neutral cwd now lives outside any git
// repo's instruction walk-up entirely (under the OS temp dir); this proves
// the actual `cwd` the subprocess is spawned with is never this repo.
test('the planner subprocess cwd is never inside this repo (regression: instruction leak via nested neutral cwd)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-cwd-check-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_DEBUG_FILE: debugFile },
      async () => {
        await invokeLivePlanner({
          project: project(),
          message: 'status?',
          opState: opState(),
          recentHistory: []
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const repoRoot = path.resolve(HERE, '..', '..')
    assert.ok(
      !path.resolve(seen.cwd).startsWith(repoRoot + path.sep),
      `planner subprocess cwd (${seen.cwd}) must not be inside this repo (${repoRoot})`
    )
    assert.ok(
      path.resolve(seen.cwd).startsWith(path.resolve(tmpdir())),
      `planner subprocess cwd (${seen.cwd}) must be rooted under the OS temp dir`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// REQUIRED PROOF (M7): real project memory genuinely reaches the real
// planner chat call end to end -- not just buildProjectContextCapsule
// called directly (every other test above/below does that), but through
// invokeLivePlanner's own opState.projectMemory?.[project.id] wiring
// (live-planner.mjs's one M7 call-site change), transmitted to the real
// provider subprocess's actual argv. This is the one gap a final
// milestone review found: opState.projectMemory was never populated by
// any prior test, so this exact wiring line had never been exercised.
test('REQUIRED PROOF: real project memory (a real EXPERIENCE lesson) reaches the actual transmitted system prompt via invokeLivePlanner', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-memory-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    let memory = emptyProjectMemory()
    memory = addMemoryRecord(
      memory,
      {
        class: 'EXPERIENCE',
        statement: 'Rejected: do not retry the flaky upload endpoint without exponential backoff',
        source: { kind: 'RESULT_CAPSULE', ref: 'mission-42' }
      },
      () => new Date()
    )
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: STUB,
        STUB_MODE: 'success',
        STUB_SESSION_ID: 's-memory',
        STUB_DEBUG_FILE: debugFile
      },
      async () => {
        await invokeLivePlanner({
          project: project(),
          message: 'what should I watch out for?',
          opState: opState({ projectMemory: { 'weird-talent-marketplace': memory } }),
          recentHistory: []
        })
      }
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    const systemPromptArg = seen.args[seen.args.indexOf('--system-prompt') + 1]
    assert.match(
      systemPromptArg,
      /Rejected: do not retry the flaky upload endpoint without exponential backoff/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persistent/resumed planner session: second turn resumes the first turn session id', async () => {
  await withStubEnv(
    { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'sticky-session-1' },
    async () => {
      const state = opState()
      const first = await invokeLivePlanner({
        project: project(),
        message: 'first turn',
        opState: state,
        recentHistory: []
      })
      assert.equal(first.ok, true)
      assert.equal(first.freshSession, true)
      state.plannerSessions = { [project().id]: first.binding }
      const second = await invokeLivePlanner({
        project: project(),
        message: 'second turn',
        opState: state,
        recentHistory: [{ role: 'user', content: 'first turn' }]
      })
      assert.equal(second.ok, true)
      assert.equal(second.sessionId, 'sticky-session-1')
      assert.equal(second.freshSession, false)
    }
  )
})

// PLANNER_DEEP's fallbackProfile (CODEX_SAFE) is real role abstraction, not
// decorative — invokeLivePlanner genuinely tries it when the preferred agent
// fails. These failure-mode tests stub codex too (to a fast, deterministic
// non-existent binary) so a real codex CLI call never fires mid-test.
const NO_FALLBACK = {
  TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary')
}

test('unavailable provider produces an honest fallback signal, not a fabricated answer', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
      ...NO_FALLBACK
    },
    async () => {
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'SPAWN_ERROR')
      assert.match(
        fallbackLabel(result.reason),
        /^Planner unavailable — using recorded project-state fallback/
      )
    }
  )
})

test('malformed provider response is treated as a failure, not parsed into a fake answer', async () => {
  await withStubEnv(
    { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'malformed', ...NO_FALLBACK },
    async () => {
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'MALFORMED_RESPONSE')
    }
  )
})

test('provider error response (is_error:true) is treated as a failure', async () => {
  await withStubEnv(
    { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'provider-error', ...NO_FALLBACK },
    async () => {
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'PROVIDER_ERROR')
    }
  )
})

test('provider timeout is treated as a failure within the configured budget, not a hang', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      STUB_MODE: 'timeout',
      TSF_PLANNER_TIMEOUT_MS: '200',
      ...NO_FALLBACK
    },
    async () => {
      const started = Date.now()
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'TIMEOUT')
      assert.ok(Date.now() - started < 4000, 'must not wait for the full 5s stub sleep')
    }
  )
})

test('a rejected/stale resumed session falls back to a fresh session rather than failing the turn', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      STUB_MODE: 'success',
      STUB_SESSION_ID: 'fresh-after-stale'
    },
    async () => {
      const state = opState({
        plannerSessions: {
          [project().id]: {
            role: 'PLANNER_DEEP',
            scope: 'PLANNING_EPISODE',
            providerId: 'anthropic',
            agentId: 'claude-code',
            orcaSessionId: 'tsf-planner-chat:weird-talent-marketplace',
            providerConversationId: 'a-stale-unknown-id'
          }
        }
      })
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: state,
        recentHistory: []
      })
      assert.equal(result.ok, true)
      assert.equal(result.freshSession, true)
      assert.equal(result.sessionId, 'fresh-after-stale')
    }
  )
})

test('long chat message is transmitted without crashing the invocation', async () => {
  await withStubEnv(
    { TSF_PLANNER_CLAUDE_COMMAND: STUB, STUB_MODE: 'success', STUB_SESSION_ID: 'long-msg' },
    async () => {
      const longMessage = 'why is this blocked? '.repeat(180) // ~3960 chars, under the 4000-char cap
      const result = await invokeLivePlanner({
        project: project(),
        message: longMessage,
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, true)
      assert.match(result.text, /^stub-answer-for::/)
    }
  )
})

test('project switch does not leak prior project context into the new project capsule', () => {
  const a = buildProjectContextCapsule(
    project({ id: 'project-a', purpose: 'PROJECT_A_ONLY_MARKER' })
  )
  const b = buildProjectContextCapsule(
    project({
      id: 'project-b',
      purpose: 'PROJECT_B_ONLY_MARKER',
      mission: { id: null, state: 'ACTIVE', blockedReason: null },
      health: { status: 'HEALTHY', findings: [] }
    })
  )
  assert.doesNotMatch(JSON.stringify(b), /PROJECT_A_ONLY_MARKER/)
  assert.doesNotMatch(JSON.stringify(a), /PROJECT_B_ONLY_MARKER/)
})

// A real, live-confirmed bug (M3 live dogfood proof, not a hypothetical):
// the real `claude` CLI's --json-schema rejected chat-work-plan-request
// .schema.v1.json with PROVIDER_ERROR ("not a valid JSON Schema: no schema
// with key or ref https://json-schema.org/draft/2020-12/schema") because
// the schema carries its own $schema/$id metadata keys -- every stub-CLI
// test above passed regardless, since the stub never actually validates
// the schema against real CLI semantics.
test('strips $schema and $id before a schema reaches the real CLI, leaving everything else untouched', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://tsf.local/contracts/chat-work-plan-request.schema.v1.json',
    title: 'TSF Chat Work Plan Request V1',
    type: 'object',
    properties: { schemaVersion: { const: 'TSF_CHAT_WORK_PLAN_REQUEST_V1' } }
  }
  const stripped = stripSchemaMetaKeys(schema)
  assert.equal('$schema' in stripped, false)
  assert.equal('$id' in stripped, false)
  assert.deepEqual(stripped, {
    title: 'TSF Chat Work Plan Request V1',
    type: 'object',
    properties: { schemaVersion: { const: 'TSF_CHAT_WORK_PLAN_REQUEST_V1' } }
  })
})

test("a schema with neither key (e.g. onboarding.mjs's inline DIRECTION_SCHEMA) passes through unchanged", () => {
  const schema = { type: 'object', properties: { purpose: { type: 'string' } } }
  assert.deepEqual(stripSchemaMetaKeys(schema), schema)
})

// --- Defect 4 (M7 real-migration finding): invokeLiveStructuredAnalysis's ---
// one bounded retry, used by onboarding's Direction analysis. Real Route
// Reader migration report: "Planner unavailable — using recorded
// project-state fallback (provider returned an error)" with no real
// Direction recommendation, for what looked like a one-off provider hiccup.

test('invokeLiveStructuredAnalysis: a one-off PROVIDER_ERROR recovers via a single bounded retry, without falling back to a different profile', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-flaky-'))
  const counterFile = path.join(dir, 'flaky-counter')
  try {
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: STUB,
        TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
        STUB_MODE: 'flaky-then-success',
        STUB_FLAKY_COUNTER_FILE: counterFile,
        STUB_SESSION_ID: 'retry-recovered-session'
      },
      async () => {
        const result = await invokeLiveStructuredAnalysis({
          systemPrompt: 'system',
          prompt: 'analyze this',
          jsonSchema: { type: 'object', properties: { purpose: { type: 'string' } } }
        })
        assert.equal(result.ok, true)
        assert.equal(result.agentId, 'claude-code')
        assert.equal(result.data.purpose, 'stub-answer-for::analyze this')
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invokeLiveStructuredAnalysis: a persistent PROVIDER_ERROR is not hidden behind endless retry — it still surfaces as a real failure', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
      STUB_MODE: 'provider-error'
    },
    async () => {
      const result = await invokeLiveStructuredAnalysis({
        systemPrompt: 'system',
        prompt: 'analyze this',
        jsonSchema: { type: 'object', properties: { purpose: { type: 'string' } } }
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'PROVIDER_ERROR')
    }
  )
})

test('invokeLiveStructuredAnalysis: MALFORMED_RESPONSE is not retried (a schema/parsing mismatch would just reproduce)', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
      STUB_MODE: 'malformed'
    },
    async () => {
      const result = await invokeLiveStructuredAnalysis({
        systemPrompt: 'system',
        prompt: 'analyze this',
        jsonSchema: { type: 'object', properties: { purpose: { type: 'string' } } }
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'MALFORMED_RESPONSE')
    }
  )
})
