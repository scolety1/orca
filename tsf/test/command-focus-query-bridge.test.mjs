import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldRouteToFocusQueryBridge,
  respondFocusQueryCommand
} from '../server/command-focus-query-bridge.mjs'

const PROJECTS = [
  { id: 'nwr', displayName: 'Niners-War-Room' },
  { id: 'tsf-orca', displayName: 'TSF_ORCA' }
]

test("shouldRouteToFocusQueryBridge matches the mission's own example phrasings", () => {
  for (const message of [
    'What project are we talking about?',
    'what are we talking about?',
    'Which project is this?',
    'What are we working on?'
  ]) {
    assert.equal(shouldRouteToFocusQueryBridge(message), true, `failed for: "${message}"`)
  }
})

test('shouldRouteToFocusQueryBridge does not match an ordinary project-status question', () => {
  assert.equal(shouldRouteToFocusQueryBridge('What is NWR doing?'), false)
  assert.equal(shouldRouteToFocusQueryBridge("What's running right now?"), false)
})

test("respondFocusQueryCommand answers with the real focused project's display name", () => {
  const result = respondFocusQueryCommand({ focusProjectId: 'nwr', projects: PROJECTS })
  assert.match(result.text, /Niners-War-Room/)
  assert.deepEqual(result.resolvedProjectIds, ['nwr'])
  assert.equal(result.scope, 'PROJECT')
})

test('respondFocusQueryCommand refuses honestly when there is genuinely no focus yet -- never guesses', () => {
  const result = respondFocusQueryCommand({ focusProjectId: null, projects: PROJECTS })
  assert.match(result.text, /haven't focused/)
  assert.deepEqual(result.resolvedProjectIds, [])
})

test('respondFocusQueryCommand falls back to the bare id if the focused project has since left the catalog', () => {
  const result = respondFocusQueryCommand({ focusProjectId: 'gone-project', projects: PROJECTS })
  assert.match(result.text, /gone-project/)
})
