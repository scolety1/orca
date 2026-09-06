import assert from 'node:assert/strict'
import test from 'node:test'
import { isResearchMissionWorkItem } from './types.ts'

test('isResearchMissionWorkItem recognizes a real ResearchMissionWorkItem by its kind discriminant', () => {
  assert.equal(isResearchMissionWorkItem({ kind: 'RESEARCH_MISSION', missionId: 'm' }), true)
})

test('isResearchMissionWorkItem rejects a project-shaped item (no kind field)', () => {
  assert.equal(isResearchMissionWorkItem({ id: 'p', displayName: 'Project' }), false)
})

test('isResearchMissionWorkItem never throws on null/undefined/primitives', () => {
  assert.equal(isResearchMissionWorkItem(null), false)
  assert.equal(isResearchMissionWorkItem(undefined), false)
  assert.equal(isResearchMissionWorkItem('RESEARCH_MISSION'), false)
  assert.equal(isResearchMissionWorkItem(42), false)
})
