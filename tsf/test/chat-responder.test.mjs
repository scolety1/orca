import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDecision, classifyIntent, respond } from '../server/chat-responder.mjs'
import { loadRealPilotProjects } from '../server/portfolio-projection.mjs'
import { createOvernightRun, dispatchWave, planWave, raiseNeedsYou } from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')

// M3: the affirmative "go do real work" phrasings Tim's own north star names
// verbatim ("Fix this," "go ahead," "build that," "do the recommended next
// step") must all be recognized as dispatch-worthy, not fall through to
// GENERAL. "Fix this" was already covered (FIX_REQUEST); this covers the
// rest under the new DISPATCH_REQUEST intent.
test('classifyIntent recognizes every north-star dispatch phrasing', () => {
  assert.equal(classifyIntent('Fix this'), 'FIX_REQUEST')
  assert.equal(classifyIntent('go ahead'), 'DISPATCH_REQUEST')
  assert.equal(classifyIntent('build that'), 'DISPATCH_REQUEST')
  assert.equal(classifyIntent('do the recommended next step'), 'DISPATCH_REQUEST')
})

test('classifyIntent does not confuse ordinary questions with a dispatch request', () => {
  assert.equal(classifyIntent('what should we do next?'), 'NEXT_ACTION')
  assert.equal(classifyIntent('is this actually finished?'), 'FINISHED')
})

test('DISPATCH_REQUEST classifies as RECOMMEND_AND_PROCEED, same tier as FIX_REQUEST', () => {
  assert.equal(classifyDecision('go ahead', 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
  assert.equal(classifyDecision('build that', 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
})

// The authority gate must win regardless of intent -- a dispatch-shaped
// phrasing that ALSO contains consequential wording must still refuse.
test('a TIM_REQUIRED pattern overrides DISPATCH_REQUEST -- chat must never silently authorize a forbidden action just because it is phrased as "go ahead"', () => {
  assert.equal(
    classifyDecision('go ahead and push this to production', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
  assert.equal(
    classifyDecision('go ahead and adopt the candidate', 'DISPATCH_REQUEST'),
    'TIM_REQUIRED'
  )
  assert.equal(classifyDecision('build that and deploy it', 'DISPATCH_REQUEST'), 'TIM_REQUIRED')
})

test('respond() has a real responder for DISPATCH_REQUEST -- it must not crash or fall through to GENERAL', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'go ahead')
  assert.equal(result.intent, 'DISPATCH_REQUEST')
  assert.equal(result.decisionClass, 'RECOMMEND_AND_PROCEED')
  assert.match(result.text, new RegExp(project.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('respond() still refuses TIM_REQUIRED phrasing before ever answering as a dispatch request', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, 'go ahead and merge this to main')
  assert.equal(result.decisionClass, 'TIM_REQUIRED')
  assert.match(result.text, /consequential decision/i)
})

// M3: "what is it doing?" must answer from the real, live Keep Going run
// once one exists -- not the old mission/candidate/release model, which
// has no relationship to it at all.
function activeRunWithInFlightWave() {
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const plan = planWave(run, [{ id: 't1', scope: ['a.mjs'] }], clock)
  run = dispatchWave(
    run,
    plan,
    [{ workItemId: 't1', scope: ['a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }],
    clock,
    run.revision
  )
  return run
}

test('STATUS answers from the live run, not the old mission/candidate model, once a run exists', () => {
  const project = loadRealPilotProjects()[0]
  const run = activeRunWithInFlightWave()
  const result = respond(project, "what's going on with this project?", run)
  assert.equal(result.intent, 'STATUS')
  assert.match(result.text, /Keep Going run/)
  assert.match(result.text, /WORKING/)
  assert.doesNotMatch(
    result.text,
    /mission `/i,
    'must not fall back to the old mission-shaped text'
  )
})

test('NEXT_ACTION on a NEEDS_YOU run surfaces the real open question, not a fictional affordance', () => {
  const project = loadRealPilotProjects()[0]
  let run = createOvernightRun(
    {
      id: 'run-1',
      projectId: 'fixture:proj',
      originalGoal: 'Ship it.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  run = raiseNeedsYou(run, { question: 'Which approach should I take?' }, clock, run.revision)
  const result = respond(project, 'what should we do next?', run)
  assert.equal(result.intent, 'NEXT_ACTION')
  assert.match(result.text, /NEEDS_YOU/)
  assert.match(result.text, /Which approach should I take\?/)
})

test('respond() without a run keeps the exact prior mission-shaped behavior unchanged', () => {
  const project = loadRealPilotProjects()[0]
  const result = respond(project, "what's going on with this project?")
  assert.equal(result.intent, 'STATUS')
  assert.match(result.text, /mission `/)
})
