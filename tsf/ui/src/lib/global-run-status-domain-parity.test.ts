// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 1C, continuation of
// test/cross-projection-parity.test.mjs on the domain/server side. This
// runtime (`node --experimental-strip-types --test`, no bundler) can import
// the real domain .mjs modules by relative path just like any other Node
// ESM import -- so the global status indicator's own real functions
// (buildGlobalRunStatusItems/selectExtraAttentionItems, this file's sibling
// global-run-status.ts) are exercised against the SAME real domain
// projections (summarizeWorkFromRuns/buildFleetAttentionItems) the other
// three surfaces use, not a hand-mirrored approximation of their output.
import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error -- real domain module, no .d.ts, resolved fine at runtime by Node's own ESM loader (see the file header above)
import { summarizeWorkFromRuns } from '../../../domain/work-feed-summary.mjs'
// @ts-expect-error -- see above
import { buildFleetAttentionItems } from '../../../domain/fleet-attention-status.mjs'
// @ts-expect-error -- see above
import {
  createOvernightRun,
  raiseNeedsYou,
  checkpointRun,
  recordPendingDispatch
} from '../../../domain/keep-going.mjs'
import {
  attentionItemToGlobalRunStatusItem,
  buildGlobalRunStatusItems,
  selectExtraAttentionItems,
  mostUrgentState
} from './global-run-status.ts'

const clock = () => new Date('2026-09-12T12:00:00.000Z')

function project(id: string) {
  return {
    id,
    displayName: id,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

function newRun(id: string, projectId: string) {
  return createOvernightRun(
    { id, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
}

test('global indicator: a resource-blocked run is surfaced as WAITING_FOR_RESOURCES, matching real Attention exactly (not the run-driven WAITING branch, which would double-count it)', () => {
  let run = recordPendingDispatch(newRun('r1', 'p1'), [{ id: 't1', scope: ['a.mjs'] }], clock, 0)
  run = checkpointRun(
    run,
    { phase: 'DISPATCH_WAITING_FOR_RESOURCES', note: 'host memory critical' },
    clock,
    run.revision
  )
  const projects = [project('p1')]
  const keepGoingRuns = { p1: run }
  const work = summarizeWorkFromRuns(projects, keepGoingRuns, clock)
  const attention = buildFleetAttentionItems({ projects, keepGoingRuns, clock })

  const runDriven = buildGlobalRunStatusItems(work)
  assert.equal(
    runDriven.find((i) => i.id === 'p1')?.state,
    'WAITING',
    'the run-driven branch reports the real liveWorkFeed state'
  )

  const extra = selectExtraAttentionItems(attention).map((i: { category: string }) => i.category)
  assert.ok(
    extra.includes('WAITING_FOR_RESOURCES'),
    'the resource-wait attention item is picked up as an extra item'
  )

  // Both branches feed the SAME always-visible indicator (AppShell merges
  // run-driven + extra) -- assert the merged urgency read is honestly
  // "waiting", never silently downgraded to something calmer than either
  // branch alone would report.
  const merged = [
    ...runDriven,
    ...selectExtraAttentionItems(attention).map(attentionItemToGlobalRunStatusItem)
  ]
  assert.equal(
    mostUrgentState(merged),
    'WAITING_FOR_RESOURCES',
    'WAITING_FOR_RESOURCES outranks the plain run-driven WAITING duplicate in URGENCY_RANK'
  )
})

test('global indicator: a NEEDS_YOU run is surfaced consistently with real Attention (NEEDS_OWNER) via the merged urgency ranking', () => {
  const run = raiseNeedsYou(newRun('r2', 'p2'), { question: 'which provider?' }, clock, 0)
  const projects = [project('p2')]
  const keepGoingRuns = { p2: run }
  const work = summarizeWorkFromRuns(projects, keepGoingRuns, clock)
  const attention = buildFleetAttentionItems({ projects, keepGoingRuns, clock })

  const runDriven = buildGlobalRunStatusItems(work)
  assert.equal(runDriven.find((i) => i.id === 'p2')?.state, 'NEEDS_YOU')

  // fleetNeedsYouStatus's own item has no liveWorkFeed of its own to be
  // picked up via buildGlobalRunStatusItems' `p.liveWorkFeed` guard -- but
  // this project DOES have a real run/liveWorkFeed (NEEDS_YOU), so it must
  // NOT also appear as a duplicate "extra" NEEDS_OWNER item (Attention's
  // needsYouItems has no per-item resolvedAt filter mismatch here to worry
  // about, but selectExtraAttentionItems' own category allowlist correctly
  // never includes plain NEEDS_OWNER -- confirms no double-count).
  const extraIds = selectExtraAttentionItems(attention).map((i: { id: string }) => i.id)
  assert.ok(
    !extraIds.some((id: string) => id.includes('p2')),
    'a run-driven NEEDS_YOU item must not also be duplicated through the extra-items path'
  )
  assert.equal(mostUrgentState(runDriven), 'NEEDS_YOU')
})
