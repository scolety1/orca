// Provenance/reproducibility export. buildResearchMissionTimeline is a
// pattern-reuse (not a literal call) of flight-recorder.mjs's
// buildRunTimeline: same "pure, stateless projection over already-durable
// state, sorted by timestamp, real (never fabricated) segment durations"
// mechanism, extended with research-specific event types the original
// module has no vocabulary for (NODE_ADDED/NODE_DISPATCHED/RESULT_ADMITTED/
// VERIFICATION_RECORDED/CONFLICT_RAISED/RECONCILIATION_DECIDED/
// CANONICAL_FACT_CREATED). This is a disclosed refinement of CORRECTION
// WAVE 1's REUSE_DIRECTLY label for "durable events/timeline" -- literally
// importing buildRunTimeline unmodified would have required force-fitting
// research events into keep-going's WAVE_RECORDED/CHECKPOINT vocabulary, a
// real semantic distortion caught during implementation. See RETURN item 16.
//
// buildResearchProvenancePackage wraps the assembled package in
// receipts.mjs's existing hash-chain (RESEARCH_PROVENANCE_EXPORT kind,
// added to TSF_RECEIPT_KINDS) rather than a second, parallel hash-chain
// implementation.
import { isoNow, sha256 } from './canonical.mjs'
import { createReceipt } from './receipts.mjs'
import { computeCompletenessMetrics } from './research-completeness.mjs'

function durationMs(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const d = Date.parse(toIso) - Date.parse(fromIso)
  return Number.isFinite(d) && d >= 0 ? d : null
}

export const RESEARCH_EVENT_TYPES = Object.freeze([
  'MISSION_CREATED',
  'STATE_TRANSITION',
  'CHECKPOINT',
  'NEEDS_YOU_RAISED',
  'NEEDS_YOU_RESOLVED',
  'NODE_DISPATCHED',
  'RESULT_ADMITTED',
  'VERIFICATION_RECORDED',
  'CONFLICT_RAISED',
  'RECONCILIATION_DECIDED',
  'CANONICAL_FACT_CREATED'
])

export function buildResearchMissionTimeline(mission) {
  const events = [
    { type: 'MISSION_CREATED', at: mission.createdAt, detail: { researchQuestion: mission.specification.researchQuestion } }
  ]
  for (const t of mission.transitions) {
    events.push({ type: 'STATE_TRANSITION', at: t.at, detail: { from: t.from, to: t.to, reason: t.reason } })
  }
  for (const c of mission.checkpoints) {
    events.push({ type: 'CHECKPOINT', at: c.at, detail: { phase: c.phase, note: c.note, state: c.state } })
  }
  for (const n of mission.needsYou) {
    events.push({ type: 'NEEDS_YOU_RAISED', at: n.raisedAt, detail: { id: n.id, question: n.question } })
    if (n.resolvedAt) {
      events.push({ type: 'NEEDS_YOU_RESOLVED', at: n.resolvedAt, detail: { id: n.id, resolution: n.resolution } })
    }
  }
  for (const node of mission.nodes) {
    for (const d of node.dispatchRecords) {
      events.push({ type: 'NODE_DISPATCHED', at: d.dispatchedAt, detail: { nodeId: node.id, provider: d.workerRunRef?.provider ?? null } })
    }
    for (const digest of node.admittedResultDigests ?? []) {
      const raw = node.rawResults.find((r) => r.digest === digest)
      events.push({ type: 'RESULT_ADMITTED', at: raw?.receivedAt ?? node.updatedAt ?? mission.updatedAt, detail: { nodeId: node.id, digest } })
    }
    for (const v of node.verifications) {
      events.push({ type: 'VERIFICATION_RECORDED', at: v.verifiedAt, detail: { nodeId: node.id, claimId: v.claimId, verdict: v.verdict } })
    }
    for (const c of node.conflicts) {
      events.push({ type: 'CONFLICT_RAISED', at: c.raisedAt, detail: { nodeId: node.id, fieldName: c.fieldName } })
    }
    for (const r of node.reconciliationDecisions) {
      events.push({ type: 'RECONCILIATION_DECIDED', at: r.decidedAt, detail: { nodeId: node.id, fieldName: r.fieldName, decisionType: r.decisionType } })
    }
    for (const f of node.canonicalFacts) {
      events.push({ type: 'CANONICAL_FACT_CREATED', at: f.canonicalizedAt, detail: { nodeId: node.id, fieldName: f.fieldName } })
    }
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const segments = events.slice(1).map((event, i) => ({
    fromEvent: events[i].type,
    toEvent: event.type,
    fromAt: events[i].at,
    toAt: event.at,
    durationMs: durationMs(events[i].at, event.at)
  }))
  return {
    schemaVersion: 'TSF_RESEARCH_MISSION_TIMELINE_V1',
    missionId: mission.id,
    projectId: mission.projectId,
    state: mission.state,
    events,
    segments,
    totalElapsedMs: durationMs(mission.createdAt, mission.updatedAt)
  }
}

function providerManifest(mission) {
  const byProvider = new Map()
  for (const node of mission.nodes) {
    for (const raw of node.rawResults ?? []) {
      const provider = raw.result.provider
      const entry = byProvider.get(provider) ?? { provider, resultCount: 0, requestCount: 0, requestCountKnown: false, tokensOrUnits: 0, tokensOrUnitsKnown: false, costUsdKnown: [] }
      entry.resultCount += 1
      // Same "unknown stays unknown" discipline as tokensOrUnits/cost below
      // -- an independent-verification finding caught this field silently
      // coercing a null requestCount to 0 while its sibling fields on the
      // same Usage object were already handled correctly.
      if (raw.result.usage?.requestCount != null) {
        entry.requestCount += raw.result.usage.requestCount
        entry.requestCountKnown = true
      }
      if (raw.result.usage?.tokensOrUnits != null) {
        entry.tokensOrUnits += raw.result.usage.tokensOrUnits
        entry.tokensOrUnitsKnown = true
      }
      entry.costUsdKnown.push(raw.result.usage?.providerReportedCostUsd ?? null)
      byProvider.set(provider, entry)
    }
  }
  return [...byProvider.values()].map((entry) => ({
    provider: entry.provider,
    resultCount: entry.resultCount,
    requestCount: entry.requestCountKnown ? entry.requestCount : null,
    tokensOrUnits: entry.tokensOrUnitsKnown ? entry.tokensOrUnits : null,
    // Unknown cost stays null, never coerced to 0, even when every
    // individual result happened to report a real 0 -- any single unknown
    // (null) in the set makes the aggregate unknown rather than silently
    // treating a missing figure as free.
    totalCostUsd: entry.costUsdKnown.every((c) => c !== null) ? entry.costUsdKnown.reduce((a, b) => a + b, 0) : null
  }))
}

export function buildResearchProvenancePackage(mission, { decidedBy = 'TSF_SYSTEM', clock } = {}) {
  const completeness = computeCompletenessMetrics(mission, clock)
  const timeline = buildResearchMissionTimeline(mission)
  const packageBody = {
    schemaVersion: 'TSF_RESEARCH_PROVENANCE_PACKAGE_V1',
    missionId: mission.id,
    projectId: mission.projectId,
    specification: mission.specification,
    expectedUniverse: mission.expectedUniverse,
    nodes: mission.nodes.map((node) => ({
      id: node.id,
      targetEntity: node.targetEntity,
      status: node.status,
      sourceReferences: node.sourceReferences,
      sourceSnapshots: node.sourceSnapshots,
      observations: node.observations,
      claims: node.claims,
      evidence: node.evidence,
      typedMissingness: node.typedMissingness,
      identityResolutionState: node.identityResolutionState,
      verifications: node.verifications,
      conflicts: node.conflicts,
      reconciliationDecisions: node.reconciliationDecisions,
      canonicalFacts: node.canonicalFacts
    })),
    completeness,
    timeline,
    workerProviderManifest: providerManifest(mission),
    generatedAt: isoNow(clock)
  }
  packageBody.contentHash = sha256(packageBody)
  const receipt = createReceipt(
    {
      kind: 'RESEARCH_PROVENANCE_EXPORT',
      projectId: mission.projectId,
      missionId: mission.id,
      result: packageBody,
      identities: { decidedBy }
    },
    { clock }
  )
  return { packageBody, receipt }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// One row per resolved requested field: a real CanonicalFact value, or an
// honest typed-missing row -- never a silently blank/absent row for a
// field TSF simply hasn't gotten to yet (those are excluded entirely,
// distinguishable from "resolved but missing").
export function canonicalOutputToCsv(mission) {
  const header = ['nodeId', 'entityId', 'fieldName', 'value', 'missingnessType', 'temporalScope', 'canonicalizedAt']
  const rows = [header.join(',')]
  for (const node of mission.nodes) {
    for (const fact of node.canonicalFacts) {
      rows.push(
        [node.id, node.targetEntity?.entityId ?? '', fact.fieldName, fact.value, '', fact.temporalScope, fact.canonicalizedAt]
          .map(csvEscape)
          .join(',')
      )
    }
    for (const missing of node.typedMissingness) {
      const alreadyCanonical = node.canonicalFacts.some((f) => f.fieldName === missing.fieldName)
      if (alreadyCanonical) continue
      rows.push(
        [node.id, node.targetEntity?.entityId ?? '', missing.fieldName, '', missing.missingnessType, '', missing.admittedAt]
          .map(csvEscape)
          .join(',')
      )
    }
  }
  return rows.join('\n') + '\n'
}
