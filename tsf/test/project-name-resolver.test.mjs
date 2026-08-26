import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'

const projects = [
  { id: 'tsf-orca', displayName: 'TSF Orca' },
  { id: 'weird-talent-marketplace', displayName: 'Weird Talent Marketplace' },
  { id: 'shopify-catalog-qa', displayName: 'Shopify Catalog QA' }
]

test('resolves an exact project id match', () => {
  const { matches, ambiguous } = resolveProjectsFromText("why isn't tsf-orca working?", projects)
  assert.deepEqual(
    matches.map((m) => m.project.id),
    ['tsf-orca']
  )
  assert.equal(matches[0].matchedOn, 'id')
  assert.equal(ambiguous, false)
})

test('resolves an exact displayName match', () => {
  const { matches } = resolveProjectsFromText('status on Weird Talent Marketplace', projects)
  assert.deepEqual(
    matches.map((m) => m.project.id),
    ['weird-talent-marketplace']
  )
  assert.equal(matches[0].matchedOn, 'displayName')
})

test('resolves multiple exact matches for a multi-project message', () => {
  const { matches, ambiguous } = resolveProjectsFromText(
    'get tsf-orca and shopify-catalog-qa ready for work',
    projects
  )
  assert.deepEqual(matches.map((m) => m.project.id).sort(), ['shopify-catalog-qa', 'tsf-orca'])
  assert.equal(ambiguous, false)
})

test('no match when the message names no known project', () => {
  const { matches, ambiguous } = resolveProjectsFromText('what is running right now?', projects)
  assert.deepEqual(matches, [])
  assert.equal(ambiguous, false)
})

test('a fuzzy near-miss (partial name overlap) still resolves', () => {
  const { matches } = resolveProjectsFromText('fix the talent marketplace bug', projects)
  assert.deepEqual(
    matches.map((m) => m.project.id),
    ['weird-talent-marketplace']
  )
  assert.equal(matches[0].matchedOn, 'fuzzy')
})

test('exact matches are never marked ambiguous even alongside unrelated fuzzy noise', () => {
  const withNoise = [...projects, { id: 'catalog-qa-tools', displayName: 'Catalog QA Tools' }]
  const { matches, ambiguous } = resolveProjectsFromText(
    'shopify-catalog-qa needs a fix',
    withNoise
  )
  assert.equal(ambiguous, false)
  assert.ok(matches.some((m) => m.project.id === 'shopify-catalog-qa' && m.matchedOn === 'id'))
})
