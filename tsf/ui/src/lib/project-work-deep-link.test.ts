import assert from 'node:assert/strict'
import test from 'node:test'
import { projectDeepLinkTo, resolveProjectDetailTab } from './project-work-deep-link.ts'

test('no opts -> plain project route, unchanged prior behavior', () => {
  assert.equal(projectDeepLinkTo('proj-1'), '/projects/proj-1')
})

test('a known tab -> a query-string deep link, not a fabricated route', () => {
  assert.equal(projectDeepLinkTo('proj-1', { tab: 'keep-going' }), '/projects/proj-1?tab=keep-going')
})

test('an unknown tab is dropped, never a broken deep link', () => {
  assert.equal(projectDeepLinkTo('proj-1', { tab: 'nonexistent' }), '/projects/proj-1')
})

test('a runId is carried alongside the tab for future exact-run drill-down', () => {
  assert.equal(
    projectDeepLinkTo('proj-1', { tab: 'keep-going', runId: 'run-42' }),
    '/projects/proj-1?tab=keep-going&runId=run-42'
  )
})

test('resolveProjectDetailTab: null/missing -> overview', () => {
  assert.equal(resolveProjectDetailTab(null), 'overview')
})

test('resolveProjectDetailTab: a known tab passes through', () => {
  assert.equal(resolveProjectDetailTab('flight-recorder'), 'flight-recorder')
})

test('resolveProjectDetailTab: a garbage/hand-edited value falls back to overview, never crashes Tabs', () => {
  assert.equal(resolveProjectDetailTab('../../etc/passwd'), 'overview')
})
