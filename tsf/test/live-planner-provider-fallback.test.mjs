// Phase 11 (Provider/Worker Resilience): split out of live-planner.test.mjs
// to stay under the 600-line cap (CLAUDE.md: never disable/bump max-lines).
// Covers the real gaps this phase found and closed in live-planner.mjs:
// (1) invokeLiveStructuredAnalysis never validated a parsed response against
// its own jsonSchema's required fields -- a valid-JSON-but-wrong-shape
// response was silently accepted as ok:true; (2) no existing test proved a
// genuinely SUCCESSFUL Claude-unavailable -> Codex fallback with honest
// answering-identity, for either live entrypoint.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  invokeLivePlanner,
  invokeLiveStructuredAnalysis,
  conformsToRequiredShape
} from '../server/live-planner.mjs'

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

test('conformsToRequiredShape: honest pure-function edge cases', () => {
  assert.equal(conformsToRequiredShape({ a: 1 }, { required: ['a'] }), true)
  assert.equal(conformsToRequiredShape({ b: 1 }, { required: ['a'] }), false, 'a required field genuinely absent must fail')
  assert.equal(conformsToRequiredShape({ a: null }, { required: ['a'] }), true, 'present-but-null still satisfies presence -- this is a shape check, not a value check')
  assert.equal(conformsToRequiredShape(null, { required: ['a'] }), false)
  assert.equal(conformsToRequiredShape(['a'], { required: [] }), false, 'an array is never treated as the requested object shape')
  assert.equal(conformsToRequiredShape({ anything: true }, {}), true, 'a schema with no required list has nothing to check -- never a false negative')
})

test('invokeLiveStructuredAnalysis: a valid-JSON, WRONG-SHAPE response is rejected honestly (MALFORMED_RESPONSE), never silently accepted as ok:true', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
      STUB_MODE: 'wrong-shape'
    },
    async () => {
      const result = await invokeLiveStructuredAnalysis({
        systemPrompt: 'system',
        prompt: 'analyze this',
        jsonSchema: { type: 'object', required: ['answers'], properties: { answers: { type: 'array' } } }
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'MALFORMED_RESPONSE', 'valid-but-wrong-shape JSON must be distinguishable from a real success, exactly like invalid JSON already is')
      assert.match(result.detail, /missing required field\(s\): answers/)
    }
  )
})

// Item 2/3: Claude unavailable -> the real, documented CODEX_SAFE fallback
// answers instead, with the honest ANSWERING identity recorded (never the
// originally-preferred/intended provider). No prior test in this file
// exercised a genuinely SUCCESSFUL cross-provider fallback for either live
// entrypoint -- every existing failure-mode test makes both agents fail.
test('invokeLivePlanner: Claude unavailable falls back to Codex and honestly reports Codex as the real answering provider', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
      TSF_PLANNER_CODEX_COMMAND: STUB,
      STUB_MODE: 'success',
      STUB_SESSION_ID: 'codex-fallback-session',
      STUB_MODEL: 'stub-codex-model'
    },
    async () => {
      const result = await invokeLivePlanner({
        project: project(),
        message: 'status?',
        opState: opState(),
        recentHistory: []
      })
      assert.equal(result.ok, true)
      assert.equal(result.agentId, 'codex', 'the REAL answering agent, never the originally-preferred claude-code')
      assert.equal(result.providerId, 'openai', 'the real answering providerId, never anthropic')
      assert.equal(result.sessionId, 'codex-fallback-session')
      assert.match(result.text, /^stub-answer-for::/)
    }
  )
})

test('invokeLiveStructuredAnalysis: Claude unavailable falls back to Codex, the schema is still honored (forwarded as prose, since codex exec has no --json-schema flag), and identity is honest', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-codex-fallback-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: path.join(HERE, 'fixtures', 'does-not-exist-binary'),
        TSF_PLANNER_CODEX_COMMAND: STUB,
        STUB_MODE: 'success',
        STUB_SESSION_ID: 'codex-structured-fallback',
        STUB_DEBUG_FILE: debugFile
      },
      async () => {
        const result = await invokeLiveStructuredAnalysis({
          systemPrompt: 'classify this message',
          prompt: 'what needs me?',
          jsonSchema: {
            type: 'object',
            required: ['schemaVersion', 'scope'],
            properties: {
              schemaVersion: { const: 'TSF_COMMAND_SCOPE_CLASSIFICATION_V1' },
              scope: { type: 'string' },
              reasoning: { type: 'string' }
            }
          }
        })
        assert.equal(result.ok, true, `expected a real conformant fallback answer, got: ${JSON.stringify(result)}`)
        assert.equal(result.agentId, 'codex')
        assert.equal(result.providerId, 'openai')
        assert.equal(result.data.schemaVersion, 'TSF_COMMAND_SCOPE_CLASSIFICATION_V1')
        assert.equal(typeof result.data.scope, 'string')

        // Direct proof the schema actually reached the codex invocation
        // (not just that the stub happened to guess right): the schema JSON
        // is present verbatim in the real transmitted positional argument.
        const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
        assert.equal(seen.args[0], 'exec')
        assert.match(seen.args[2], /TSF_COMMAND_SCOPE_CLASSIFICATION_V1/)
        assert.match(seen.args[2], /matching exactly this JSON Schema/)
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
