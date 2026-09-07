// Real runtime enforcement of VERIFIER_INDEPENDENT's own
// mustDifferFromWorkerWhenAvailable flag (ZERO_RELAY_PLANNER_WORKER_
// ARCHITECTURE.md's own documented gap: today only a static regression eval
// checks this, never a live dispatch) -- proved here against the REAL
// committed provider-role-mappings.v1.json/launch-profiles.v1.json
// (VERIFIER_INDEPENDENT prefers 'anthropic', WORKER_BALANCED prefers
// 'openai' -- already divergent by default) AND against fabricated configs
// that force a collision, proving the fallback-switch logic for real.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRole } from '../domain/routing.mjs'
import { resolveIndependentVerifierRole } from '../domain/self-improvement-provider-independence.mjs'
import providerRoleMappings from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import launchProfiles from '../providers/launch-profiles.v1.json' with { type: 'json' }

test('against the REAL committed config: worker=openai (WORKER_BALANCED), verifier=anthropic -- already divergent, no fallback needed', () => {
  const worker = resolveRole({ role: 'WORKER_BALANCED', mappings: providerRoleMappings, profiles: launchProfiles })
  const result = resolveIndependentVerifierRole({ resolveRole, mappings: providerRoleMappings, profiles: launchProfiles, workerProviderId: worker.requested.providerId })
  assert.equal(result.divergent, true)
  assert.equal(result.usedFallback, false)
  assert.equal(result.requiredIndependence, true)
  assert.equal(result.resolution.requested.providerId, 'anthropic')
})

test('a FORCED collision (fabricated config where the preferred verifier profile shares the worker provider) switches to the fallback profile', () => {
  const mappings = {
    roles: {
      VERIFIER_INDEPENDENT: { preferredProfile: 'SAME_AS_WORKER', fallbackProfile: 'GENUINELY_DIFFERENT', modelClass: 'X', effortClass: 'HIGH', mustDifferFromWorkerWhenAvailable: true }
    }
  }
  const profiles = { profiles: { SAME_AS_WORKER: { providerId: 'openai', agentId: 'codex' }, GENUINELY_DIFFERENT: { providerId: 'anthropic', agentId: 'claude-code' } } }
  const result = resolveIndependentVerifierRole({ resolveRole, mappings, profiles, workerProviderId: 'openai' })
  assert.equal(result.divergent, true)
  assert.equal(result.usedFallback, true)
  assert.equal(result.resolution.requested.providerId, 'anthropic')
  assert.equal(result.resolution.requested.profileId, 'GENUINELY_DIFFERENT')
})

test('a collision with NO genuinely different fallback available: honestly reports non-divergent, never fabricates independence', () => {
  const mappings = {
    roles: {
      VERIFIER_INDEPENDENT: { preferredProfile: 'ONLY_PROFILE', fallbackProfile: 'ALSO_SAME_PROVIDER', modelClass: 'X', effortClass: 'HIGH', mustDifferFromWorkerWhenAvailable: true }
    }
  }
  const profiles = { profiles: { ONLY_PROFILE: { providerId: 'openai', agentId: 'codex' }, ALSO_SAME_PROVIDER: { providerId: 'openai', agentId: 'codex-2' } } }
  const result = resolveIndependentVerifierRole({ resolveRole, mappings, profiles, workerProviderId: 'openai' })
  assert.equal(result.divergent, false)
  assert.equal(result.usedFallback, false)
})

test('mustDifferFromWorkerWhenAvailable=false: independence is not required, whatever the outcome is reported honestly', () => {
  const mappings = { roles: { VERIFIER_INDEPENDENT: { preferredProfile: 'P', fallbackProfile: null, modelClass: 'X', effortClass: 'HIGH', mustDifferFromWorkerWhenAvailable: false } } }
  const profiles = { profiles: { P: { providerId: 'openai', agentId: 'codex' } } }
  const result = resolveIndependentVerifierRole({ resolveRole, mappings, profiles, workerProviderId: 'openai' })
  assert.equal(result.requiredIndependence, false)
  assert.equal(result.usedFallback, false)
})
