// Phase 3 continued (Command <-> Dataset Research bridge): conversational-
// context resolution (RESEARCH_CANCEL/RESEARCH_PAID_ADVISORY bare-message
// back-reference, explicit-id-outranks-stale-context, ambiguous-multiple-
// missions, empty-fleet false-positive) and research-specification
// synthesis via the live-planner bridge. Split out of
// command-research-bridge.test.mjs (which owns mission create/continue,
// paid-dispatch authorization, and status/completeness/conflicts/artifacts
// reads) purely to stay under this repo's own max-lines ceiling -- same
// isolated-state-file convention, same shared fixtures
// (test/fixtures/command-research-bridge-test-helpers.mjs), genuinely
// independent test file (its own STATE_FILE, its own process).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-research-bridge-context-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
// Same reasoning as command-research-bridge.test.mjs's own header: this
// machine has a real, working planner CLI available -- every test here
// that reaches mission-creation must explicitly refuse it (an unset/
// nonexistent override), or an ordinary test run would make a real,
// billable live-planner call.
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { classifyResearchIntent, respondResearchCommand } =
  await import('../server/command-research-bridge.mjs')
const { respondCommand } = await import('../server/command-responder.mjs')
const { createResearchMissionDurable, readActiveResearchPaidApproval, readResearchMissionStatus } =
  await import('../server/research-mission-driver.mjs')
const { EXA_PROVIDER_ID } = await import('../adapters/exa-research-worker.mjs')
const {
  CLOCK: clock,
  cleanupStateFile,
  clearAllResearchMissions,
  clearCommandThread,
  fieldSpec,
  freshOpState,
  persistCommandTurn,
  universe
} = await import('./fixtures/command-research-bridge-test-helpers.mjs')

cleanupStateFile(STATE_FILE)

const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

test('bridge: a genuinely under-specified research request asks ONE bounded clarification and creates nothing -- never claims anything started', async () => {
  const saved = {
    claude: process.env.TSF_PLANNER_CLAUDE_COMMAND,
    insufficient: process.env.STUB_RESEARCH_SPEC_INSUFFICIENT
  }
  process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
  process.env.STUB_RESEARCH_SPEC_INSUFFICIENT = '1'
  try {
    const reply = await respondCommand({
      message: 'research something genuinely too vague to synthesize',
      projects: [],
      opState: freshOpState(),
      clock
    })
    assert.doesNotMatch(reply.text, /Created|Started/)
    assert.match(reply.text, /stub: which specific years and fields/)
    assert.equal(
      reply.researchMissionId,
      null,
      'no mission may exist yet -- Tim must not be made to restate a request the system should have understood'
    )
  } finally {
    if (saved.claude === undefined) {
      delete process.env.TSF_PLANNER_CLAUDE_COMMAND
    } else {
      process.env.TSF_PLANNER_CLAUDE_COMMAND = saved.claude
    }
    if (saved.insufficient === undefined) {
      delete process.env.STUB_RESEARCH_SPEC_INSUFFICIENT
    } else {
      process.env.STUB_RESEARCH_SPEC_INSUFFICIENT = saved.insufficient
    }
  }
})

// Command architecture round 3: research follow-up gaps.
// Real free-path research execution finding (live proving run): naming the
// topic between the anchor words ("is the NFL salary cap research done?")
// previously matched neither RESEARCH_COMPLETENESS nor RESEARCH_ARTIFACTS,
// falling through to the bare "research" CREATE_OR_CONTINUE catch-all and
// hallucinating a fresh clarifying question for a mission that already
// exists and is already COMPLETE.
test('classifyResearchIntent: a named topic between the anchor words still resolves to the status/artifacts intents, not CREATE_OR_CONTINUE', () => {
  assert.equal(
    classifyResearchIntent('is the NFL salary cap research done?'),
    'RESEARCH_COMPLETENESS'
  )
  assert.equal(classifyResearchIntent('is the research done?'), 'RESEARCH_COMPLETENESS')
  assert.equal(
    classifyResearchIntent('what did the NFL salary cap research find?'),
    'RESEARCH_ARTIFACTS'
  )
  assert.equal(
    classifyResearchIntent('what sources did the NFL salary cap research use?'),
    'RESEARCH_ARTIFACTS'
  )
  assert.equal(
    classifyResearchIntent('is the build still running?'),
    null,
    'a non-research topic must still never match'
  )
})

test('classifyResearchIntent: the round-3 additions ("what\'s missing", "show me the evidence", "could Exa help?", "cancel it")', () => {
  assert.equal(classifyResearchIntent("what's missing?"), 'RESEARCH_COMPLETENESS')
  assert.equal(classifyResearchIntent('show me the evidence'), 'RESEARCH_ARTIFACTS')
  assert.equal(classifyResearchIntent('could Exa help?'), 'RESEARCH_PAID_ADVISORY')
  assert.equal(classifyResearchIntent('cancel it'), 'RESEARCH_CANCEL')
  assert.equal(classifyResearchIntent('cancel that'), 'RESEARCH_CANCEL')
})

test('RESEARCH_PAID_ADVISORY ("could Exa help?"): advisory only -- never grants or requests anything, mission state completely untouched', async () => {
  const missionId = 'mission:advisory-test'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: [
        {
          id: 'n1',
          nodeRole: 'PRIMARY_RESEARCH',
          targetEntity: { entityId: 'e1' },
          requestedFields: [{ fieldName: 'x', valueType: 'number', required: true }],
          requestedOutputSchema: { type: 'object' }
        }
      ]
    },
    clock
  )
  const before = readResearchMissionStatus(missionId)
  const opStateWithMission = { researchMissions: { [missionId]: before } }
  const reply = await respondResearchCommand({
    message: `could Exa help with ${missionId}?`,
    opState: opStateWithMission,
    clock
  })
  assert.equal(reply.intent, 'RESEARCH_PAID_ADVISORY')
  assert.equal(reply.live, false)
  const after = readResearchMissionStatus(missionId)
  assert.deepEqual(after, before, 'an advisory question must never mutate mission state')
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null)
})

test('RESEARCH_CANCEL ("cancel it"): really cancels the real durable mission (BLOCKED), and refuses honestly on an already-terminal mission', async () => {
  const missionId = 'mission:cancel-test'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  const opStateWithMission = {
    researchMissions: { [missionId]: readResearchMissionStatus(missionId) }
  }
  const reply = await respondResearchCommand({
    message: `for ${missionId}, cancel it`,
    opState: opStateWithMission,
    clock
  })
  assert.match(reply.text, /^Cancelled/)
  assert.equal(readResearchMissionStatus(missionId).state, 'BLOCKED')

  // Already terminal (BLOCKED has no further transitions this bridge
  // reaches for in this test -- COMPLETE is the real terminal case, proven
  // via the domain layer already; here we prove a SECOND cancel on the
  // same now-BLOCKED mission is refused honestly, not silently re-applied).
  const second = await respondResearchCommand({
    message: `for ${missionId}, cancel it`,
    opState: { researchMissions: { [missionId]: readResearchMissionStatus(missionId) } },
    clock
  })
  assert.match(second.text, /Couldn't cancel/)
})

test('RESEARCH_CANCEL: bare "cancel it" (no id in the message) resolves THIS CONVERSATION\'s own mission, even with other missions in the system', async () => {
  const missionId = 'mission:cancel-backref-test'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  // Establishes real conversational context first -- exactly what a real
  // Tim conversation does (ask about it, THEN say "cancel it") -- never
  // relying on raw system-wide recency (resolveMissionContext's own
  // header).
  const status = await respondResearchCommand({
    message: `research status for ${missionId}`,
    opState: freshOpState(),
    clock
  })
  assert.equal(status.researchMissionId, missionId)
  await persistCommandTurn(status)

  const reply = await respondResearchCommand({
    message: 'cancel it',
    opState: freshOpState(),
    clock
  })
  assert.match(reply.text, /^Cancelled/)
  assert.match(reply.text, new RegExp(missionId))
  assert.equal(readResearchMissionStatus(missionId).state, 'BLOCKED')
})

test('RESEARCH_CANCEL/RESEARCH_PAID_ADVISORY: with NO conversational context and MULTIPLE missions in the system, a bare "cancel it"/"could Exa help?" asks which one rather than guessing by raw recency', async () => {
  const a = 'mission:ambiguous-a'
  const b = 'mission:ambiguous-b'
  for (const id of [a, b]) {
    await createResearchMissionDurable(
      id,
      {
        projectId: 'test',
        specification: fieldSpec(['x']),
        expectedUniverse: universe('e1'),
        nodes: []
      },
      clock
    )
  }
  await clearCommandThread()
  const cancelReply = await respondResearchCommand({
    message: 'cancel it',
    opState: freshOpState(),
    clock
  })
  assert.match(cancelReply.text, /more than one research mission/i)
  assert.doesNotMatch(cancelReply.text, /^Cancelled/)

  const adviceReply = await respondResearchCommand({
    message: 'could Exa help?',
    opState: freshOpState(),
    clock
  })
  assert.match(adviceReply.text, /more than one research mission/i)
})

test('Gap 2: RESEARCH_STATUS turn -> bare "could Exa help?" resolves the mission JUST discussed, purely from conversational context (no id in either message)', async () => {
  const missionId = 'mission:advisory-after-status'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  await clearCommandThread()
  const status = await respondResearchCommand({
    message: `research status for ${missionId}`,
    opState: freshOpState(),
    clock
  })
  assert.equal(status.researchMissionId, missionId)
  await persistCommandTurn(status)

  const advice = await respondResearchCommand({
    message: 'could Exa help?',
    opState: freshOpState(),
    clock
  })
  assert.equal(advice.intent, 'RESEARCH_PAID_ADVISORY')
  assert.equal(advice.researchMissionId, missionId)
  assert.equal(advice.live, false)
  assert.equal(readActiveResearchPaidApproval(missionId, EXA_PROVIDER_ID, clock), null)
})

test('Gap 2: an EXPLICIT mission id in the message always outranks stale conversational context', async () => {
  const stale = 'mission:advisory-stale'
  const real = 'mission:advisory-real-target'
  await createResearchMissionDurable(
    stale,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  await createResearchMissionDurable(
    real,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  await clearCommandThread()
  const status = await respondResearchCommand({
    message: `research status for ${stale}`,
    opState: freshOpState(),
    clock
  })
  assert.equal(status.researchMissionId, stale)
  await persistCommandTurn(status)

  const advice = await respondResearchCommand({
    message: `could Exa help with ${real}?`,
    opState: freshOpState(),
    clock
  })
  assert.equal(
    advice.researchMissionId,
    real,
    'the explicitly-named mission wins over the stale context from the prior turn'
  )
})

test('Gap 2: no prior research context and no missions at all -> bounded clarification, never a guess at an unrelated project', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const advice = await respondResearchCommand({
    message: 'could Exa help?',
    opState: freshOpState(),
    clock
  })
  assert.equal(advice.researchMissionId, null)
  assert.doesNotMatch(
    advice.text,
    /more than one research mission/i,
    'zero missions is not the ambiguous-multiple case'
  )
  assert.match(advice.text, /no research mission yet/i)
})

// Adversarial-review finding, fixed: RESEARCH_ARTIFACTS/RESEARCH_STATUS/
// RESEARCH_COMPLETENESS/RESEARCH_CONFLICTS/RESEARCH_PAID_ADVISORY are
// deliberately broad, everyday phrasings (Bug 2/3/4's own fix) -- in a
// fleet that has NEVER created any research mission, one of these phrases
// used to permanently hijack the entire respondCommand reply into "no
// research mission yet" ahead of normal project/fleet resolution, since
// command-responder.mjs's gate ran before any project matching at all.
test('adversarial-review fix: research-follow-up phrasing never hijacks an ordinary Command message when this fleet has no research missions at all', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const noResearchOpState = freshOpState()
  const projects = [
    {
      id: 'build-project',
      displayName: 'Build Project',
      sourceClass: 'REAL',
      mission: { state: 'ONBOARDED', id: null, blockedReason: null },
      candidate: null,
      receipts: { chain: [] }
    }
  ]
  for (const message of [
    'paste it here',
    'is the build still running?',
    'what did it find',
    'how far along is it',
    'show me the results'
  ]) {
    const result = await respondCommand({ message, projects, opState: noResearchOpState, clock })
    assert.ok(
      !result.researchMissionId,
      `"${message}" must never resolve to a research mission when none exist`
    )
    assert.doesNotMatch(
      result.text,
      /no research mission yet/i,
      `"${message}" was wrongly hijacked into the research bridge's empty-fleet fallback`
    )
  }
})

// Same phrasings, but now a real mission genuinely exists -- proves the
// fix is precise: it suppresses the false positive without breaking the
// real Bug 2/3/4 follow-up routing this session's other tests already
// cover in depth.
test('adversarial-review fix, control: the same research-follow-up phrasing STILL routes to the research bridge once a real mission exists', async () => {
  await clearCommandThread()
  await clearAllResearchMissions()
  const missionId = 'mission:adversarial-review-control'
  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'test',
      specification: fieldSpec(['x']),
      expectedUniverse: universe('e1'),
      nodes: []
    },
    clock
  )
  const result = await respondCommand({
    message: 'paste it here',
    projects: [],
    opState: freshOpState(),
    clock
  })
  assert.equal(result.researchMissionId, missionId)
})
