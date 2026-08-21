import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { generateWbs } from '../server/wbs-generation.mjs'
import { runMonteCarloEstimate } from '../domain/estimation.mjs'

const HERE = import.meta.dirname
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

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

test('generateWbs requires exactly one of repoEvidence or ideaBrief', async () => {
  await assert.rejects(() => generateWbs({ projectId: 'p' }), /exactly one/)
  await assert.rejects(
    () => generateWbs({ projectId: 'p', repoEvidence: {}, ideaBrief: 'x' }),
    /exactly one/
  )
})

test('a real repo-grounded WBS is generated, validated, and feeds the real estimation engine end to end', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
      STUB_MODE: 'success'
    },
    async () => {
      const result = await generateWbs({
        projectId: 'weird-talent-marketplace',
        repoEvidence: {
          purpose: 'a real onboarded project',
          unfinishedSummary: 'needs matcher work'
        }
      })
      assert.equal(result.ok, true)
      assert.equal(result.preliminary, false)
      assert.equal(result.wbs.length, 1)
      assert.equal(result.wbs[0].providerRoleHint, 'WORKER_BALANCED')

      // The generated WBS is real, validated output from normalizeWbs
      // (not a fabricated stand-in) -- feed it into the real Monte Carlo
      // engine and confirm it produces a real, reproducible estimate.
      const estimate = runMonteCarloEstimate(result.wbs, { seed: 1, runs: 1000 })
      assert.ok(estimate.activeEffortHours.p50 > 0)
    }
  )
})

test('an idea/client-brief input (no repo) is labeled preliminary', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
      STUB_MODE: 'success'
    },
    async () => {
      const result = await generateWbs({
        projectId: 'new-idea',
        ideaBrief: 'A concept for a client dashboard, no repo yet.'
      })
      assert.equal(result.ok, true)
      assert.equal(result.preliminary, true)
    }
  )
})

test('an unavailable provider produces an honest failure, not a fabricated WBS', async () => {
  await withStubEnv(
    { TSF_PLANNER_CLAUDE_COMMAND: NONEXISTENT, TSF_PLANNER_CODEX_COMMAND: NONEXISTENT },
    async () => {
      const result = await generateWbs({ projectId: 'p', ideaBrief: 'x' })
      assert.equal(result.ok, false)
      assert.ok(result.reason)
    }
  )
})

test('a non-JSON LLM response fails honestly, not silently patched into shape', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
      STUB_MODE: 'malformed'
    },
    async () => {
      const result = await generateWbs({ projectId: 'p', ideaBrief: 'x' })
      assert.equal(result.ok, false)
      // malformed mode produces plain text, not JSON at all -- surfaces as
      // MALFORMED_RESPONSE from invokeLiveStructuredAnalysis itself, a
      // real, distinct failure from this module's own INVALID_WBS case
      // (covered by the next test).
      assert.ok(result.reason)
    }
  )
})

test('REQUIRED PROOF: a schema-conformant but domain-invalid LLM response (min > expected) fails honestly as INVALID_WBS -- normalizeWbs is real defense-in-depth beyond the JSON schema alone', async () => {
  await withStubEnv(
    {
      TSF_PLANNER_CLAUDE_COMMAND: STUB,
      TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
      STUB_MODE: 'success',
      STUB_WBS_INVALID: '1'
    },
    async () => {
      const result = await generateWbs({ projectId: 'p', ideaBrief: 'x' })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'INVALID_WBS')
      assert.match(result.detail, /min <= expected <= max/)
    }
  )
})
