import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNeedsYouAnswerTarget } from '../domain/command-needs-you-answer-targeting.mjs'

function item(id, projectId, source = 'PROJECT') {
  return { source, id, question: `Question ${id}`, projectId, label: projectId }
}

test('resolveNeedsYouAnswerTarget: refuses honestly when nothing is open at all', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the NWR question with option two.', {
    openItems: []
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NONE_OPEN')
})

test('resolveNeedsYouAnswerTarget: a named project with exactly one open item resolves to it', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the NWR question with option two.', {
    openItems: [item('a', 'nwr'), item('b', 'tsf')],
    turnTargetProjectIds: ['nwr']
  })
  assert.equal(result.ok, true)
  assert.equal(result.item.id, 'a')
})

test('resolveNeedsYouAnswerTarget: a named project with MULTIPLE open items refuses -- never guesses', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the NWR question.', {
    openItems: [item('a', 'nwr'), item('b', 'nwr')],
    turnTargetProjectIds: ['nwr']
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'AMBIGUOUS')
})

test('resolveNeedsYouAnswerTarget: a named project with NO open items refuses honestly', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the TSF question.', {
    openItems: [item('a', 'nwr')],
    turnTargetProjectIds: ['tsf']
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NO_MATCH')
})

test('resolveNeedsYouAnswerTarget: "Yes, authorize it" with no named project resolves via the currently-focused project\'s single open item', () => {
  const result = resolveNeedsYouAnswerTarget('Yes, authorize it.', {
    openItems: [item('a', 'nwr'), item('b', 'tsf')],
    turnTargetProjectIds: [],
    focusProjectId: 'nwr'
  })
  assert.equal(result.ok, true)
  assert.equal(result.item.id, 'a')
})

test('resolveNeedsYouAnswerTarget: no named project, no focus at all -- refuses even with exactly one open item in the whole fleet', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the question with option two.', {
    openItems: [item('a', 'nwr')],
    turnTargetProjectIds: [],
    focusProjectId: null
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'AMBIGUOUS')
})

test('resolveNeedsYouAnswerTarget: no named project, focus set but the focused project itself has multiple open items -- refuses', () => {
  const result = resolveNeedsYouAnswerTarget('Option two.', {
    openItems: [item('a', 'nwr'), item('b', 'nwr')],
    turnTargetProjectIds: [],
    focusProjectId: 'nwr'
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'AMBIGUOUS')
})

test('resolveNeedsYouAnswerTarget: a research-source open item is targetable exactly like a project-source one', () => {
  const result = resolveNeedsYouAnswerTarget('Yes, authorize it.', {
    openItems: [item('a', 'nwr', 'RESEARCH')],
    turnTargetProjectIds: [],
    focusProjectId: 'nwr'
  })
  assert.equal(result.ok, true)
  assert.equal(result.item.source, 'RESEARCH')
})
