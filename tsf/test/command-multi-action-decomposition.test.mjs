// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A3.
import assert from 'node:assert/strict'
import test from 'node:test'
import { decomposeMultiAction, MULTI_ACTION_INTENTS } from '../domain/command-multi-action-decomposition.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'

const PROJECTS = [
  { id: 'niners-war-room', displayName: 'Niners War Room' },
  { id: 'worldforge-sablewake-live-runtime-repair-v3', displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3' },
  { id: 'easylifehq-github-io', displayName: 'EasyLifeHQ' }
]
const aliases = loadProjectAliases()

function entriesFor(target, entries) {
  return entries.filter((e) => e.target === target)
}

// The mission's own literal example, verbatim.
const MESSAGE =
  "NWR is being handled by another AI, leave it alone. Nytheria looks good, adopt that run and keep going overnight. EasyLife needs serious work -- get EasyWorkouts up so I can start logging workouts."

test('the mission\'s own literal multi-project message decomposes into real, correctly-targeted, correctly-intended actions', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)

  const nwr = entriesFor('niners-war-room', entries)
  assert.equal(nwr.length, 1)
  assert.equal(nwr[0].intent, 'EXTERNAL_WORK_HOLD')

  const worldforge = entriesFor('worldforge-sablewake-live-runtime-repair-v3', entries)
  assert.deepEqual(new Set(worldforge.map((e) => e.intent)), new Set(['ADOPT_CANDIDATE_REPORT', 'START_KEEP_GOING']))

  const easylife = entriesFor('easylifehq-github-io', entries)
  assert.equal(easylife.length, 1)
  assert.equal(easylife[0].intent, 'ASSESS_AND_UPGRADE')

  // Every real target resolved, nothing fabricated, nothing dropped.
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set([
    'niners-war-room',
    'worldforge-sablewake-live-runtime-repair-v3',
    'easylifehq-github-io'
  ]))
})

test('never produces ADOPT_CANDIDATE_EXECUTE or any execution intent -- adoption is always report-only', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)
  assert.ok(entries.every((e) => MULTI_ACTION_INTENTS.includes(e.intent)))
  assert.ok(!entries.some((e) => /EXECUTE/i.test(e.intent)))
})

test('a single clause naming two projects attributes an entry to each, never drops one', () => {
  const entries = decomposeMultiAction('get niners-war-room and worldforge-sablewake-live-runtime-repair-v3 ready', PROJECTS, aliases)
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set([
    'niners-war-room',
    'worldforge-sablewake-live-runtime-repair-v3'
  ]))
})

test('a clause naming no project at all is honestly dropped -- never a fabricated null-target action', () => {
  const entries = decomposeMultiAction('sounds good, thanks', PROJECTS, aliases)
  assert.deepEqual(entries, [])
})

test('a single-project message decomposes to entries for exactly one target', () => {
  const entries = decomposeMultiAction('worldforge needs serious work', PROJECTS, aliases)
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set(['worldforge-sablewake-live-runtime-repair-v3']))
  assert.ok(entries.some((e) => e.intent === 'ASSESS_AND_UPGRADE'))
})

test('no separate chat threads required -- one decomposeMultiAction call covers the whole multi-project message', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)
  assert.ok(entries.length >= 4)
})
