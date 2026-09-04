// End-to-end V0 proof: the generic research engine driving the NFL 2001 QB
// fixture through the full ladder -- dispatch -> result -> admission ->
// verification -> conflict detection -> reconciliation -> CanonicalFact ->
// completeness metrics -> provenance package/CSV export. Zero live research;
// the DeterministicFakeResearchWorker is the only "provider" involved, and
// every usage.providerReportedCostUsd is a real, honest 0.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { admitBoundedResearchResult, recordIdentityResolutionState } from '../domain/research-admission.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { markResearchNodeReady, recordResearchNodeAttempt, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { canonicalOutputToCsv, buildResearchProvenancePackage } from '../domain/research-provenance.mjs'
import { admitReconciliationDecision, decideDerivedFieldReconciliation, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { detectResearchConflicts, verifyResearchClaim } from '../domain/research-verification.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import { buildNflQb2001Mission, buildNflQb2001Script, nflPasserRating } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-15T08:00:00.000Z')

async function runRequestToAdmission(mission, request, worker) {
  let next = markResearchNodeReady(mission, request.nodeId, clock, mission.revision)
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, true, `dispatch failed for ${request.nodeId}: ${JSON.stringify(dispatched)}`)
  next = recordResearchNodeDispatch(next, request.nodeId, { taskFingerprint: request.taskFingerprint, workerRunRef: dispatched.workerRunRef }, clock, next.revision)
  let fetched = await worker.fetchResult(dispatched.workerRunRef)
  while (fetched.status === 'PENDING') fetched = await worker.fetchResult(dispatched.workerRunRef) // eslint-disable-line no-await-in-loop
  next = recordResearchNodeResult(next, request.nodeId, fetched.result, clock, next.revision)
  const digest = next.nodes.find((n) => n.id === request.nodeId).rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, request.nodeId, digest, clock, next.revision)
  return next
}

function claimFor(node, fieldName) {
  return node.claims.filter((c) => c.fieldName === fieldName).at(-1)
}

test('NFL 2001 QB fixture runs end to end through the full research engine', async () => {
  let mission = buildNflQb2001Mission(clock)
  const { script, requests } = buildNflQb2001Script(mission, clock)
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

  // --- Tom Brady: bulk deterministic + derived field ---
  for (const request of requests['node:tom-brady']) {
    mission = await runRequestToAdmission(mission, request, worker)
  }
  let bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
  assert.equal(bradyNode.claims.length, 6)
  for (const field of ['team', 'passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'attempts']) {
    const claim = claimFor(bradyNode, field)
    mission = verifyResearchClaim(mission, 'node:tom-brady', claim.id, clock, mission.revision)
  }
  bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
  assert.ok(bradyNode.claims.every((c) => c.status === 'VERIFIED'), 'every Brady claim must verify against its primary-source evidence')
  for (const field of ['team', 'passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'attempts']) {
    const claim = claimFor(bradyNode, field)
    mission = decideReconciliation(
      mission,
      'node:tom-brady',
      { fieldName: field, decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: claim.id, consideredClaimIds: [claim.id], decidedValue: claim.proposedValue, rationale: `single independently verified primary-source claim for ${field}`, decidedBy: 'TIM' },
      clock,
      mission.revision
    )
    bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
    const decisionId = bradyNode.reconciliationDecisions.at(-1).id
    mission = admitReconciliationDecision(mission, 'node:tom-brady', decisionId, clock, mission.revision)
  }
  // Derived field: passerRating computed from Brady's own now-canonical
  // inputs, never independently sourced from a worker.
  mission = decideDerivedFieldReconciliation(
    mission,
    'node:tom-brady',
    {
      fieldName: 'passerRating',
      derivationRule: 'NFL_PASSER_RATING_FORMULA',
      inputFieldNames: ['completions', 'attempts', 'passingYards', 'passingTouchdowns', 'interceptions'],
      computeFn: nflPasserRating
    },
    clock,
    mission.revision
  )
  bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
  const passerRatingDecisionId = bradyNode.reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'node:tom-brady', passerRatingDecisionId, clock, mission.revision)
  bradyNode = mission.nodes.find((n) => n.id === 'node:tom-brady')
  const passerRatingFact = bradyNode.canonicalFacts.find((f) => f.fieldName === 'passerRating')
  assert.ok(passerRatingFact, 'derived passerRating must become a real CanonicalFact')
  assert.equal(passerRatingFact.derivationLineage.derivationRule, 'NFL_PASSER_RATING_FORMULA')
  assert.equal(passerRatingFact.derivationLineage.inputCanonicalFactIds.length, 5)
  assert.equal(passerRatingFact.value, nflPasserRating(264, 413, 2843, 18, 12))

  // --- Kurt Warner: research-required gap + source conflict ---
  for (const request of requests['node:kurt-warner']) {
    mission = await runRequestToAdmission(mission, request, worker)
  }
  let warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  assert.equal(warnerNode.claims.filter((c) => c.fieldName === 'passingYards').length, 2, 'two providers proposed different passingYards values')
  mission = detectResearchConflicts(mission, 'node:kurt-warner', clock, mission.revision)
  warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  assert.equal(warnerNode.conflicts.length, 1, 'the disagreeing passingYards claims must be surfaced as a real conflict, not silently picked')
  const conflict = warnerNode.conflicts[0]
  assert.equal(conflict.fieldName, 'passingYards')
  const mvpClaim = claimFor(warnerNode, 'mvpVotingNote')
  mission = verifyResearchClaim(mission, 'node:kurt-warner', mvpClaim.id, clock, mission.revision)
  const primaryYardsClaim = warnerNode.claims.find((c) => c.fieldName === 'passingYards' && c.provider === 'FAKE')
  mission = verifyResearchClaim(mission, 'node:kurt-warner', primaryYardsClaim.id, clock, mission.revision)
  warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  // Reconcile the conflict by selecting the primary-source claim over the
  // undisclosed-methodology aggregator claim -- the rationale is what makes
  // this an auditable TSF decision, not a silent pick.
  mission = decideReconciliation(
    mission,
    'node:kurt-warner',
    {
      fieldName: 'passingYards',
      decisionType: 'RESOLVE_CONFLICT',
      selectedClaimId: primaryYardsClaim.id,
      consideredClaimIds: conflict.conflictingClaimIds,
      conflictId: conflict.id,
      decidedValue: primaryYardsClaim.proposedValue,
      rationale: 'Selected the primary pro-football-reference.com regular-season total over an aggregator total of undisclosed methodology that may include playoff games.',
      decidedBy: 'TIM'
    },
    clock,
    mission.revision
  )
  warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  mission = admitReconciliationDecision(mission, 'node:kurt-warner', warnerNode.reconciliationDecisions.at(-1).id, clock, mission.revision)
  mission = decideReconciliation(
    mission,
    'node:kurt-warner',
    { fieldName: 'mvpVotingNote', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: mvpClaim.id, consideredClaimIds: [mvpClaim.id], decidedValue: mvpClaim.proposedValue, rationale: 'single verified claim, the research-required gap is closed', decidedBy: 'TIM' },
    clock,
    mission.revision
  )
  warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  mission = admitReconciliationDecision(mission, 'node:kurt-warner', warnerNode.reconciliationDecisions.at(-1).id, clock, mission.revision)
  warnerNode = mission.nodes.find((n) => n.id === 'node:kurt-warner')
  assert.equal(warnerNode.canonicalFacts.find((f) => f.fieldName === 'passingYards').value, 4830)
  assert.equal(warnerNode.conflicts[0].status, 'RECONCILED')

  // --- Jim Miller: identity alias + typed missingness + temporal check ---
  const [millerBadRequest, millerFixedRequest] = requests['node:jim-miller']
  mission = await runRequestToAdmission(mission, millerBadRequest, worker)
  let millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  const badTeamClaim = claimFor(millerNode, 'team')
  mission = verifyResearchClaim(mission, 'node:jim-miller', badTeamClaim.id, clock, mission.revision)
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  assert.equal(millerNode.claims.find((c) => c.id === badTeamClaim.id).status, 'REJECTED', 'the mis-scoped (non-2001) team claim must fail temporal verification')
  assert.equal(millerNode.typedMissingness.length, 1, 'signingBonusUsd is honestly admitted as missing')
  assert.equal(millerNode.typedMissingness[0].fieldName, 'signingBonusUsd')
  assert.ok(millerNode.observations[0].rawContent.toLowerCase().includes('ambiguous'), 'the worker itself flagged the namesake ambiguity in its observation')

  // Identity resolution: the worker's own low-confidence, ambiguous
  // observation is what triggers TSF to explicitly resolve the alias --
  // never guessed/auto-attributed (see the security-boundary tests in
  // research-epistemic-ladder.test.mjs).
  mission = recordIdentityResolutionState(
    mission,
    'node:jim-miller',
    {
      candidateEntityRefs: [{ entityId: 'nfl:2001:qb:jim-miller', team: 'CHI' }, { entityId: 'unrelated:jim-miller:other-1' }, { entityId: 'unrelated:jim-miller:other-2' }],
      resolvedEntityId: 'nfl:2001:qb:jim-miller',
      status: 'RESOLVED',
      rationale: 'Disambiguated by cross-referencing team (CHI) and 2001-dated primary roster source against the fixture ExpectedUniverse entity.'
    },
    clock,
    mission.revision
  )
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  assert.equal(millerNode.identityResolutionState.status, 'RESOLVED')
  assert.equal(millerNode.identityResolutionState.resolvedEntityId, 'nfl:2001:qb:jim-miller')

  mission = recordResearchNodeAttempt(mission, 'node:jim-miller', 'RETRY', clock, mission.revision)
  mission = await runRequestToAdmission(mission, millerFixedRequest, worker)
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  const fixedTeamClaim = millerNode.claims.find((c) => c.fieldName === 'team' && c.provider === 'FAKE_RETRY')
  mission = verifyResearchClaim(mission, 'node:jim-miller', fixedTeamClaim.id, clock, mission.revision)
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  assert.equal(millerNode.claims.find((c) => c.id === fixedTeamClaim.id).status, 'VERIFIED')

  mission = decideReconciliation(
    mission,
    'node:jim-miller',
    { fieldName: 'team', decisionType: 'ACCEPT_SINGLE_VERIFIED_CLAIM', selectedClaimId: fixedTeamClaim.id, consideredClaimIds: [badTeamClaim.id, fixedTeamClaim.id], decidedValue: fixedTeamClaim.proposedValue, rationale: 'The corrected, properly 2001-scoped primary roster claim; the earlier claim was rejected for wrong temporal scope.', decidedBy: 'TIM' },
    clock,
    mission.revision
  )
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  mission = admitReconciliationDecision(mission, 'node:jim-miller', millerNode.reconciliationDecisions.at(-1).id, clock, mission.revision)
  mission = decideReconciliation(
    mission,
    'node:jim-miller',
    { fieldName: 'signingBonusUsd', decisionType: 'ACCEPT_TYPED_MISSING', decidedValue: null, rationale: 'Not publicly available for a backup-era player; honestly recorded as missing rather than fabricated.', decidedBy: 'TIM' },
    clock,
    mission.revision
  )
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  mission = admitReconciliationDecision(mission, 'node:jim-miller', millerNode.reconciliationDecisions.at(-1).id, clock, mission.revision)
  millerNode = mission.nodes.find((n) => n.id === 'node:jim-miller')
  assert.equal(millerNode.canonicalFacts.find((f) => f.fieldName === 'team').value, 'CHI')
  assert.equal(millerNode.canonicalFacts.some((f) => f.fieldName === 'signingBonusUsd'), false, 'ACCEPT_TYPED_MISSING must not create a numeric CanonicalFact')

  // --- Completeness (multidimensional, no opaque score) ---
  mission = { ...mission, nodes: mission.nodes.map((n) => ({ ...n, status: 'COMPLETED' })) }
  const completeness = computeCompletenessMetrics(mission, clock)
  assert.equal(completeness.presentEntityCoverage, 1, 'all 3 expected players present')
  assert.equal(completeness.expectedEntityCoverage, 1)
  // Direct, real-valued assertions (not just edge cases) -- an
  // independent-verification finding on the prior version of this test:
  // fieldCoverage/evidenceCoverage/verifiedCoverage were only exercised
  // for degenerate (empty/zero) cases elsewhere, never for this fixture's
  // real, fully-worked-through numbers.
  assert.equal(completeness.fieldCoverage, 1, 'every one of the 11 requested fields across all 3 players resolved -- canonical or honestly typed-missing')
  assert.equal(completeness.evidenceCoverage, 1, 'every one of the 11 claims (including the later-superseded/rejected ones) carries real evidence')
  assert.equal(
    completeness.verifiedCoverage,
    0.9,
    '9 of 10 non-rejected claims reached VERIFIED/RECONCILED -- the one exception is Warner\'s undisclosed-methodology aggregator claim, correctly left CONFLICTED (superseded, never itself verified) rather than silently counted as verified'
  )
  assert.ok(completeness.unresolvedConflictCount === 0, 'the Warner conflict was reconciled')
  assert.equal(completeness.conflictCount, 1)
  assert.ok(completeness.typedMissingnessCount >= 1)
  assert.equal(completeness.identityReviewCount, 1, 'exactly the Jim Miller node required identity review')
  assert.ok(completeness.derivedFieldReproducibilityCoverage === 1, 'the one derived field (passerRating) is reproducible from its still-canonical inputs')

  // --- Provenance / reproducibility export ---
  const { packageBody, receipt } = buildResearchProvenancePackage(mission, { decidedBy: 'TIM', clock })
  assert.equal(receipt.kind, 'RESEARCH_PROVENANCE_EXPORT')
  assert.equal(verifyReceipt(receipt), true, 'the provenance receipt must be a real, verifiable hash chain link')
  assert.equal(packageBody.nodes.length, 3)
  assert.ok(packageBody.timeline.events.length > 10)
  assert.ok(packageBody.workerProviderManifest.some((p) => p.provider === 'FAKE'))
  assert.ok(packageBody.workerProviderManifest.every((p) => p.totalCostUsd === 0), 'fake worker runs are real $0, never a fabricated unknown coerced to 0')
  assert.equal(packageBody.integrityReport.status, 'CLEAN', 'every exported CanonicalFact went through real, valid ReconciliationDecision lineage')
  assert.equal(packageBody.integrityReport.findings.length, 0)

  const csv = canonicalOutputToCsv(mission, clock)
  const lines = csv.trim().split('\n')
  assert.equal(lines[0], 'nodeId,entityId,fieldName,value,missingnessType,temporalScope,canonicalizedAt')
  assert.ok(lines.some((l) => l.includes('passerRating')))
  assert.ok(lines.some((l) => l.includes('NOT_PUBLICLY_AVAILABLE')))
  assert.equal(lines.length, 1 + 6 + 1 + 2 + 2, 'header + Brady 6 canonical fields + Warner 2 + Miller team + Miller missing signingBonusUsd')
})
