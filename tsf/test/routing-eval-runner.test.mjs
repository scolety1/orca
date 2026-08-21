import assert from 'node:assert/strict'
import test from 'node:test'
import { ROUTING_BASICS_PACK } from '../server/routing-eval-cases.mjs'
import { runRoutingEvalCase, runRoutingEvalPack } from '../server/routing-eval-runner.mjs'
import { normalizeEvalPack, runEvalPack, compareEvalRuns } from '../domain/evaluation-pack.mjs'
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }

test('normalizeEvalPack accepts the real ROUTING_BASICS_PACK unchanged', () => {
  assert.equal(normalizeEvalPack(ROUTING_BASICS_PACK).cases.length, 3)
})

test('REQUIRED PROOF: the real routing eval pack passes end to end against the real, committed routing config', () => {
  const pack = normalizeEvalPack(ROUTING_BASICS_PACK)
  const run = runEvalPack(
    pack,
    runRoutingEvalPack(pack),
    () => new Date('2026-01-01T00:00:00.000Z')
  )
  assert.equal(run.passRate, 1)
})

test('runRoutingEvalCase resolves PLANNER_DEEP to the real anthropic provider', () => {
  const pack = normalizeEvalPack(ROUTING_BASICS_PACK)
  const result = runRoutingEvalCase(pack.cases[0])
  assert.equal(result.providerId, 'anthropic')
})

test('threwOnUnknownRole is only true for a genuinely unknown role, not any resolveRole failure (a real review finding)', () => {
  const missingProfileMappings = {
    ...providerRoles,
    roles: {
      ...providerRoles.roles,
      WORKER_CHEAP: { ...providerRoles.roles.WORKER_CHEAP, preferredProfile: 'NONEXISTENT_PROFILE' }
    }
  }
  const result = runRoutingEvalCase(
    { input: { role: 'WORKER_CHEAP' } },
    { mappings: missingProfileMappings }
  )
  assert.equal(result.threwOnUnknownRole, false)
})

test('REQUIRED PROOF: a real candidate config regression -- VERIFIER_INDEPENDENT no longer actually differing from WORKER_BALANCED -- is detected end to end and blocks promotion', () => {
  const pack = normalizeEvalPack(ROUTING_BASICS_PACK)
  const baselineRun = runEvalPack(
    pack,
    runRoutingEvalPack(pack),
    () => new Date('2026-01-01T00:00:00.000Z')
  )
  assert.equal(baselineRun.passRate, 1)

  // A genuine candidate config, in memory only -- never written to the
  // real provider-role-mappings.v1.json -- where VERIFIER_INDEPENDENT's
  // preferredProfile now matches WORKER_BALANCED's, a real regression a
  // routing/model-mapping change could actually introduce.
  const regressedMappings = {
    ...providerRoles,
    roles: {
      ...providerRoles.roles,
      VERIFIER_INDEPENDENT: {
        ...providerRoles.roles.VERIFIER_INDEPENDENT,
        preferredProfile: 'CODEX_SAFE'
      }
    }
  }
  const candidateRun = runEvalPack(
    pack,
    runRoutingEvalPack(pack, { mappings: regressedMappings }),
    () => new Date('2026-01-02T00:00:00.000Z')
  )
  assert.equal(candidateRun.failedCases, 1)

  const comparison = compareEvalRuns(baselineRun, candidateRun)
  assert.deepEqual(comparison.regressions, [
    'verifier-independent-genuinely-differs-from-worker-balanced'
  ])
  assert.equal(comparison.recommendation, 'DO_NOT_PROMOTE')
})
