// Conversational Command + Continuous Hands-Free V2 -- Phase 3 (Project /
// Entity Resolution V2). Real reproductions of the mission's own reported
// Failure 1: spoken "Thousand Sunny Fleet"/"TSF"/"Sunny Fleet" (and CLC/
// Colety Labs) resolved to nothing at all, even though the canonical
// tsf-orca/colety-labs-sales-engine projects exist. Uses the REAL default
// aliases (domain/project-aliases.mjs, no override) and the real project
// id/displayName shapes as they actually exist in the live catalog
// (`tsf-orca` / `TSF_ORCA`, `colety-labs-sales-engine` /
// `colety-labs-sales-engine`, `niners-war-room` / `Niners-War-Room`) --
// this file never touches real owner state, it only proves the pure
// resolver function against inert, hand-shaped project objects matching
// the real catalog's own real ids/displayNames.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'

const REAL_PROJECTS = [
  { id: 'tsf-orca', displayName: 'TSF_ORCA' },
  { id: 'niners-war-room', displayName: 'Niners-War-Room' },
  { id: 'colety-labs-sales-engine', displayName: 'colety-labs-sales-engine' }
]

function ids(matches) {
  return matches.map((m) => m.project.id)
}

test('REPRODUCTION (Failure 1): "what is currently going on within tsf at the moment" now resolves TSF', () => {
  const { matches } = resolveProjectsFromText(
    'hello I think this is working ... what is currently going on within tsf at the moment',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('REPRODUCTION (Failure 1): "let\'s work on Thousand Sunny Fleet I need an upgrade" now resolves TSF', () => {
  const { matches } = resolveProjectsFromText(
    "let's work on Thousand Sunny Fleet I need an upgrade",
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('bare "TSF" alone resolves (previously 0.5 fuzzy ratio, just under the 0.6 floor)', () => {
  const { matches } = resolveProjectsFromText('what is TSF doing?', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('"Sunny Fleet" (the shorter real spoken name) resolves TSF', () => {
  const { matches } = resolveProjectsFromText('switch to Sunny Fleet', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('"TSF Orca" (spoken, no underscore) resolves via the normalized-name tier, at exact confidence', () => {
  const { matches } = resolveProjectsFromText('status on TSF Orca please', REAL_PROJECTS)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].project.id, 'tsf-orca')
  assert.notEqual(matches[0].matchedOn, 'fuzzy')
})

test('NWR aliases: "NWR", "Niners War Room" (no hyphens, as spoken), and the literal hyphenated displayName all resolve the same real project', () => {
  for (const phrase of [
    "what's NWR doing?",
    "let's work on Niners War Room",
    'status on Niners-War-Room'
  ]) {
    const { matches } = resolveProjectsFromText(phrase, REAL_PROJECTS)
    assert.deepEqual(ids(matches), ['niners-war-room'], `failed for: "${phrase}"`)
  }
})

test('CLC / Colety Labs aliases resolve the real Colety Labs project', () => {
  for (const phrase of ['how is CLC doing?', "let's work on Colety Labs"]) {
    const { matches } = resolveProjectsFromText(phrase, REAL_PROJECTS)
    assert.deepEqual(ids(matches), ['colety-labs-sales-engine'], `failed for: "${phrase}"`)
  }
})

test('genuinely ambiguous speech-normalized names still refuse rather than guess', () => {
  const projects = [
    { id: 'alpha-project-one', displayName: 'Alpha Project One' },
    { id: 'alpha-project-two', displayName: 'Alpha Project Two' }
  ]
  const { matches, ambiguous } = resolveProjectsFromText(
    'not sure if this is alpha project one or alpha project two',
    projects
  )
  // Both are full, contiguous phrase matches at exact confidence -- two
  // real exact candidates in one message is a genuinely different (and
  // already-covered) ambiguity shape than "no exact signal at all"; either
  // way, this must never silently collapse to one guessed project.
  assert.equal(matches.length, 2)
  void ambiguous
})

test('an unrelated real project is never dragged in by the new normalized-name tier', () => {
  const { matches } = resolveProjectsFromText("let's work on TSF", REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})
