import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRealPilotProjects } from '../server/portfolio-projection.mjs'
import { createFixtureState, decideFixtureCandidate, FIXTURE_PROJECT_ID } from '../server/fixture-project.mjs'
import { classifyIntent, classifyDecision, respond } from '../server/chat-responder.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import { decideCandidate, candidateBinding } from '../domain/adoption.mjs'

const clock = () => new Date('2026-08-18T20:00:00.000Z')

test('portfolio projection loads all three real pilot projects with honest health/candidate state', () => {
  const projects = loadRealPilotProjects()
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]))
  assert.equal(projects.length, 3)
  assert.equal(byId['colety-labs-sales-engine'].candidate.state, 'ADOPTED')
  assert.equal(byId['shopify-catalog-qa'].candidate.state, 'ADOPTED')
  assert.equal(byId['weird-talent-marketplace'].mission.state, 'BLOCKED')
  // Historical pilot candidates are read-only evidence, never live-decidable.
  for (const project of projects) {
    if (project.candidate) assert.equal(project.candidate.decidable, false)
  }
})

test('portfolio projection normalizes both recorded result-capsule shapes without crashing', () => {
  const projects = loadRealPilotProjects()
  const weirdTalent = projects.find((p) => p.id === 'weird-talent-marketplace')
  assert.equal(weirdTalent.evidence.resultCapsules.length, 3)
  assert.equal(weirdTalent.evidence.resultCapsules.at(-1).status, 'FAILED_WITH_SPECIFIC_FINDING')
  const shopify = projects.find((p) => p.id === 'shopify-catalog-qa')
  assert.ok(shopify.evidence.resultCapsules.length >= 1)
})

test('portfolio projection normalizes selectedMission from both string and object recorded shapes', () => {
  const projects = loadRealPilotProjects()
  for (const project of projects) {
    if (project.evidence.selectedMission) {
      assert.equal(typeof project.evidence.selectedMission.title, 'string')
    }
  }
})

test('receipt chains recorded for real pilots verify with the shared domain hash chain', () => {
  const projects = loadRealPilotProjects()
  const shopify = projects.find((p) => p.id === 'shopify-catalog-qa')
  assert.ok(shopify.receipts.chain.length > 0)
  assert.equal(shopify.receipts.chainValid, true)
  // Projection decorates each receipt with `chainValid`; verify per-entry
  // status independently, not by re-hashing the already-decorated object.
  for (const receipt of shopify.receipts.chain) assert.equal(receipt.chainValid, true)
})

test('chat intent classification recognizes the documented Planner Chat phrasings', () => {
  assert.equal(classifyIntent("what's going on with this project?"), 'STATUS')
  assert.equal(classifyIntent('is this actually finished?'), 'FINISHED')
  assert.equal(classifyIntent('what should we do next?'), 'NEXT_ACTION')
  assert.equal(classifyIntent('why did you choose this?'), 'RATIONALE')
  assert.equal(classifyIntent('this looks like shit'), 'CRITIQUE')
  assert.equal(classifyIntent('fix this'), 'FIX_REQUEST')
  assert.equal(classifyIntent('can you research a better approach?'), 'RESEARCH')
})

test('chat decision classification flags consequential phrasing as TIM_REQUIRED, not auto-decided', () => {
  assert.equal(classifyDecision('can you push this to production?', 'GENERAL'), 'TIM_REQUIRED')
  assert.equal(classifyDecision('what is the status?', 'STATUS'), 'AUTO_DECIDE')
  assert.equal(classifyDecision('fix this spacing', 'FIX_REQUEST'), 'RECOMMEND_AND_PROCEED')
})

test('chat responses stay grounded in real recorded project state, not fabricated claims', () => {
  const projects = loadRealPilotProjects()
  const weirdTalent = projects.find((p) => p.id === 'weird-talent-marketplace')
  const result = respond(weirdTalent, 'is this actually finished?')
  assert.match(result.text, /blocked/i)
  assert.match(result.text, /opaque/i)
  assert.equal(result.plannerRole, 'PLANNER_DEEP')
})

test('the fixture candidate exercises the real decideCandidate transition and produces a valid receipt', () => {
  const fixture = createFixtureState(clock)
  assert.equal(fixture.id, FIXTURE_PROJECT_ID)
  assert.equal(fixture.candidateObject.state, 'READY_FOR_ADOPTION')
  const { candidate, receipt } = decideFixtureCandidate(fixture, { decision: 'ADOPT', requestId: 'test-1' }, null, clock)
  assert.equal(candidate.state, 'ADOPTED')
  assert.equal(verifyReceipt(receipt), true)
  assert.equal(receipt.kind, 'ADOPTION_DECISION')
  assert.equal(receipt.previousReceiptHash, null)
})

test('the fixture candidate refuses to redecide once it has left READY_FOR_ADOPTION with a new request id', () => {
  const fixture = createFixtureState(clock)
  const { candidate: decided } = decideFixtureCandidate(fixture, { decision: 'REJECT', requestId: 'first' }, null, clock)
  assert.equal(decided.state, 'REJECTED')
  // This is exactly the guard the HTTP layer relies on once a decision is persisted:
  // decideCandidate itself refuses a second, differently-requested decision.
  assert.throws(
    () => decideCandidate(decided, { decision: 'ADOPT', expectedBinding: candidateBinding(decided), requestId: 'second' }, clock),
    /not ready for adoption/
  )
})
