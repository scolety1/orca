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

// REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed): TWO exact project
// names in the same message previously collapsed into the SAME branch as
// "zero named" (both produced namedProjectId === null), silently falling
// back to whichever project happened to be focused -- even though the
// owner explicitly named two DIFFERENT projects, neither necessarily the
// focused one.
test('resolveNeedsYouAnswerTarget: TWO exact project names in the same message refuse -- never silently fall back to focus', () => {
  const result = resolveNeedsYouAnswerTarget('Answer NWR or TSF, option two.', {
    openItems: [item('a', 'nwr'), item('b', 'tsf')],
    turnTargetProjectIds: ['nwr', 'tsf'],
    mentionedProjectIds: ['nwr', 'tsf'],
    focusProjectId: 'nwr'
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'AMBIGUOUS')
})

// REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed): the bridge strips
// fuzzy matches before ever reaching this function, so a message that only
// FUZZILY names a different real project than the current focus used to
// look identical to "nothing named at all" and silently resolved against
// focus -- e.g. focus is VOICE-ALPHA, the owner says "answer the alpha two
// question", VOICE-ALPHA-TWO only fuzzy-matches, and the wrong project
// (VOICE-ALPHA) got answered instead.
test('resolveNeedsYouAnswerTarget: a fuzzy-only mention of a DIFFERENT project than focus refuses -- never silently answers the focused project instead', () => {
  const result = resolveNeedsYouAnswerTarget('Answer the alpha two question with option two.', {
    openItems: [item('a', 'voice-alpha'), item('b', 'voice-alpha-two')],
    turnTargetProjectIds: [], // "alpha two" only fuzzy-matched, stripped by the bridge
    mentionedProjectIds: ['voice-alpha-two'], // but still real, un-droppable evidence
    focusProjectId: 'voice-alpha'
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'AMBIGUOUS')
})

test('resolveNeedsYouAnswerTarget: a fuzzy mention of the SAME project as focus still resolves via focus -- the new guard only blocks a DIFFERENT mention', () => {
  const result = resolveNeedsYouAnswerTarget('Answer it, option two.', {
    openItems: [item('a', 'voice-alpha')],
    turnTargetProjectIds: [],
    mentionedProjectIds: ['voice-alpha'],
    focusProjectId: 'voice-alpha'
  })
  assert.equal(result.ok, true)
  assert.equal(result.item.id, 'a')
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
