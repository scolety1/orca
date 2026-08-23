// Operator UX pass (spec section 2): a compact lifecycle bucket derived
// purely from real, already-present ProjectCard fields -- no new data
// source, no separate classification call per card. Grounded in the real
// mission.state enum actually produced server-side (server/http-server.mjs's
// summarizeWork: ACTIVE/PLANNING/REVIEW = working, BLOCKED* = blocked,
// ADOPTED = completed; server/onboarded-project-projection.mjs's
// missionStateFor: SENSITIVE_READ_ONLY/READ_ONLY = paused by design,
// DIRTY_PRESERVE/ONBOARDED = otherwise normal).
import type { ProjectCard } from './types'

export type LifecycleBucket =
  | 'NEEDS_YOU'
  | 'NEEDS_REPAIR'
  | 'READY_FOR_WORK'
  | 'WORKING'
  | 'READY_FOR_ADOPTION'
  | 'PAUSED'
  | 'BLOCKED'
  | 'UNKNOWN'

export const LIFECYCLE_LABEL: Record<LifecycleBucket, string> = {
  NEEDS_YOU: 'Needs you',
  NEEDS_REPAIR: 'Needs repair',
  READY_FOR_WORK: 'Ready for work',
  WORKING: 'Working',
  READY_FOR_ADOPTION: 'Ready for adoption',
  PAUSED: 'Paused',
  BLOCKED: 'Blocked',
  UNKNOWN: 'Unknown'
}

const WORKING_MISSION_STATES = new Set(['ACTIVE', 'PLANNING', 'REVIEW'])
const PAUSED_BY_DESIGN_CLASSIFICATIONS = new Set(['SENSITIVE', 'READ_ONLY_ONBOARDING_ONLY'])

// Priority order matters: a candidate awaiting Tim's decision, or a
// project with a real blocked reason, always outranks a merely-degraded
// health reading -- "needs a decision" is a stronger signal than "needs
// repair."
export function classifyProjectLifecycle(project: ProjectCard): LifecycleBucket {
  if (project.candidateState === 'READY_FOR_ADOPTION') {
    return 'READY_FOR_ADOPTION'
  }
  if ((project.missionState ?? '').startsWith('BLOCKED')) {
    return 'BLOCKED'
  }
  if (project.blockedReason) {
    return 'NEEDS_YOU'
  }
  // Real V1 stabilization finding (Operator UX pass, real browser testing
  // against the spec's own worked example): a DIRTY_PRESERVE project
  // (real uncommitted work sitting in the working tree) is healthy, but
  // it is not "ready for work" -- it needs a human to look at what's
  // there before anything touches it. The spec's own quoteloop example
  // names this exact case "NEEDS ATTENTION," not "ready for work."
  if (project.migrationClassification === 'DIRTY_PRESERVE') {
    return 'NEEDS_YOU'
  }
  if (WORKING_MISSION_STATES.has(project.missionState)) {
    return 'WORKING'
  }
  if (
    project.migrationClassification &&
    PAUSED_BY_DESIGN_CLASSIFICATIONS.has(project.migrationClassification)
  ) {
    return 'PAUSED'
  }
  if (project.healthStatus === 'DEGRADED' || project.healthStatus === 'BLOCKED') {
    return 'NEEDS_REPAIR'
  }
  if (project.healthStatus === 'HEALTHY') {
    return 'READY_FOR_WORK'
  }
  return 'UNKNOWN'
}

// A short, honest "why/what's next" line for a card -- reuses the same
// real facts the detail page already shows (blockedReason, the top health
// finding's own summary/remediation, restrictions) rather than a second
// classification.
export function explainProject(project: ProjectCard): { why: string | null; next: string | null } {
  if (project.blockedReason) {
    return { why: project.blockedReason, next: null }
  }
  if (project.restrictions.length > 0) {
    return { why: project.restrictions[0], next: null }
  }
  if (project.topFinding) {
    return { why: project.topFinding.summary, next: project.topFinding.remediation }
  }
  return { why: null, next: null }
}
