// Hands-on pilot round 2, Finding 1 + Command architecture fix: real,
// natural-language scope classification for a message that named no
// project, proven both through the real live-planner wiring (stub CLI --
// same subprocess-spawn path a real claude/codex call takes, deterministic
// content) and the honest deterministic fallback used when no planner is
// available.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

// Finding F1: forces HEALTHY host memory for every test in this file except
// the ones below that deliberately override deps.collectHostMemoryEvidence
// (which takes precedence) -- mirrors chat-dispatch-bridge.test.mjs's own
// convention, keeping this file's other assertions immune to a genuinely
// shared, loaded host.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { classifyGlobalScope, buildGlobalAdvisoryText, GLOBAL_SCOPES } =
  await import('../server/command-scope-classifier.mjs')

function project(id, displayName, sourceClass = 'REAL') {
  return { id, displayName, sourceClass }
}

test('GLOBAL_SCOPES is the exact closed enum this classifier ever returns', () => {
  assert.deepEqual(GLOBAL_SCOPES, [
    'GLOBAL_STATUS',
    'GLOBAL_ADVISORY',
    'RESEARCH_REQUEST',
    'NEEDS_YOU_QUERY',
    'PROJECT_REQUIRED',
    'UNCLEAR'
  ])
})

test('deterministic fallback: recognizes GLOBAL_STATUS/GLOBAL_ADVISORY/RESEARCH_REQUEST/UNCLEAR without a live planner', async () => {
  const prevClaude = process.env.TSF_PLANNER_CLAUDE_COMMAND
  const prevCodex = process.env.TSF_PLANNER_CODEX_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
  process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
  try {
    const cases = [
      ["what's running right now?", 'GLOBAL_STATUS'],
      ['are there any projects here that are safe to mess around with?', 'GLOBAL_ADVISORY'],
      ['is there anything safe we can test on?', 'GLOBAL_ADVISORY'],
      ["which projects here don't matter?", 'GLOBAL_ADVISORY'],
      ['give me a disposable project to mess with', 'GLOBAL_ADVISORY'],
      ['what can we safely run tests against?', 'GLOBAL_ADVISORY'],
      ['research the history of something obscure', 'RESEARCH_REQUEST'],
      ['what needs me?', 'NEEDS_YOU_QUERY'],
      ['what am I blocking?', 'NEEDS_YOU_QUERY'],
      // Owner-trial-prep finding (real, from a live multi-project
      // agreement audit): these previously fell through to a guessed
      // NEEDS_YOU_QUERY or UNCLEAR -- all are real "what's the fleet's
      // true state" questions GLOBAL_STATUS already answers honestly
      // now that fleetWorkStatus reports a real primaryState for every
      // project. "waiting on/for resources" stays excluded -- it has its
      // own dedicated handler upstream (command-fleet-attention-bridge.mjs).
      ["what's waiting?", 'GLOBAL_STATUS'],
      ['is everything still working?', 'GLOBAL_STATUS'],
      ['did anything stop?', 'GLOBAL_STATUS'],
      ['can I leave everything alone?', 'GLOBAL_STATUS'],
      // "waiting on/for resources" is deliberately excluded from this
      // classifier's own GLOBAL_STATUS match (see fleetTruthQuestion's own
      // negative lookahead) -- it never reaches this layer in the real
      // pipeline (command-fleet-attention-bridge.mjs intercepts it first,
      // see test/command-fleet-attention-bridge.test.mjs), but if that
      // upstream check were ever bypassed, this must not ALSO silently
      // swallow it into the wrong, generic answer.
      ["what's waiting on resources?", 'UNCLEAR'],
      ['asdkjfh laksjdhf', 'UNCLEAR']
    ]
    for (const [message, expected] of cases) {
      const result = await classifyGlobalScope({ message })
      assert.equal(
        result.scope,
        expected,
        `"${message}" -> expected ${expected}, got ${result.scope}`
      )
      assert.equal(result.source, 'DETERMINISTIC_FALLBACK')
      assert.ok(result.plannerFailure, 'an honest reason for the fallback must be recorded')
    }
  } finally {
    if (prevClaude === undefined) {
      delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    } else {
      process.env.TSF_PLANNER_CLAUDE_COMMAND = prevClaude
    }
    if (prevCodex === undefined) {
      delete process.env.TSF_PLANNER_CODEX_COMMAND
    } else {
      process.env.TSF_PLANNER_CODEX_COMMAND = prevCodex
    }
  }
})

test('live planner (stub, real subprocess wiring): a real structured response drives the classification, not the deterministic fallback', async () => {
  const prevClaude = process.env.TSF_PLANNER_CLAUDE_COMMAND
  const prevCodex = process.env.TSF_PLANNER_CODEX_COMMAND
  const prevOverride = process.env.STUB_SCOPE_OVERRIDE
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
  process.env.STUB_SCOPE_OVERRIDE = 'GLOBAL_ADVISORY'
  try {
    const result = await classifyGlobalScope({
      message: 'some message the deterministic fallback would call UNCLEAR'
    })
    assert.equal(result.scope, 'GLOBAL_ADVISORY')
    assert.equal(result.source, 'LIVE_PLANNER')
    assert.ok(result.reasoning)
  } finally {
    if (prevClaude === undefined) {
      delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    } else {
      process.env.TSF_PLANNER_CLAUDE_COMMAND = prevClaude
    }
    if (prevCodex === undefined) {
      delete process.env.TSF_PLANNER_CODEX_COMMAND
    } else {
      process.env.TSF_PLANNER_CODEX_COMMAND = prevCodex
    }
    if (prevOverride === undefined) {
      delete process.env.STUB_SCOPE_OVERRIDE
    } else {
      process.env.STUB_SCOPE_OVERRIDE = prevOverride
    }
  }
})

// Finding F1: classifyGlobalScope was one of 5 real invokeLiveStructuredAnalysis
// call sites never consulting the Resource Pressure Governor before spawning
// a heavyweight LLM-CLI child process.
test('CRITICAL host memory skips the live planner spawn entirely and falls back to the deterministic classifier', async () => {
  const prevClaude = process.env.TSF_PLANNER_CLAUDE_COMMAND
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  try {
    const result = await classifyGlobalScope({
      message: "what's running right now?",
      deps: { collectHostMemoryEvidence: () => ({ availableBytes: 1 * 1024 ** 3 }) } // 1 GB free -> EMERGENCY
    })
    assert.equal(result.scope, 'GLOBAL_STATUS')
    assert.equal(result.source, 'DETERMINISTIC_FALLBACK')
    assert.equal(result.plannerFailure, 'RESOURCE_PRESSURE_REFUSED')
  } finally {
    if (prevClaude === undefined) {
      delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    } else {
      process.env.TSF_PLANNER_CLAUDE_COMMAND = prevClaude
    }
  }
})

test('HEALTHY host memory still dispatches the real live planner call', async () => {
  const prevClaude = process.env.TSF_PLANNER_CLAUDE_COMMAND
  const prevOverride = process.env.STUB_SCOPE_OVERRIDE
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  process.env.STUB_SCOPE_OVERRIDE = 'GLOBAL_ADVISORY'
  try {
    const result = await classifyGlobalScope({
      message: 'some message the deterministic fallback would call UNCLEAR',
      deps: { collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) } // 8 GB free -> HEALTHY
    })
    assert.equal(result.scope, 'GLOBAL_ADVISORY')
    assert.equal(result.source, 'LIVE_PLANNER')
  } finally {
    if (prevClaude === undefined) {
      delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    } else {
      process.env.TSF_PLANNER_CLAUDE_COMMAND = prevClaude
    }
    if (prevOverride === undefined) {
      delete process.env.STUB_SCOPE_OVERRIDE
    } else {
      process.env.STUB_SCOPE_OVERRIDE = prevOverride
    }
  }
})

test('buildGlobalAdvisoryText: trusts exact FIXTURE metadata and protects real projects regardless of name', () => {
  const projects = [
    project('colety-labs-sales-engine', 'Colety Labs Sales Engine', 'REAL'),
    project('tsf-ui-capability-check', 'TSF UI Capability Check', 'FIXTURE'),
    project('tsf-ui-capability-check-copy', 'TSF UI Capability Check Copy', 'REAL'),
    project('production-test-project', 'Production Test Project', 'REAL')
  ]
  const text = buildGlobalAdvisoryText(projects)
  assert.match(text, /TSF UI Capability Check/)
  assert.doesNotMatch(text, /Colety Labs Sales Engine/)
  assert.doesNotMatch(text, /TSF UI Capability Check Copy/)
  assert.doesNotMatch(text, /Production Test Project/)
})

test('buildGlobalAdvisoryText: honest when nothing in the catalog is marked safe', () => {
  const text = buildGlobalAdvisoryText([project('real-one', 'Real One', 'REAL')])
  assert.match(text, /every known project here is a real one/i)
})
