// Trust + Scale Hardening / Continuation 2 Section 10: the durable
// evaluation harness. NOT a new testing framework and NOT an opaque
// quality score -- HQ was explicit: "Keep dimensions explicit. No opaque
// quality score." Every dimension named below already has real, targeted
// tests elsewhere in this suite (built as each phase's own defect was
// found and fixed); this file is the single, explicit, traceable manifest
// tying each named dimension to where its real coverage actually lives,
// plus a meta-test that fails if any listed file/test ever goes missing
// (manifest drift is itself a real regression -- a dimension silently
// losing its only test would otherwise go unnoticed).
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

// Each dimension: the real file(s) that cover it, plus a short pointer to
// the specific test name(s) inside so a human can go straight to the
// evidence (not re-asserted here -- those files already assert the real
// behavior; duplicating that logic here would just be a second, weaker
// copy to keep in sync).
const EVALUATION_DIMENSIONS = Object.freeze({
  CANONICALIZATION_AUTHORITY: {
    files: ['test/research-epistemic-ladder.test.mjs', 'test/research-library.test.mjs'],
    pointer: '"CANONICALIZATION INVARIANT: admitReconciliationDecision is the only path to a CanonicalFact"; "two missions: a genuine cross-mission reuse..."'
  },
  SOURCE_INDEPENDENCE: {
    files: ['test/research-source-independence.test.mjs', 'test/research-e2e-normal-mission.test.mjs'],
    pointer: 'scenarios A-H; e2e step 5 (observable lineage collapse)'
  },
  UPSTREAM_CHAIN_HANDLING: {
    files: ['test/research-source-independence.test.mjs'],
    pointer: 'scenario B/C (mirror/aggregator collapse), cycle-guard coverage via resolveRoot'
  },
  TEMPORAL_LEAKAGE: {
    files: ['test/research-epistemic-ladder.test.mjs'],
    pointer: '"detectResearchConflicts does NOT flag two claims for the same field with genuinely different temporalScope..."'
  },
  TEMPORAL_COMPLETENESS: {
    files: ['test/research-completeness.test.mjs'],
    pointer: 'all 7 "temporal completeness: ..." scenarios'
  },
  TYPED_MISSINGNESS: {
    files: ['test/research-epistemic-ladder.test.mjs'],
    pointer: '"a proposedValue of null is admitted as TypedMissingness..."; both ACCEPT_TYPED_MISSING temporal-disambiguation tests'
  },
  PARTIAL_NEEDS_INPUT: {
    files: ['test/research-epistemic-ladder.test.mjs', 'test/research-mission-driver.test.mjs'],
    pointer: 'all 8 SUCCEEDED/PARTIAL/NEEDS_INPUT/FAILED transition tests; NEEDS_INPUT escalation-policy tests'
  },
  IDENTITY_AMBIGUITY: {
    files: ['test/research-mission.test.mjs', 'test/research-epistemic-ladder.test.mjs'],
    pointer: 'AMBIGUOUS_IDENTITY Needs You category; "identity resolution state is recorded per node..."'
  },
  CONFLICTS: {
    files: ['test/research-epistemic-ladder.test.mjs', 'test/research-mission-driver.test.mjs', 'test/research-e2e-normal-mission.test.mjs'],
    pointer: 'detectResearchConflicts tests; "a genuine conflict is escalated to Needs You..."; e2e step 9 (escalate then genuinely reconcile)'
  },
  CROSS_MISSION_REUSE: {
    files: ['test/research-library.test.mjs', 'test/research-library-store.test.mjs'],
    pointer: 'all evaluateResearchLibraryReuse CACHE_* tests; the two-mission proof'
  },
  SCHEMA_GUARDS: {
    files: ['test/research-schema-versioning.test.mjs', 'test/research-mission-store-schema-version.test.mjs'],
    pointer: 'fail-closed on missing/unrecognized schemaVersion, for both the mission and the library'
  },
  PROVIDER_NORMALIZATION: {
    files: ['test/provider-adapter-conformance.test.mjs', 'test/parallel-http-transport.test.mjs', 'test/exa-http-transport.test.mjs'],
    pointer: 'BoundedResearchWorker protocol conformance; real transport contract tests'
  },
  DISPATCH_AMBIGUITY: {
    files: ['test/research-dispatch-bookkeeping.test.mjs', 'test/research-mission-driver.test.mjs'],
    pointer: 'EXACTLY_ONCE/AT_MOST_ONCE/AT_LEAST_ONCE/AMBIGUOUS_REQUIRES_RECONCILIATION classification; the real crash-simulation test'
  },
  CRASH_RESUME: {
    files: ['test/research-crash-resume.test.mjs', 'test/research-mission-driver.test.mjs', 'test/research-e2e-normal-mission.test.mjs'],
    pointer: 'gauntlet A-J; driver-level resume tests; e2e step 8'
  },
  COST_GOVERNANCE: {
    files: ['test/live-bakeoff-governance.test.mjs', 'test/research-mission-driver.test.mjs'],
    pointer: 'fail-closed unknown-price/no-ceiling gate; "COST GOVERNANCE: gated against real durable cumulative spend..."'
  },
  SECRET_LEAKAGE: {
    files: ['test/research-secret-leakage.test.mjs', 'test/parallel-http-transport.test.mjs', 'test/exa-http-transport.test.mjs'],
    pointer: 'repo-wide credential-literal scan; "the api key must never appear in an error message"'
  }
})

test('every evaluation dimension maps to at least one real, currently-existing test file', () => {
  const missing = []
  for (const [dimension, { files }] of Object.entries(EVALUATION_DIMENSIONS)) {
    for (const file of files) {
      if (!existsSync(path.join(ROOT, file))) missing.push(`${dimension} -> ${file}`)
    }
  }
  assert.deepEqual(missing, [], `manifest drift: a listed coverage file no longer exists -- ${JSON.stringify(missing)}`)
})

test('the manifest itself covers every dimension HQ named, with no silent gaps', () => {
  const required = [
    'CANONICALIZATION_AUTHORITY', 'SOURCE_INDEPENDENCE', 'UPSTREAM_CHAIN_HANDLING', 'TEMPORAL_LEAKAGE',
    'TEMPORAL_COMPLETENESS', 'TYPED_MISSINGNESS', 'PARTIAL_NEEDS_INPUT', 'IDENTITY_AMBIGUITY', 'CONFLICTS',
    'CROSS_MISSION_REUSE', 'SCHEMA_GUARDS', 'PROVIDER_NORMALIZATION', 'DISPATCH_AMBIGUITY', 'CRASH_RESUME',
    'COST_GOVERNANCE', 'SECRET_LEAKAGE'
  ]
  const present = Object.keys(EVALUATION_DIMENSIONS)
  const missing = required.filter((d) => !present.includes(d))
  assert.deepEqual(missing, [])
  assert.equal(present.length, required.length, 'no extra, undocumented dimension either -- the manifest and this list must agree exactly')
})
