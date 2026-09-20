// Pure, no-I/O response-text builders for command-research-bridge.mjs --
// split out purely to keep that file under this repo's max-lines budget.
// No behavior/wording changed by this move.

export function noMissionYetText() {
  return 'There\'s no research mission yet to talk about -- say what to research (e.g. "research 2019 NFL rookie WRs" or "build me a dataset of X") and I\'ll start a real, durable one.'
}

export function ambiguousMissionText(opState) {
  const ids = Object.keys(opState.researchMissions ?? {})
  return `More than one research mission exists and it's not clear which one you mean (${ids.join(', ')}) -- name the one you're asking about.`
}

// The remaining-gap clause shared by both the create and continue
// responses -- grounded in the real numbers attemptProgressAndRaisePaidRequestIfNeeded
// just produced, never a fixed string.
export function remainingGapNote({ remainingGap, paidRequestRaised, freeOnly }) {
  if (remainingGap <= 0) {
    return ''
  }
  if (paidRequestRaised) {
    return ` ${remainingGap} field(s) have no free-path match -- I've raised a scoped paid-research approval request (Exa) for you to review; I will not spend anything without your explicit approval.`
  }
  if (freeOnly) {
    return ` ${remainingGap} field(s) have no free-path match yet -- queued for autonomous free-path research; I'll only interrupt you if it needs owner input or paid access.`
  }
  return ` ${remainingGap} field(s) still have no free-path match (a paid-research approval request is already open for this mission).`
}

// Hands-on pilot round 3, Bug 4: "how do I know if it's done" must be
// answered from the mission's OWN real completion model (phase, expected-
// universe progress, verification/completeness, what COMPLETE actually
// means for THIS mission, whether Tim needs to act) -- never a fixed
// string. Every number below comes from computeCompletenessMetrics/
// readResearchMissionStatus; only the surrounding sentence shape is
// templated, matching the style of every other grounded response in this
// file (e.g. the existing RESEARCH_STATUS handler).
export function describeMissionCompletion(missionId, status, completeness) {
  const expectedCount = status.nodeCount
  if (status.state === 'COMPLETE') {
    return `**${missionId}** is COMPLETE -- all ${expectedCount} expected item(s) have sourced, verified data and the dataset is ready.`
  }
  const pct = (ratio) => (ratio == null ? null : Math.round(ratio * 100))
  const fieldPct = pct(completeness.fieldCoverage)
  const entityPct = pct(completeness.presentEntityCoverage)
  const progressBits = []
  if (entityPct != null) {
    progressBits.push(`${entityPct}% of expected item(s) present`)
  }
  if (fieldPct != null) {
    progressBits.push(`${fieldPct}% of requested fields resolved`)
  }
  const progressNote = progressBits.length > 0 ? `, ${progressBits.join(', ')}` : ''

  const sentences = [
    "It isn't done yet.",
    `I'll mark it COMPLETE once all ${expectedCount} expected item(s) have sourced, verified values and the requested dataset artifact is produced.`,
    `Right now it's ${status.phase} (mission state ${status.state}${progressNote}).`
  ]
  if (completeness.unresolvedConflictCount > 0) {
    sentences.push(
      `${completeness.unresolvedConflictCount} unresolved conflict(s) need your decision before it can finish.`
    )
  }
  if (status.openNeedsYouCount > 0) {
    sentences.push(
      `${status.openNeedsYouCount} open item(s) need your input -- I've flagged those separately.`
    )
  } else {
    sentences.push(
      "You don't need to keep checking manually; TSF will continue it in the background."
    )
  }
  return sentences.join(' ')
}

// Hands-on pilot round 3, Bug 3: an artifact request must reflect real
// mission/artifact state -- never hallucinate output, never claim a
// complete dataset that doesn't exist yet, and never silently report a
// count of 0 due to reading a field that never existed (the real,
// independently-found bug here: the prior version read
// artifacts.canonicalFacts, a top-level field buildResearchProvenancePackage
// never produces -- canonicalFacts only ever exists per node -- so the
// reported count was always 0 regardless of real state).
export function describeArtifacts(missionId, artifacts, status) {
  // buildResearchProvenancePackage (research-provenance.mjs) returns
  // { packageBody, receipt } -- the real bug this fixes read
  // artifacts.canonicalFacts directly, a field that never exists at
  // either level (canonicalFacts only ever lives per node, nested inside
  // packageBody.nodes), so the reported count was always 0.
  const facts = artifacts.packageBody.nodes.flatMap((node) =>
    node.canonicalFacts.map((f) => ({ ...f, entityLabel: node.targetEntity?.name ?? node.id }))
  )
  if (facts.length === 0) {
    return `The research hasn't produced that artifact yet. It is currently ${status.phase} (${status.nodeCount} node(s), 0 verified fact(s) so far).`
  }
  const byEntity = new Map()
  for (const fact of facts) {
    if (!byEntity.has(fact.entityLabel)) {
      byEntity.set(fact.entityLabel, [])
    }
    byEntity.get(fact.entityLabel).push(`${fact.fieldName}: ${JSON.stringify(fact.value)}`)
  }
  const lines = [...byEntity.entries()].map(
    ([entity, fields]) => `- **${entity}** — ${fields.join(', ')}`
  )
  if (status.state === 'COMPLETE') {
    return `Here's the completed dataset for **${missionId}**:\n${lines.join('\n')}`
  }
  return `Partial, independently verified results so far for **${missionId}** (not yet complete -- currently ${status.phase}):\n${lines.join('\n')}\n\nThis isn't the full dataset yet.`
}
