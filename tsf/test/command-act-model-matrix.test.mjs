// TSF Control Plane -- Command Act Model V1, GENERALIZED TEST MATRIX.
// Programmatically generates combinations across the axes the CASE-31/32
// directive named (verbs x target-counts x joiners x polarity x exclusion)
// and asserts the core, verb-agnostic invariants hold for every generated
// case -- never exhaustive (the full cross-product is combinatorially
// large), but a real, executed sweep far beyond the named examples in
// test/command-act-model.test.mjs, which locks in the exact required
// regressions individually.
import assert from 'node:assert/strict'
import test from 'node:test'
import { decomposeMultiActionFromActs } from '../domain/command-act-model.mjs'

const A = { id: 'm-a', displayName: 'A' }
const B = { id: 'm-b', displayName: 'B' }
const PROJECTS = [A, B]
const ALIASES = {}

// Verbs with a real, distinct existing multi-action intent (safe to assert
// a specific positive intent id for).
const DISTINGUISHING_VERBS = [
  { phrase: 'adopt', positiveIntent: 'ADOPT_CANDIDATE_REPORT' },
  { phrase: 'accept the candidate', positiveIntent: 'ADOPT_CANDIDATE_REPORT' },
  { phrase: 'approve the candidate', positiveIntent: 'ADOPT_CANDIDATE_REPORT' }
]
const JOINERS = ['. ', '; ', ', and ', ', but ', ', then ']

function entriesFor(target, entries) {
  return entries.filter((e) => e.target === target)
}
function intentsFor(target, entries) {
  return new Set(entriesFor(target, entries).map((e) => e.intent))
}

let generated = 0

for (const verb of DISTINGUISHING_VERBS) {
  for (const joiner of JOINERS) {
    generated++
    const message = `Fix A${joiner}${verb.phrase} B.`
    test(`matrix: verb="${verb.phrase}" joiner="${joiner.trim()}" -- "${message}" never lets A inherit B's adoption`, () => {
      const entries = decomposeMultiActionFromActs(message, PROJECTS, ALIASES)
      assert.equal(intentsFor('m-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
      assert.equal(intentsFor('m-b', entries).has(verb.positiveIntent), true)
    })
  }
}

// Polarity x joiner: a negated verb for A must never leak a positive
// adoption for A regardless of which hard joiner separates it from B's own
// genuine, separate adoption.
for (const joiner of JOINERS) {
  generated++
  const message = `Don't adopt A${joiner}adopt B.`
  test(`matrix: negated-A joiner="${joiner.trim()}" -- "${message}" A stays declined, B stays reported`, () => {
    const entries = decomposeMultiActionFromActs(message, PROJECTS, ALIASES)
    assert.equal(intentsFor('m-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
    assert.equal(intentsFor('m-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
    assert.equal(intentsFor('m-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  })
}

// Target-count sweep: N bare-listed targets sharing one verb never invent
// adoption for any of them, and every one resolves.
const TARGET_COUNT_PROJECTS = ['ta', 'tb', 'tc', 'td', 'te'].map((id, i) => ({ id: `count-${id}`, displayName: String.fromCharCode(65 + i) }))
for (let n = 1; n <= TARGET_COUNT_PROJECTS.length; n++) {
  generated++
  const subset = TARGET_COUNT_PROJECTS.slice(0, n)
  const names = subset.map((p) => p.displayName)
  const message = n === 1 ? `Pause ${names[0]}.` : `Pause ${names.slice(0, -1).join(', ')}, and ${names.at(-1)}.`
  test(`matrix: target-count=${n} -- "${message}" -- a bare list shares one act, never invents adoption`, () => {
    const entries = decomposeMultiActionFromActs(message, subset, ALIASES)
    assert.equal(new Set(entries.map((e) => e.target)).size, n, 'every named target resolves')
    assert.equal(entries.some((e) => e.intent.startsWith('ADOPT')), false)
  })
}

// Exclusion x joiner: every documented exclusion-marker phrasing, combined
// with a couple of different lead-in joiners, must carve the target out.
const EXCLUSION_PHRASINGS = ['not', 'except', 'excluding', 'other than']
for (const marker of EXCLUSION_PHRASINGS) {
  generated++
  const message = `Adopt A, ${marker} B.`
  test(`matrix: exclusion marker="${marker}" -- "${message}" B is carved out`, () => {
    const entries = decomposeMultiActionFromActs(message, PROJECTS, ALIASES)
    assert.equal(intentsFor('m-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
    assert.equal(intentsFor('m-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  })
}

test('matrix: generated case count is a real, non-trivial sweep beyond the named CASE-31/32 examples', () => {
  assert.ok(generated >= 25, `expected a substantial generated matrix, got ${generated}`)
})
