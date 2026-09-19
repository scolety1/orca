import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextCommandFocus,
  isExplicitSwitchMessage,
  isGoBackMessage,
  RECENT_PROJECT_STACK_CAP
} from '../domain/command-conversation-focus.mjs'

const clock = () => new Date('2026-09-19T00:00:00.000Z')

test('nextCommandFocus: first focus-setting turn ("Let\'s work on NWR") sets focus from null', () => {
  const next = nextCommandFocus(
    null,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, [])
})

test('nextCommandFocus: dispatch-worthy message naming a project sets focus AND is a real turn target ("Research waiver mechanics...")', () => {
  const next = nextCommandFocus(
    { focusProjectId: null, recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
})

test('isExplicitSwitchMessage: a natural spoken correction ("No, I meant X") is recognized -- real dogfood-round-1 finding', () => {
  assert.equal(isExplicitSwitchMessage('No, I meant VOICE-ALPHA.'), true)
  assert.equal(isExplicitSwitchMessage('I meant the other one.'), true)
})

test('nextCommandFocus: a correction phrasing moves focus given a real single exact target, same as an explicit switch', () => {
  const next = nextCommandFocus(
    { focusProjectId: null, recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['voice-alpha'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'voice-alpha')
})

test('nextCommandFocus: explicit switch moves focus and pushes the old focus onto the stack ("switch to TSF")', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'nwr', recentProjectStack: [], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['tsf'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: AUTO_DECIDE status question naming a project does NOT move focus ("How is NWR doing?" while focus is TSF)', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'tsf', recentProjectStack: ['nwr'], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: false },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: "go back to NWR" explicitly returns to that project and pushes the old focus', () => {
  const next = nextCommandFocus(
    { focusProjectId: 'tsf', recentProjectStack: ['nwr'], updatedAt: clock().toISOString() },
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['tsf'])
})

test('nextCommandFocus: bare "go back" (no target) pops the most recent stack entry and re-pushes the old focus', () => {
  const next = nextCommandFocus(
    {
      focusProjectId: 'tsf',
      recentProjectStack: ['nwr', 'other'],
      updatedAt: clock().toISOString()
    },
    { turnTargetProjectIds: [], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['tsf', 'other'])
})

test('nextCommandFocus: "go back" with an empty stack is an honest no-op, never fabricates a target', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: [],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: [], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, [])
})

test('nextCommandFocus: no turn targets at all leaves focus and stack completely unchanged (ordinary continuation)', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: ['nwr'],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: [], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
  assert.deepEqual(next.recentProjectStack, ['nwr'])
})

test('nextCommandFocus: multiple exact turn targets never guess a focus switch out of ambiguity', () => {
  const before = {
    focusProjectId: 'tsf',
    recentProjectStack: [],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: ['nwr', 'other'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'tsf')
})

test('nextCommandFocus: dispatch-worthy message naming the ALREADY-focused project leaves the stack untouched (no self-push)', () => {
  const before = {
    focusProjectId: 'nwr',
    recentProjectStack: ['other'],
    updatedAt: '2026-09-18T00:00:00.000Z'
  }
  const next = nextCommandFocus(
    before,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(next.focusProjectId, 'nwr')
  assert.deepEqual(next.recentProjectStack, ['other'])
})

test('nextCommandFocus: recentProjectStack never exceeds its cap and never duplicates a project id', () => {
  let focus = { focusProjectId: 'p0', recentProjectStack: [], updatedAt: clock().toISOString() }
  for (let i = 1; i <= RECENT_PROJECT_STACK_CAP + 3; i++) {
    focus = nextCommandFocus(
      focus,
      { turnTargetProjectIds: [`p${i}`], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
      clock
    )
  }
  assert.ok(focus.recentProjectStack.length <= RECENT_PROJECT_STACK_CAP)
  assert.equal(new Set(focus.recentProjectStack).size, focus.recentProjectStack.length)
})

test("the mission's own full worked-example sequence, chained end to end", () => {
  let focus = null

  // "Let's work on Niners War Room." -> focus = NWR
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')

  // "Research waiver mechanics using these formulas..." -> target/focus = NWR (already focused, no-op)
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'RECOMMEND_AND_PROCEED' },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')

  // "Okay, switch to Thousand Sunny Fleet." -> focus = TSF
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['tsf'], decisionClass: 'AUTO_DECIDE', isExplicitSwitch: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'tsf')
  assert.deepEqual(focus.recentProjectStack, ['nwr'])

  // "How is NWR doing?" -> answer NWR status, but focus remains TSF
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE' },
    clock
  )
  assert.equal(focus.focusProjectId, 'tsf')

  // "Go back to NWR." -> focus = NWR
  focus = nextCommandFocus(
    focus,
    { turnTargetProjectIds: ['nwr'], decisionClass: 'AUTO_DECIDE', isGoBack: true },
    clock
  )
  assert.equal(focus.focusProjectId, 'nwr')
  assert.deepEqual(focus.recentProjectStack, ['tsf'])
})

test("isExplicitSwitchMessage matches the mission's own example phrasings", () => {
  assert.equal(isExplicitSwitchMessage("Let's work on Niners War Room."), true)
  assert.equal(isExplicitSwitchMessage('Okay, switch to Thousand Sunny Fleet.'), true)
  assert.equal(isExplicitSwitchMessage('Okay, switch over to Thousand Sunny Fleet.'), true)
  assert.equal(isExplicitSwitchMessage('How is NWR doing?'), false)
})

test('isGoBackMessage matches "go back" and "go back to X", nothing else', () => {
  assert.equal(isGoBackMessage('Go back to NWR.'), true)
  assert.equal(isGoBackMessage('go back'), true)
  assert.equal(isGoBackMessage('How is NWR doing?'), false)
})
