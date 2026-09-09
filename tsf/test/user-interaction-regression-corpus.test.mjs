// Full Conversational Control Plane Exhaustive Gauntlet V1, Phase 0/20: the
// historical failure corpus (docs/tsf/TSF_USER_INTERACTION_REGRESSION_CORPUS_V1.json)
// is a real, durable artifact -- this test keeps it honest: every entry must
// be well-formed, and every regression test file it points at must actually
// exist in the repo right now. "Historical bugs should NEVER disappear from
// the suite" -- this is the automated check that a future refactor can't
// silently delete a referenced test file without this failing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const CORPUS_PATH = path.join(import.meta.dirname, '..', 'docs', 'tsf', 'TSF_USER_INTERACTION_REGRESSION_CORPUS_V1.json')
const REPO_ROOT = path.join(import.meta.dirname, '..')

function loadCorpus() {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

test('the historical regression corpus file exists and parses as valid JSON', () => {
  assert.ok(existsSync(CORPUS_PATH))
  const corpus = loadCorpus()
  assert.equal(corpus.schemaVersion, 'TSF_USER_INTERACTION_REGRESSION_CORPUS_V1')
  assert.ok(Array.isArray(corpus.cases) && corpus.cases.length > 0)
})

test('every corpus case has a real, non-empty status drawn from the documented vocabulary', () => {
  const corpus = loadCorpus()
  const validStatuses = new Set(['REGRESSION_LOCKED', 'FIXED_THIS_MISSION', 'NOT_A_BUG_CONFIRMED_SAFE', 'DEFERRED'])
  for (const c of corpus.cases) {
    assert.ok(c.caseId, 'every case needs a caseId')
    assert.ok(validStatuses.has(c.status), `${c.caseId}: unrecognized status "${c.status}"`)
  }
})

test('every regressionTestFile referenced by the corpus actually exists in the repo (historical bugs never silently lose coverage)', () => {
  const corpus = loadCorpus()
  const missing = []
  for (const c of corpus.cases) {
    for (const key of ['regressionTestFile', 'regressionTestFile2']) {
      const raw = c[key]
      if (!raw) continue
      // Some entries list multiple comma-separated files, possibly with a
      // trailing parenthetical note -- check each real .test.mjs path found.
      const filePaths = raw.match(/test\/[\w.\-/]+\.test\.mjs/g) ?? []
      for (const rel of filePaths) {
        const abs = path.join(REPO_ROOT, rel)
        if (!existsSync(abs)) missing.push(`${c.caseId}: ${rel}`)
      }
    }
  }
  assert.deepEqual(missing, [], `${missing.length} referenced regression test file(s) are missing: ${missing.join(', ')}`)
})

test('every REGRESSION_LOCKED or FIXED_THIS_MISSION case names at least one real regression test file', () => {
  const corpus = loadCorpus()
  const uncovered = corpus.cases
    .filter((c) => c.status === 'REGRESSION_LOCKED' || c.status === 'FIXED_THIS_MISSION')
    .filter((c) => !c.regressionTestFile)
    .map((c) => c.caseId)
  assert.deepEqual(uncovered, [], `case(s) claim locked/fixed status with no named regression test: ${uncovered.join(', ')}`)
})
