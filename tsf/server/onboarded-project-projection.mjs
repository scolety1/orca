// Projects a durable onboarded-project record (repo analysis + accepted
// decisions, stored in data-store.mjs) into the same ProjectDetail shape
// portfolio-projection.mjs produces for pilot projects, so onboarded
// projects render through the existing Projects/Work/ProjectDetail UI
// without any UI-side special-casing.
import { verifyReceipt } from '../domain/receipts.mjs'

// OnboardingHealth (HEALTHY/HEALTHY_WITH_CAVEATS/NEEDS_ATTENTION/BLOCKED/
// UNKNOWN) maps onto the existing shared HealthStatus vocabulary
// (HEALTHY/UNKNOWN/DEGRADED/BLOCKED) used by ProjectCard/health.mjs
// elsewhere — a distinct, richer vocabulary at the onboarding layer, folded
// down for the shared card/badge rendering.
const HEALTH_STATUS_MAP = {
  HEALTHY: 'HEALTHY',
  HEALTHY_WITH_CAVEATS: 'DEGRADED',
  NEEDS_ATTENTION: 'DEGRADED',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN'
}

function missionStateFor(classification) {
  switch (classification) {
    case 'TIM_REQUIRED':
    case 'NOT_READY':
      return 'BLOCKED'
    case 'SENSITIVE':
      return 'SENSITIVE_READ_ONLY'
    case 'READ_ONLY_ONBOARDING_ONLY':
      return 'READ_ONLY'
    case 'DIRTY_PRESERVE':
      return 'DIRTY_PRESERVE'
    case 'SAFE_TO_ONBOARD_NOW':
    default:
      return 'ONBOARDED'
  }
}

export function projectOnboardedProject(record, membership) {
  const analysis = record.lastAnalysis
  const health = {
    schemaVersion: 'TSF_HEALTH_REPORT_V1',
    status: HEALTH_STATUS_MAP[analysis.health.status] ?? 'UNKNOWN',
    findings: analysis.health.findings.map((f) => ({ code: f.code, status: f.status, summary: f.summary, remediation: f.remediation, evidence: f.evidence })),
    observedAt: analysis.health.observedAt,
    authority: 'ADVISORY_ONLY'
  }
  return {
    id: analysis.projectId,
    displayName: analysis.displayName,
    sourceClass: 'REAL',
    provenance: 'TSF_ONBOARDING_V1',
    root: analysis.repoPath,
    lifecycle: record.acceptedAt ? 'ONBOARDED' : 'ANALYZED_NOT_ONBOARDED',
    branch: analysis.identity.branch,
    registeredAt: record.acceptedAt ?? analysis.analyzedAt,
    purpose: analysis.direction.purpose,
    restrictions: analysis.migrationClassification.classification === 'SENSITIVE' ? ['Sensitive project — no autonomous work without Tim.'] : [],
    activeFleet: !!membership?.activeFleet,
    workSet: !!membership?.workSet,
    mission: {
      id: null,
      state: missionStateFor(analysis.migrationClassification.classification),
      blockedReason: ['TIM_REQUIRED', 'NOT_READY'].includes(analysis.migrationClassification.classification) ? analysis.migrationClassification.reasons.join(' ') : null
    },
    release: {
      stable: { head: analysis.identity.head, tree: analysis.identity.tree, branch: analysis.identity.branch },
      previousStable: null,
      upgrade: null,
      testing: 'UNKNOWN',
      adoption: 'NOT_APPLICABLE_ONBOARDING_ONLY',
      published: 'UNCHANGED_NO_PUBLICATION_ACTION'
    },
    health,
    baseline: {
      tests: analysis.discovery.commandGuidance.hasKnownTestCommand ? analysis.discovery.commandGuidance.testCommands.join(', ') : 'UNKNOWN',
      lint: analysis.discovery.commandGuidance.lintCommands.join(', ') || 'UNKNOWN',
      typecheck: 'UNKNOWN',
      build: analysis.discovery.commandGuidance.buildCommands.join(', ') || 'UNKNOWN'
    },
    evidence: {
      planner: null,
      selectedMission: analysis.direction.recommendedNextMission ? { title: analysis.direction.recommendedNextMission.title, rationale: analysis.direction.recommendedNextMission.rationale } : null,
      verifier: null,
      browser: null,
      resultCapsules: [],
      verifierRaw: null,
      onboarding: {
        maturity: analysis.maturity,
        migrationClassification: analysis.migrationClassification,
        upgradeCandidates: analysis.direction.upgradeCandidates ?? [],
        unfinishedSummary: analysis.direction.unfinishedSummary,
        completedSummary: analysis.direction.completedSummary,
        alignment: analysis.direction.alignment,
        handoffReconciliation: analysis.handoffReconciliation,
        orcaRegistration: analysis.orcaRegistration,
        analyzedAt: analysis.analyzedAt,
        directionLive: analysis.direction.live
      }
    },
    receipts: (() => {
      const chain = (record.receipts ?? []).map((r) => ({ ...r, chainValid: verifyReceipt(r) }))
      return { chain, chainValid: chain.every((r) => r.chainValid), tip: chain.at(-1)?.receiptHash ?? null }
    })(),
    candidate: null
  }
}
