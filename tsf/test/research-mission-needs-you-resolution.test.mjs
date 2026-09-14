// TSF Final Pre-UI P1 Closure V1, P1 #1: real, isolated coverage for
// resolveResearchNeedsYouDurable (server/research-mission-driver.mjs) --
// the durable wrapper around the existing, already-correct
// domain.resolveResearchNeedsYou. Split into its own file (not appended
// to research-mission-driver.test.mjs's own single large sequenced test)
// for isolation -- that file's MISSION_ID/state is shared across many
// nested subtests in one real dispatch-cycle narrative; this needs only a
// mission with a real open question, via the SAME real domain functions
// (createResearchMissionDurable + raiseResearchNeedsYou), never a second,
// hand-rolled fixture shape.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { raiseResearchNeedsYou } from '../domain/research-mission.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-research-needs-you-resolution-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createResearchMissionDurable, readResearchMissionStatus, resolveResearchNeedsYouDurable } =
  await import('../server/research-mission-driver.mjs')
const { withResearchMission, readResearchMission } =
  await import('../server/research-mission-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock'])
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const clock = () => new Date('2026-09-14T00:00:00.000Z')
let missionCounter = 0

async function missionWithOpenQuestion(question = 'which provider should I use?') {
  missionCounter += 1
  const missionId = `mission:needs-you-resolution-${missionCounter}`
  const specification = buildNflQb2001Specification()
  await createResearchMissionDurable(
    missionId,
    { projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse },
    clock
  )
  const raised = await withResearchMission(missionId, (m) =>
    raiseResearchNeedsYou(m, { question }, clock, m.revision)
  )
  const needsYouId = raised.needsYou[0].id
  return { missionId, needsYouId }
}

test('resolveResearchNeedsYouDurable: really resolves a real open question through the real durable store, restart-durable', async () => {
  const { missionId, needsYouId } = await missionWithOpenQuestion()
  assert.equal(readResearchMissionStatus(missionId).state, 'NEEDS_YOU')

  const resolved = await resolveResearchNeedsYouDurable(missionId, needsYouId, 'use Exa', clock)
  assert.equal(resolved.needsYou[0].resolution, 'use Exa')
  assert.equal(resolved.needsYou[0].resolvedAt, clock().toISOString())

  // The mission had exactly one open question -- resolving it must return
  // the mission to a resumable ACTIVE state (domain.resolveResearchNeedsYou's
  // own real behavior, verified here through the real durable wrapper).
  assert.equal(readResearchMissionStatus(missionId).state, 'ACTIVE')

  // Restart-durable: a fresh, independent read agrees.
  const reread = readResearchMission(missionId)
  assert.equal(reread.needsYou[0].resolution, 'use Exa')
  assert.equal(reread.state, 'ACTIVE')
})

test('resolveResearchNeedsYouDurable: an unknown mission id fails honestly, never silently succeeds', async () => {
  await assert.rejects(
    () => resolveResearchNeedsYouDurable('mission:does-not-exist', 'nq:1', 'x', clock),
    /unknown research mission/
  )
})

test('resolveResearchNeedsYouDurable: an unknown question id fails honestly, never silently succeeds', async () => {
  const { missionId } = await missionWithOpenQuestion()
  await assert.rejects(
    () => resolveResearchNeedsYouDurable(missionId, 'no-such-id', 'x', clock),
    /unknown Needs You question/
  )
})

test('resolveResearchNeedsYouDurable: omitted expectedRevision keeps the default -- a later answer freely replaces an earlier one', async () => {
  const { missionId, needsYouId } = await missionWithOpenQuestion()
  await resolveResearchNeedsYouDurable(missionId, needsYouId, 'first answer', clock)
  const second = await resolveResearchNeedsYouDurable(
    missionId,
    needsYouId,
    'second answer, no revision supplied',
    clock
  )
  assert.equal(second.needsYou[0].resolution, 'second answer, no revision supplied')
})

test('resolveResearchNeedsYouDurable: a supplied, stale expectedRevision is honestly rejected (TSF_STALE_REVISION), never silently overwritten', async () => {
  const { missionId, needsYouId } = await missionWithOpenQuestion()
  const staleRevision = readResearchMission(missionId).revision
  // A concurrent real resolution lands first, bumping the real revision.
  await resolveResearchNeedsYouDurable(missionId, needsYouId, 'concurrent answer', clock)
  await assert.rejects(
    () =>
      resolveResearchNeedsYouDurable(missionId, needsYouId, 'late answer', clock, staleRevision),
    (error) => {
      assert.match(error.message, /stale revision/)
      assert.equal(error.code, 'TSF_STALE_REVISION')
      return true
    }
  )
  // The concurrent (first) answer is still the real, durable one.
  assert.equal(readResearchMission(missionId).needsYou[0].resolution, 'concurrent answer')
})

test("resolveResearchNeedsYouDurable: an already-resolved question can be answered again (no once-only guard by design, matching resolveProjectNeedsYou/resolveKeepGoingNeedsYou's own precedent) -- every duplicate resolution genuinely succeeds and overwrites", async () => {
  const { missionId, needsYouId } = await missionWithOpenQuestion()
  await resolveResearchNeedsYouDurable(missionId, needsYouId, 'first answer', clock)
  const second = await resolveResearchNeedsYouDurable(missionId, needsYouId, 'answer again', clock)
  assert.equal(second.needsYou[0].resolution, 'answer again')
})

test('resolveResearchNeedsYouDurable: one Research question resolved while another remains -- the mission stays NEEDS_YOU, the unresolved question is untouched', async () => {
  const { missionId, needsYouId: firstId } = await missionWithOpenQuestion('question one?')
  const raisedAgain = await withResearchMission(missionId, (m) =>
    raiseResearchNeedsYou(m, { question: 'question two?' }, clock, m.revision)
  )
  const secondId = raisedAgain.needsYou[1].id

  await resolveResearchNeedsYouDurable(missionId, firstId, 'answer one', clock)
  assert.equal(
    readResearchMissionStatus(missionId).state,
    'NEEDS_YOU',
    'a second real open question remains -- must not resume prematurely'
  )
  const mid = readResearchMission(missionId)
  assert.equal(mid.needsYou.find((n) => n.id === firstId).resolution, 'answer one')
  assert.equal(mid.needsYou.find((n) => n.id === secondId).resolvedAt, null)

  await resolveResearchNeedsYouDurable(missionId, secondId, 'answer two', clock)
  assert.equal(
    readResearchMissionStatus(missionId).state,
    'ACTIVE',
    'the LAST open question resolved -- now resumable'
  )
})
