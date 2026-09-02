// TSF Command Authority + Project Resolution regression matrix. Permanent
// coverage for the real gaps this repair closed (see project-name-resolver.mjs,
// domain/project-aliases.mjs, chat-responder.mjs's DISPATCH_REQUEST pattern) --
// alias resolution, infra-mention false-positive targeting, negation-scoped
// exclusion, and the authorization-loop (an explicit, named-project
// confirmation must dispatch once, never require repeated asking, and must
// never leak scope to another project or a more consequential action class).
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'
import { respondCommand } from '../server/command-responder.mjs'
import { classifyIntent, classifyDecision } from '../server/chat-responder.mjs'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'

// Real catalog ids/displayNames as actually onboarded today
// (tsf/server/.local-state/operator-state.json) -- not invented.
const REAL_PROJECTS = [
  { id: 'tsf-orca', displayName: 'TSF_ORCA' },
  { id: 'niners-war-room', displayName: 'Niners-War-Room' },
  {
    id: 'worldforge-sablewake-live-runtime-repair-v3',
    displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3'
  }
]

function ids(matches) {
  return matches.map((m) => m.project.id)
}

test('ALIAS: "Nytheria" resolves to the canonical WorldForge project -- real recorded operator phrasing', () => {
  const { matches } = resolveProjectsFromText(
    'can you get nytheria ready for an overnight run',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(matches[0].matchedOn, 'alias')
})

test('ALIAS: "WorldForge" (the canonical name itself) also resolves via the alias table', () => {
  const { matches } = resolveProjectsFromText('status on worldforge please', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
})

test('ALIAS: "NWR" resolves to Niners War Room', () => {
  const { matches } = resolveProjectsFromText('go ahead and fix NWR', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['niners-war-room'])
  assert.equal(matches[0].matchedOn, 'alias')
})

test('ALIAS: the multi-word alias "niners war room" resolves too, not just the NWR acronym', () => {
  const { matches } = resolveProjectsFromText('what is niners war room doing right now', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['niners-war-room'])
})

test('ALIAS: case-insensitive -- "NYTHERIA" in caps still resolves', () => {
  const { matches } = resolveProjectsFromText('ship NYTHERIA overnight', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
})

test('ALIAS: an alias match is exact-tier, eligible for a real dispatch (not downgraded to fuzzy)', async () => {
  const projects = REAL_PROJECTS.map((p) => ({
    ...p,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }))
  const result = await respondCommand({
    message: 'go ahead and fix NWR',
    projects,
    opState: { keepGoingRuns: {} },
    clock: () => new Date('2026-09-02T00:00:00.000Z'),
    deps: { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }
  })
  assert.deepEqual(result.resolvedProjectIds, ['niners-war-room'])
  assert.ok(result.dispatchResults, 'alias match triggered a real dispatch attempt')
})

test('TARGETING/INFRA-MENTION: generic "use TSF/Orca" tooling phrasing never targets the tsf-orca project', () => {
  const { matches } = resolveProjectsFromText("what's the status? use TSF/Orca to check.", REAL_PROJECTS)
  assert.deepEqual(matches, [])
})

test('TARGETING/INFRA-MENTION: the same message still targets a real project named alongside the infra mention', () => {
  const { matches } = resolveProjectsFromText(
    'use TSF/Orca to check niners-war-room status',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['niners-war-room'])
})

test('TARGETING/INFRA-MENTION: a literal id/displayName mention of tsf-orca still resolves normally -- the guard only suppresses the generic-usage fuzzy path', () => {
  const { matches } = resolveProjectsFromText('why is tsf-orca failing to build?', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
  assert.equal(matches[0].matchedOn, 'id')
})

test('NEGATION: "not tsf-orca" excludes tsf-orca while still targeting the named project', () => {
  const { matches } = resolveProjectsFromText(
    'go ahead and fix niners-war-room, not tsf-orca',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['niners-war-room'])
})

test('NEGATION: "except" and "don\'t touch" both exclude the named project', () => {
  const exceptResult = resolveProjectsFromText(
    'get everything ready, except tsf-orca',
    REAL_PROJECTS
  )
  assert.equal(ids(exceptResult.matches).includes('tsf-orca'), false)

  const dontTouchResult = resolveProjectsFromText(
    "don't touch tsf-orca, just fix niners-war-room",
    REAL_PROJECTS
  )
  assert.deepEqual(ids(dontTouchResult.matches), ['niners-war-room'])
})

test('NEGATION: a negation word describing STATE, not exclusion, does not falsely suppress the real target', () => {
  const { matches } = resolveProjectsFromText("why isn't tsf-orca working?", REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('NEGATION: an alias can be negated too -- "not NWR" excludes Niners War Room', () => {
  const { matches } = resolveProjectsFromText(
    'go ahead and fix tsf-orca, not NWR',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('AUTHORIZATION-LOOP: an explicit named-project confirmation classifies as DISPATCH_REQUEST, not GENERAL', () => {
  assert.equal(classifyIntent('yes, proceed with niners-war-room'), 'DISPATCH_REQUEST')
  assert.equal(classifyIntent('proceed with alpha-widgets'), 'DISPATCH_REQUEST')
  // Pronoun form (the original, narrower pattern) still works -- broadening
  // never regressed the existing behavior.
  assert.equal(classifyIntent('proceed with it'), 'DISPATCH_REQUEST')
})

test('AUTHORIZATION-LOOP: a consequential keyword still overrides the confirmation phrasing -- broadening intent recognition never bypasses TIM_REQUIRED', () => {
  assert.equal(
    classifyDecision('yes, proceed with pushing this to production', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
})

test('AUTHORIZATION-LOOP: an explicit, named-project confirmation is consumed once and dispatches immediately -- no repeated asking', async () => {
  const projects = [
    {
      id: 'alpha-widgets',
      displayName: 'Alpha Widgets',
      mission: { state: 'ONBOARDED', id: null, blockedReason: null },
      candidate: null,
      receipts: { chain: [] }
    }
  ]
  const result = await respondCommand({
    message: 'yes, proceed with alpha-widgets',
    projects,
    opState: { keepGoingRuns: {} },
    clock: () => new Date('2026-09-02T00:00:00.000Z'),
    deps: { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.ok(result.dispatchResults, 'the confirmation alone triggered a real dispatch attempt')
})

test('AUTHORIZATION-LOOP: scope never leaks -- confirming exactly one project dispatches ONLY that project, even with an unrelated fuzzy co-match in the same message', async () => {
  const projects = [
    {
      id: 'alpha-widgets',
      displayName: 'Alpha Widgets',
      mission: { state: 'ONBOARDED', id: null, blockedReason: null },
      candidate: null,
      receipts: { chain: [] }
    },
    {
      id: 'alpha-gadgets',
      displayName: 'Alpha Gadgets',
      mission: { state: 'ONBOARDED', id: null, blockedReason: null },
      candidate: null,
      receipts: { chain: [] }
    }
  ]
  const result = await respondCommand({
    message: 'yes, proceed with alpha-widgets and also the gadgets alpha thing',
    projects,
    opState: { keepGoingRuns: {} },
    clock: () => new Date('2026-09-02T00:00:00.000Z'),
    deps: { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.deepEqual(result.dispatchResults.map((r) => r.projectId), ['alpha-widgets'])
})

test('AUTHORIZATION-LOOP: self-repair authorization never leaks to a project reached only via an alias for a DIFFERENT project', () => {
  // Real defense already in domain/self-repair-authority.mjs (selfRepairProjectId
  // must equal the resolved project's own id) -- pinned again here at the
  // alias-resolution boundary specifically: an alias resolving to some other
  // real project id must not accidentally satisfy a self-repair check scoped
  // to tsf-orca.
  const authorized = isAuthorizedSelfRepair({
    toggleOn: true,
    matchedOn: 'alias',
    decisionClass: 'AUTO_DECIDE',
    projectId: 'niners-war-room', // what "NWR" actually resolves to
    selfRepairProjectId: 'tsf-orca'
  })
  assert.equal(authorized, false)
})

test('AUTHORIZATION-LOOP: authorization for Project A never leaks to Project B in the same multi-project dispatch', async () => {
  // TIM_REQUIRED is recomputed fresh per message with no cross-message or
  // cross-project state (command-responder.mjs/chat-responder.mjs) -- pinned
  // here as an explicit regression: a consequential clause naming one
  // project must not clear a batch containing an unrelated one.
  const result = await respondCommand({
    message: 'go ahead and fix niners-war-room, and push tsf-orca to production',
    projects: [
      {
        id: 'niners-war-room',
        displayName: 'Niners-War-Room',
        mission: { state: 'ONBOARDED', id: null, blockedReason: null },
        candidate: null,
        receipts: { chain: [] }
      },
      {
        id: 'tsf-orca',
        displayName: 'TSF_ORCA',
        mission: { state: 'ONBOARDED', id: null, blockedReason: null },
        candidate: null,
        receipts: { chain: [] }
      }
    ],
    opState: { keepGoingRuns: {} },
    clock: () => new Date('2026-09-02T00:00:00.000Z')
  })
  assert.equal(result.decisionClass, 'TIM_REQUIRED')
  assert.equal(result.dispatchResults, undefined, 'no project was dispatched to -- the whole message is refused')
})
