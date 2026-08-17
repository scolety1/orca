import { isoNow } from './canonical.mjs'

const severityRank = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, BLOCKED: 3 }

function finding(code, status, summary, remediation, evidence = {}) {
  return { code, status, summary, remediation, evidence }
}

export function assessHealth(facts, clock) {
  const findings = []
  if (facts.repositoryAvailable === false) {
    findings.push(finding('REPOSITORY_UNAVAILABLE', 'BLOCKED', 'Project repository is unavailable.', 'Verify the registered path without mutating it.'))
  }
  if (facts.worktreeHealthy === false) {
    findings.push(finding('WORKTREE_UNHEALTHY', 'BLOCKED', 'Orca reports an unhealthy worktree.', 'Inspect Orca worktree facts and preserve the candidate.'))
  }
  if (facts.workerStuck === true) {
    findings.push(finding('WORKER_STUCK', 'DEGRADED', 'Worker has exceeded its progress threshold.', 'Pause or replace it at a recovery checkpoint.'))
  }
  if (facts.sessionStale === true) {
    findings.push(finding('SESSION_STALE', 'DEGRADED', 'Session identity is stale.', 'Create a replacement receipt at a mission boundary.'))
  }
  if (facts.testsPassed === false) {
    findings.push(finding('TESTS_FAILED', 'BLOCKED', 'Candidate tests failed.', 'Return the exact failure evidence for bounded repair.'))
  }
  if (facts.providerAvailable === false) {
    findings.push(finding('PROVIDER_UNAVAILABLE', 'DEGRADED', 'Requested provider is unavailable.', 'Use the configured fallback at a mission boundary.'))
  }
  if (facts.upgradeBlocked === true) {
    findings.push(finding('UPGRADE_BLOCKED', 'BLOCKED', 'Upgrade cannot advance.', 'Resolve the linked candidate or test blocker.'))
  }
  if (facts.humanDecisionPending === true) {
    findings.push(finding('HUMAN_DECISION_PENDING', 'DEGRADED', 'A consequential decision is waiting for Tim.', 'Present the exact current binding and options.'))
  }
  if (facts.upstreamDrift === true) {
    findings.push(finding('UPSTREAM_DRIFT', 'DEGRADED', 'Pinned Orca upstream has drifted.', 'Run the bounded upstream compatibility workflow.'))
  }
  if (facts.overlayCompatible === false) {
    findings.push(finding('OVERLAY_INCOMPATIBLE', 'BLOCKED', 'TSF overlay contract is incompatible with Orca.', 'Stop foundation work and inspect the plugin contract delta.'))
  }
  const status = findings.reduce(
    (current, item) => (severityRank[item.status] > severityRank[current] ? item.status : current),
    facts.repositoryAvailable === undefined ? 'UNKNOWN' : 'HEALTHY'
  )
  return {
    schemaVersion: 'TSF_HEALTH_REPORT_V1',
    status,
    findings,
    observedAt: isoNow(clock),
    authority: 'ADVISORY_ONLY'
  }
}
