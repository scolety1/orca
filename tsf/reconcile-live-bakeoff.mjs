import { readFileSync, writeFileSync } from 'node:fs'
import { admitReconciliationDecision, decideReconciliation } from './domain/research-reconciliation.mjs'
import { raiseResearchNeedsYou } from './domain/research-mission.mjs'
import { buildResearchProvenancePackage, canonicalOutputToCsv } from './domain/research-provenance.mjs'
import { computeCompletenessMetrics } from './domain/research-completeness.mjs'
import { verifyReceipt } from './domain/receipts.mjs'

const clock = () => new Date('2026-09-03T10:20:00.000Z')
const dir = 'fixtures/captured-bakeoff-results'
let mission = JSON.parse(readFileSync(`${dir}/mission.json`, 'utf8'))
const DECIDED_BY = 'smcolety@gmail.com'

function reconcile(mission, nodeId, fieldName, decisionType, opts) {
  let next = decideReconciliation(mission, nodeId, { fieldName, decisionType, ...opts }, clock, mission.revision)
  const node = next.nodes.find((n) => n.id === nodeId)
  const decisionId = node.reconciliationDecisions.at(-1).id
  return admitReconciliationDecision(next, nodeId, decisionId, clock, next.revision)
}

function claim(mission, nodeId, fieldName, provider) {
  return mission.nodes.find((n) => n.id === nodeId).claims.find((c) => c.fieldName === fieldName && c.provider === provider)
}

// --- Brady: 5 numeric fields corroborated identically by both providers ---
for (const field of ['passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'attempts']) {
  const c = claim(mission, 'node:tom-brady', field, 'PARALLEL')
  mission = reconcile(mission, 'node:tom-brady', field, 'ACCEPT_SINGLE_VERIFIED_CLAIM', {
    selectedClaimId: c.id,
    consideredClaimIds: [c.id, claim(mission, 'node:tom-brady', field, 'EXA').id],
    decidedValue: c.proposedValue,
    rationale: `Both PARALLEL and EXA independently reported the identical value (${JSON.stringify(c.proposedValue)}), each with real linked evidence that passed verification. PARALLEL's claim selected for its directly-quotable citation excerpts.`,
    decidedBy: DECIDED_BY
  })
}
// team: same fact, different format (NWE vs New England Patriots) -- a real conflict by strict string equality, resolved as such.
{
  const conflict = mission.nodes.find((n) => n.id === 'node:tom-brady').conflicts.find((c) => c.fieldName === 'team')
  const c = claim(mission, 'node:tom-brady', 'team', 'PARALLEL')
  const other = claim(mission, 'node:tom-brady', 'team', 'EXA')
  mission = reconcile(mission, 'node:tom-brady', 'team', 'RESOLVE_CONFLICT', {
    selectedClaimId: c.id,
    consideredClaimIds: [c.id, other.id],
    conflictId: conflict.id,
    decidedValue: c.proposedValue,
    rationale: `Both providers agree on the underlying fact (New England Patriots) but used different formats ("${c.proposedValue}" vs "${other.proposedValue}") -- not a genuine factual disagreement. PARALLEL's abbreviation selected as canonical; EXA's full name preserved in the considered-claims lineage for audit.`,
    decidedBy: DECIDED_BY
  })
}

// --- Warner: passingYards corroborated; mvpVotingNote conflict (concise vs. off-schema biography dump) ---
{
  const c = claim(mission, 'node:kurt-warner', 'passingYards', 'PARALLEL')
  mission = reconcile(mission, 'node:kurt-warner', 'passingYards', 'ACCEPT_SINGLE_VERIFIED_CLAIM', {
    selectedClaimId: c.id,
    consideredClaimIds: [c.id, claim(mission, 'node:kurt-warner', 'passingYards', 'EXA').id],
    decidedValue: c.proposedValue,
    rationale: 'Both providers independently reported 4,830 yards with real linked evidence.',
    decidedBy: DECIDED_BY
  })
}
{
  const conflict = mission.nodes.find((n) => n.id === 'node:kurt-warner').conflicts.find((c) => c.fieldName === 'mvpVotingNote')
  const c = claim(mission, 'node:kurt-warner', 'mvpVotingNote', 'PARALLEL')
  const other = claim(mission, 'node:kurt-warner', 'mvpVotingNote', 'EXA')
  mission = reconcile(mission, 'node:kurt-warner', 'mvpVotingNote', 'RESOLVE_CONFLICT', {
    selectedClaimId: c.id,
    consideredClaimIds: [c.id, other.id],
    conflictId: conflict.id,
    decidedValue: c.proposedValue,
    rationale: 'PARALLEL returned a concise, schema-scoped MVP-voting note. EXA returned a full biographical paragraph that exceeds the requested field scope (a real, disclosed structured-output-discipline gap) -- factually consistent with PARALLEL where it overlaps, but not itself the more usable machine-readable value. PARALLEL selected as canonical.',
    decidedBy: DECIDED_BY
  })
}

// --- Miller: team corroborated; signingBonusUsd is a genuine, materially significant, UNRESOLVED conflict ---
{
  const c = claim(mission, 'node:jim-miller', 'team', 'PARALLEL')
  mission = reconcile(mission, 'node:jim-miller', 'team', 'ACCEPT_SINGLE_VERIFIED_CLAIM', {
    selectedClaimId: c.id,
    consideredClaimIds: [c.id, claim(mission, 'node:jim-miller', 'team', 'EXA').id],
    decidedValue: c.proposedValue,
    rationale: 'Both providers independently and correctly resolved the "Jim Miller" name ambiguity to the Chicago Bears QB, with real linked evidence.',
    decidedBy: DECIDED_BY
  })
}
// signingBonusUsd deliberately left UNRECONCILED: PARALLEL proposed 0 at
// low confidence (0.25) -- itself a disclosed risk (a provider defaulting
// an unfound value to 0 rather than an honest missingness signal, exactly
// the null->zero anti-pattern this whole engine exists to guard against
// downstream of). EXA proposed 2,000,000 with no confidence signal at
// all. Neither claim is independently trustworthy enough to canonicalize
// without a human decision -- per HQ's own stated priority
// ("unsupported confident answers are materially worse than explicit
// uncertainty"), this becomes a real Needs You question instead of a
// forced pick.
mission = raiseResearchNeedsYou(
  mission,
  {
    question:
      'Jim Miller (Chicago Bears, 2001) signingBonusUsd: PARALLEL proposed $0 at LOW confidence (0.25) -- a real risk this is a defaulted/unfound value rather than a genuine $0 bonus. EXA proposed $2,000,000 with no confidence signal at all. Neither is independently trustworthy. Which value (if either) should become canonical, or should this remain typed-missing?',
    options: ['ACCEPT_PARALLEL_0', 'ACCEPT_EXA_2000000', 'MARK_TYPED_MISSING', 'REQUEST_FURTHER_RESEARCH'],
    nodeId: 'node:jim-miller'
  },
  clock,
  mission.revision
)

const completeness = computeCompletenessMetrics(mission, clock)
const { packageBody, receipt } = buildResearchProvenancePackage(mission, { decidedBy: DECIDED_BY, clock })
console.log('receipt valid:', verifyReceipt(receipt))
console.log('integrityReport:', JSON.stringify(packageBody.integrityReport))
console.log('completeness:', JSON.stringify(completeness, null, 2))
console.log('mission state:', mission.state, 'open needsYou:', mission.needsYou.filter((n) => !n.resolvedAt).length)

writeFileSync(`${dir}/mission.json`, JSON.stringify(mission, null, 2))
writeFileSync(`${dir}/provenance-package.json`, JSON.stringify(packageBody, null, 2))
writeFileSync(`${dir}/provenance-receipt.json`, JSON.stringify(receipt, null, 2))
writeFileSync(`${dir}/canonical-output.csv`, canonicalOutputToCsv(mission, clock))
writeFileSync(`${dir}/completeness.json`, JSON.stringify(completeness, null, 2))
console.log('--- CSV ---')
console.log(canonicalOutputToCsv(mission, clock))
