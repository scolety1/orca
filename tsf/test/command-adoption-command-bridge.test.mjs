// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: Command
// <-> adoption-execution bridge coverage. deps.executeCommandAdoption is
// stubbed here (the real engine already has its own real-fixture-repo
// golden-proof coverage in command-adoption-execution-server.test.mjs) --
// this file proves the CHAT-FACING wiring: explicit vs ambiguous
// classification, single-project resolution, and referring-phrase
// resolution against a prior turn's real resultItems.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  respondAdoptionCommand,
  shouldRouteToAdoptionCommandBridge
} from '../server/command-adoption-command-bridge.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const project = (id, displayName) => ({ id, displayName })

test('shouldRouteToAdoptionCommandBridge: only messages carrying real adoption verbs route here', () => {
  assert.equal(shouldRouteToAdoptionCommandBridge('adopt the Nytheria run'), true)
  assert.equal(shouldRouteToAdoptionCommandBridge('what is ready?'), false)
  assert.equal(shouldRouteToAdoptionCommandBridge('looks good'), false)
})

// Proof 2: ambiguous adoption language -> NEEDS_OWNER-shaped honest
// response, never a guess.
test('respondAdoptionCommand: ambiguous phrasing returns a NEEDS_OWNER-shaped refusal, never a guess', async () => {
  const result = await respondAdoptionCommand({
    message: 'should I adopt the Nytheria run?',
    exactMatchProjects: [project('worldforge', 'WorldForge')],
    projects: [project('worldforge', 'WorldForge')],
    clock,
    deps: { executeCommandAdoption: async () => { throw new Error('must never be called for ambiguous phrasing') } }
  })
  assert.equal(result.decisionClass, 'NEEDS_OWNER')
  assert.match(result.text, /won't guess/)
})

test('respondAdoptionCommand: a message with no adoption verb at all returns null, letting the caller fall through', async () => {
  const result = await respondAdoptionCommand({
    message: 'what is ready?',
    exactMatchProjects: [],
    projects: [],
    clock,
    deps: {}
  })
  assert.equal(result, null)
})

test('respondAdoptionCommand: explicit intent + exact project match calls the real engine and reports a successful adoption', async () => {
  let calledWith = null
  const worldforge = project('worldforge', 'WorldForge')
  const result = await respondAdoptionCommand({
    message: 'adopt the WorldForge run',
    exactMatchProjects: [worldforge],
    projects: [worldforge],
    clock,
    deps: {
      executeCommandAdoption: async ({ project: p }) => {
        calledWith = p
        return { ok: true, alreadyIncluded: false, priorCanonicalSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), resultingCanonicalSha: 'b'.repeat(40), receipt: { receiptHash: 'c'.repeat(64) } }
      }
    }
  })
  assert.equal(calledWith.id, 'worldforge')
  assert.match(result.text, /adopted/)
  assert.equal(result.resolvedProjectIds[0], 'worldforge')
})

test('respondAdoptionCommand: explicit intent + exact project match reports a real refusal honestly, never claims success', async () => {
  const worldforge = project('worldforge', 'WorldForge')
  const result = await respondAdoptionCommand({
    message: 'adopt the WorldForge run',
    exactMatchProjects: [worldforge],
    projects: [worldforge],
    clock,
    deps: {
      executeCommandAdoption: async () => ({ ok: false, reason: 'NOT_READY_FOR_ADOPTION', detail: 'state is ACTIVE, requires COMPLETE' })
    }
  })
  assert.match(result.text, /couldn't adopt/)
  assert.match(result.text, /NOT_READY_FOR_ADOPTION/)
})

// "adopt both of those" -- no project named in THIS message; resolves via
// the prior turn's real resultItems (command-referent-resolution.mjs).
test('respondAdoptionCommand: "adopt both of those" resolves via referent resolution against the prior turn\'s real resultItems', async () => {
  const worldforge = project('worldforge', 'WorldForge')
  const nwr = project('niners-war-room', 'Niners War Room')
  const priorResultItems = [
    { id: 'run:worldforge:readyForAdoption', category: 'READY_FOR_ADOPTION', label: 'WorldForge', project: { id: 'worldforge', displayName: 'WorldForge' }, reason: 'ready' },
    { id: 'run:niners-war-room:readyForAdoption', category: 'READY_FOR_ADOPTION', label: 'Niners War Room', project: { id: 'niners-war-room', displayName: 'Niners War Room' }, reason: 'ready' }
  ]
  const calledProjectIds = []
  const result = await respondAdoptionCommand({
    message: 'adopt both of those',
    exactMatchProjects: [],
    priorResultItems,
    projects: [worldforge, nwr],
    clock,
    deps: {
      executeCommandAdoption: async ({ project: p }) => {
        calledProjectIds.push(p.id)
        return { ok: true, alreadyIncluded: true, priorCanonicalSha: 'a'.repeat(40), candidateSha: 'a'.repeat(40), resultingCanonicalSha: 'a'.repeat(40), receipt: { receiptHash: 'c'.repeat(64) } }
      }
    }
  })
  assert.deepEqual(new Set(calledProjectIds), new Set(['worldforge', 'niners-war-room']))
  assert.equal(result.scope, 'MULTI_PROJECT')
})

test('respondAdoptionCommand: explicit intent, no exact match, no resolvable referent -- asks rather than guesses', async () => {
  const result = await respondAdoptionCommand({
    message: 'adopt it',
    exactMatchProjects: [],
    priorResultItems: [],
    projects: [],
    clock,
    deps: { executeCommandAdoption: async () => { throw new Error('must never be called with no resolvable target') } }
  })
  assert.equal(result.decisionClass, 'NEEDS_OWNER')
  assert.match(result.text, /can't tell which candidate/)
})
