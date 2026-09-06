// Regression coverage for the generic claimed-value-vs-timeline
// classifier, including the adversarial-alias failure mode originally
// found live (a missing alias silently inflated the unresolved-identity
// bucket). All entity/value data below is fictional; the alias
// normalization here is a tiny, generic, inline stand-in (not the
// mission-specific NFL team normalizer this classifier deliberately
// never imports -- normalization is always the caller's job).
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyClaimedValueAgainstTimeline } from '../domain/claimed-value-temporal-classifier.mjs'

// A tiny, generic stand-in for "some mission's own alias normalizer" --
// this classifier never normalizes internally, so a missing mapping here
// (deliberately reproduced in the first test) shows up as a real,
// visible NO_MATCH, never silently absorbed.
const ALIASES = { GAMMA_ALT: 'GAMMA' }
function normalize(value) {
  return ALIASES[value] ?? value
}

function groundTruth(entries) {
  // entries: [[year, entityKey, [values...]], ...]
  const m = new Map()
  for (const [year, key, values] of entries) {
    if (!m.has(year)) m.set(year, new Map())
    m.get(year).set(key, new Set(values.map(normalize)))
  }
  return m
}

test('NAIVE failure mode reproduced: comparing RAW (unnormalized) values turns a real match into a false NO_MATCH_ANY_YEAR', () => {
  const gt = groundTruth([[2020, 'ENTITY_A|X', ['GAMMA']]])
  // The claim uses the real alternate encoding for the same real value --
  // if a caller forgets to normalize before calling the classifier, this
  // looks like a genuine miss.
  const naiveResult = classifyClaimedValueAgainstTimeline('ENTITY_A|X', 'GAMMA_ALT', 2020, gt) // NOT normalized -- the bug
  assert.equal(naiveResult, 'NO_MATCH_ANY_YEAR', 'THE BUG: without normalization, a real match is misclassified as unresolved')
})

test('CORRECTED behavior: normalizing the claim first resolves the same case to a real MATCH', () => {
  const gt = groundTruth([[2020, 'ENTITY_A|X', ['GAMMA']]])
  const correctedResult = classifyClaimedValueAgainstTimeline('ENTITY_A|X', normalize('GAMMA_ALT'), 2020, gt)
  assert.equal(correctedResult, 'MATCH')
})

test('ADVERSARIAL: normalization must not mask genuine future-contamination even when both sides use aliased values', () => {
  // Entity's real ground truth: a DIFFERENT real value in 2018, then
  // genuinely does not take on the target value until 2022 (encoded there
  // via the alternate alias) -- a real future-only match must still be
  // caught as FUTURE_CONTAMINATION for a 2020 claim, not accidentally
  // cleared or reclassified by the alias machinery.
  const gt = groundTruth([
    [2018, 'ENTITY_B|Y', ['DELTA']],
    [2022, 'ENTITY_B|Y', ['GAMMA_ALT']]
  ])
  const claimed2020 = normalize('GAMMA_ALT') // claims the SAME real value, but for 2020 -- a year with NO real ground truth for it
  const result = classifyClaimedValueAgainstTimeline('ENTITY_B|Y', claimed2020, 2020, gt)
  assert.equal(result, 'FUTURE_CONTAMINATION', 'a real future-only match must be classified as contamination, not silently cleared by alias normalization')
})

test('STALE_PRIOR_VALUE: a claim matching only a real PAST year is benign staleness, not contamination', () => {
  const gt = groundTruth([[2016, 'ENTITY_C|Z', ['ALPHA']]])
  const result = classifyClaimedValueAgainstTimeline('ENTITY_C|Z', 'ALPHA', 2018, gt)
  assert.equal(result, 'STALE_PRIOR_VALUE')
})

test('AMBIGUOUS_BOTH_PRIOR_AND_FUTURE: a real "reverted to a former value" case is distinguished from both stale and contaminated', () => {
  const gt = groundTruth([
    [2014, 'ENTITY_D|W', ['BETA']],
    [2019, 'ENTITY_D|W', ['BETA']]
  ])
  const result = classifyClaimedValueAgainstTimeline('ENTITY_D|W', 'BETA', 2017, gt)
  assert.equal(result, 'AMBIGUOUS_BOTH_PRIOR_AND_FUTURE')
})

test('NO_VALUE_CLAIMED: a placeholder claim is never treated as a value mismatch', () => {
  const gt = groundTruth([[2020, 'ENTITY_E|X', ['ALPHA']]])
  for (const placeholder of ['', 'NA', null, undefined]) {
    assert.equal(classifyClaimedValueAgainstTimeline('ENTITY_E|X', placeholder, 2020, gt), 'NO_VALUE_CLAIMED')
  }
})

test('NO_MATCH_ANY_YEAR: a genuinely unresolvable claim (no real year matches) stays unresolved, not auto-cleared or auto-flagged', () => {
  const gt = groundTruth([[2020, 'ENTITY_F|Y', ['DELTA']]])
  const result = classifyClaimedValueAgainstTimeline('ENTITY_F|Y', 'ALPHA', 2020, gt)
  assert.equal(result, 'NO_MATCH_ANY_YEAR')
})

test('MATCH: the clean, expected-majority case -- claim equals real ground truth for the exact target year', () => {
  const gt = groundTruth([[2020, 'ENTITY_G|Z', ['EPSILON']]])
  assert.equal(classifyClaimedValueAgainstTimeline('ENTITY_G|Z', 'EPSILON', 2020, gt), 'MATCH')
})
