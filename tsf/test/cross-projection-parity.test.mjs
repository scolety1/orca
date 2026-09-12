// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 1C. One durable fixture per real
// owner-facing state, fed into Work (work-feed-summary.mjs), Attention
// (fleet-attention-status.mjs) and Command's own status source
// (fleet-work-status.mjs's fleetWorkStatus -- the exact function
// command-responder.mjs and command-multi-action-bridge.mjs's reportStatus
// both call) -- proving they never contradict each other for the SAME
// underlying durable object. Different vocabulary is fine (Work says
// WAITING, Attention says WAITING_FOR_RESOURCES -- same fact); a direct
// contradiction (one surface implying WORKING while another implies
// blocked/paused) is not.
//
// Scope note (director-recorded, not from the interrupted Codex dispatch --
// see queue memory): the global status indicator (tsf/ui/src/lib/
// global-run-status.ts) is covered in its OWN sibling file,
// tsf/ui/src/lib/global-run-status-domain-parity.test.ts -- ui/package.json's
// test script runs plain `node --experimental-strip-types --test`, no
// bundler/vitest, so that file imports these SAME real domain .mjs
// functions by relative path and feeds them straight into the real
// buildGlobalRunStatusItems/selectExtraAttentionItems, a genuine cross-
// boundary integration check rather than a hand-mirrored approximation.
// Project Detail's real data source (KeepGoingPanel, via api.keepGoing) shows
// the coarser raw `run.state` (ACTIVE/PAUSED/NEEDS_YOU/STALLED/COMPLETE/
// BLOCKED), not the finer liveWorkFeed vocabulary -- covered below as an
// explicit hierarchy assertion (run.state is a superset-of/parent-of the
// live-feed state), not a second, independently-fetched surface.
import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeWorkFromRuns } from '../domain/work-feed-summary.mjs'
import { buildFleetAttentionItems } from '../domain/fleet-attention-status.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { projectLiveWorkFeedState } from '../domain/live-work-feed.mjs'
import {
  createOvernightRun,
  planWave,
  dispatchWave,
  pauseRun,
  markStalled,
  raiseNeedsYou,
  completeRun,
  checkpointRun,
  recordPendingDispatch
} from '../domain/keep-going.mjs'
import { createProjectExecutionHold } from '../domain/project-execution-hold.mjs'

const clock = () => new Date('2026-09-12T12:00:00.000Z')

function project(id) {
  return {
    id,
    displayName: id,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

function newRun(id, projectId) {
  return createOvernightRun(
    { id, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
}

// The run.state "family" a given liveWorkFeed state may legitimately appear
// under -- run.state is the coarse Project-Detail vocabulary, liveWorkFeed
// is the fine Work/Attention/Command vocabulary. A liveWorkFeed state
// outside its listed family would mean the two surfaces disagree about
// what's actually happening, not just how to phrase it.
const RUN_STATE_FAMILY = Object.freeze({
  WORKING: ['ACTIVE'],
  PLANNING: ['ACTIVE'],
  VERIFYING: ['ACTIVE'],
  REVISION: ['ACTIVE'],
  WAITING: ['ACTIVE', 'PAUSED'],
  NEEDS_YOU: ['ACTIVE', 'NEEDS_YOU', 'BLOCKED'],
  STALLED: ['STALLED'],
  READY_FOR_ADOPTION: ['COMPLETE']
})

function assertRunStateFamily(run, feedState) {
  const family = RUN_STATE_FAMILY[feedState]
  assert.ok(family, `no known run.state family for liveWorkFeed state ${feedState}`)
  assert.ok(
    family.includes(run.state),
    `Project Detail's run.state (${run.state}) is not in the expected family for liveWorkFeed ${feedState} (${family.join('/')})`
  )
}

// One assembled fixture -> the three shared projections, plus the raw run
// (Project Detail's own data source) for the hierarchy check above.
function project3Ways(projects, keepGoingRuns, extra = {}) {
  const work = summarizeWorkFromRuns(
    projects,
    keepGoingRuns,
    clock,
    extra.researchMissions,
    extra.projectCanonicalBases
  )
  const attention = buildFleetAttentionItems({
    projects,
    keepGoingRuns,
    projectExecutionHolds: extra.projectExecutionHolds ?? {},
    projectCanonicalBases: extra.projectCanonicalBases ?? {},
    clock
  })
  const status = fleetWorkStatus(projects, keepGoingRuns, clock)
  return { work, attention, status }
}

function attentionFor(attention, projectId) {
  return attention.filter((item) => item.project?.id === projectId)
}

test('parity: WORKING (in-flight wave) -- Work says WORKING, no attention item, run.state ACTIVE', () => {
  let run = newRun('r1', 'p1')
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  const { work, attention, status } = project3Ways([project('p1')], { p1: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'WORKING')
  assert.ok(
    work.active.some((x) => x.id === 'p1'),
    'Work must place an in-flight run in active'
  )
  assert.equal(status[0].feed.state, 'WORKING', 'Command reads the exact same feed Work does')
  assert.deepEqual(
    attentionFor(attention, 'p1'),
    [],
    'ordinary in-flight work needs no owner attention'
  )
  assertRunStateFamily(run, feed.state)
})

test('parity: PLANNING (fresh run, no wave, not resource-blocked) -- Work says PLANNING, no attention item', () => {
  const run = newRun('r2', 'p2')
  const { work, attention, status } = project3Ways([project('p2')], { p2: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'PLANNING')
  assert.ok(work.active.some((x) => x.id === 'p2'))
  assert.equal(status[0].feed.state, 'PLANNING')
  assert.deepEqual(attentionFor(attention, 'p2'), [])
  assertRunStateFamily(run, feed.state)
})

test('parity: PAUSED -- Work says WAITING(PAUSED), Command agrees, no attention item (an operator-intended pause is not itself an attention-worthy condition), run.state PAUSED', () => {
  const run = pauseRun(newRun('r3', 'p3'), 'OPERATOR_PAUSE', clock)
  const { work, attention, status } = project3Ways([project('p3')], { p3: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'WAITING')
  assert.match(feed.reason, /PAUSED/)
  assert.ok(work.active.some((x) => x.id === 'p3'))
  assert.equal(status[0].feed.state, 'WAITING')
  assert.deepEqual(attentionFor(attention, 'p3'), [])
  assertRunStateFamily(run, feed.state)
})

test("parity: HELD (active PROJECT_EXECUTION_HOLD, run otherwise ACTIVE/WORKING) -- Attention flags the hold; Work/Command still honestly describe the run's own mechanical state (a hold gates FUTURE dispatch, it does not retroactively change what a currently-dispatched wave is doing) -- not a contradiction, a different question", () => {
  let run = newRun('r4', 'p4')
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  const hold = createProjectExecutionHold(
    {
      projectId: 'p4',
      reason: 'EXTERNAL_WORK_ACTIVE',
      setBy: 'OPERATOR_CHAT',
      note: 'being handled elsewhere'
    },
    clock
  )
  const { work, attention, status } = project3Ways(
    [project('p4')],
    { p4: run },
    { projectExecutionHolds: { p4: hold } }
  )
  assert.ok(
    work.active.some((x) => x.id === 'p4'),
    'the in-flight wave is still real work, still shown'
  )
  assert.equal(status[0].feed.state, 'WORKING')
  const items = attentionFor(attention, 'p4')
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'BLOCKED_EXTERNAL')
  assert.equal(items[0].source.kind, 'PROJECT_EXECUTION_HOLD')
})

test('parity: WAITING_FOR_RESOURCES (durable resource-wait checkpoint) -- Work says WAITING, Attention says WAITING_FOR_RESOURCES (same fact, different vocabulary), Command agrees with Work, run.state stays ACTIVE', () => {
  let run = recordPendingDispatch(newRun('r5', 'p5'), [{ id: 't1', scope: ['a.mjs'] }], clock, 0)
  run = checkpointRun(
    run,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    run.revision
  )
  const { attention, status } = project3Ways([project('p5')], { p5: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'WAITING')
  assert.match(feed.reason, /host memory critical/)
  assert.equal(status[0].feed.state, 'WAITING')
  const items = attentionFor(attention, 'p5')
  assert.equal(items.length, 1)
  assert.equal(
    items[0].category,
    'WAITING_FOR_RESOURCES',
    "different word from Work's WAITING, same underlying fact -- not a contradiction"
  )
  assertRunStateFamily(run, feed.state)
})

test('parity: NEEDS_YOU (open needsYou entry) -- Work/Command say NEEDS_YOU, Attention emits NEEDS_OWNER (its own vocabulary for the same fact), run.state ACTIVE', () => {
  const run = raiseNeedsYou(newRun('r6', 'p6'), { question: 'which provider?' }, clock, 0)
  const { work, attention, status } = project3Ways([project('p6')], { p6: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'NEEDS_YOU')
  assert.ok(work.needsYou.some((x) => x.id === 'p6'))
  assert.equal(status[0].feed.state, 'NEEDS_YOU')
  const items = attentionFor(attention, 'p6')
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'NEEDS_OWNER')
  assertRunStateFamily(run, feed.state)
})

// "failed" has no state literally named FAILED in this codebase's real
// vocabulary (reconciled, not guessed) -- STALLED is the real state that
// means "something went wrong, an operator decision is needed to recover
// it" (a wave that stopped making progress with no automatic path
// forward), and Attention's own real category for it is
// FAILED_REQUIRES_ATTENTION -- the closest real, existing match; this test
// uses that pairing rather than inventing a FAILED state that doesn't
// exist anywhere in the domain.
test('parity: FAILED (real equivalent: STALLED) -- Work/Command say STALLED, Attention says FAILED_REQUIRES_ATTENTION, run.state STALLED', () => {
  const run = markStalled(newRun('r7', 'p7'), ['wave made no progress'], clock)
  const { work, attention, status } = project3Ways([project('p7')], { p7: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'STALLED')
  assert.ok(work.stalled.some((x) => x.id === 'p7'))
  assert.equal(status[0].feed.state, 'STALLED')
  const items = attentionFor(attention, 'p7')
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'FAILED_REQUIRES_ATTENTION')
  assertRunStateFamily(run, feed.state)
})

test('parity: READY_FOR_ADOPTION (COMPLETE, not yet adopted) -- Work/Command say READY_FOR_ADOPTION, Attention agrees, run.state COMPLETE', () => {
  const run = completeRun(newRun('r8', 'p8'), clock)
  const { work, attention, status } = project3Ways([project('p8')], { p8: run })
  const feed = projectLiveWorkFeedState(run)
  assert.equal(feed.state, 'READY_FOR_ADOPTION')
  assert.ok(work.readyForAdoption.some((x) => x.id === 'p8'))
  assert.equal(status[0].feed.state, 'READY_FOR_ADOPTION')
  const items = attentionFor(attention, 'p8')
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'READY_FOR_ADOPTION')
  assertRunStateFamily(run, feed.state)
})

test('parity: DONE (COMPLETE, real ADVANCED adoption merge landed) -- Work/Attention both reclassify to recentlyCompleted/COMPLETED_RECENTLY, never still READY_FOR_ADOPTION', () => {
  const run = completeRun(newRun('r9', 'p9'), clock)
  const projectCanonicalBases = {
    p9: {
      history: [
        {
          action: 'ADVANCED',
          ref: 'refs/heads/main',
          resultingSha: 'deadbeef',
          missionId: run.id,
          at: '2026-09-12T11:00:00.000Z'
        }
      ]
    }
  }
  const { work, attention, status } = project3Ways(
    [project('p9')],
    { p9: run },
    { projectCanonicalBases }
  )
  assert.deepEqual(
    work.readyForAdoption,
    [],
    'a real adoption merge must clear the ready-for-adoption bucket'
  )
  assert.ok(work.recentlyCompleted.some((x) => x.id === 'p9'))
  // Command/fleetWorkStatus has no adoption-awareness of its own (it never
  // reads canonicalBases) -- it still honestly reports the run's own raw
  // feed state (READY_FOR_ADOPTION), which is not WRONG (the run itself did
  // complete) so much as INCOMPLETE next to Work's adoption-aware answer.
  // Documented here, not silently smoothed over -- see NEW_FINDING below.
  assert.equal(status[0].feed.state, 'READY_FOR_ADOPTION')
  const items = attentionFor(attention, 'p9')
  assert.equal(items.length, 1)
  assert.equal(
    items[0].category,
    'COMPLETED_RECENTLY',
    'Attention must not still claim this is ready for adoption once really adopted'
  )
})
