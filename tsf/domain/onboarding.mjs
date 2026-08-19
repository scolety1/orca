// Migration/onboarding classification and handoff reconciliation. Pure
// domain logic — no filesystem/Git access here (that's repo-inspector.mjs);
// this module only reasons about the facts it's given, evidence-backed.
import { createReceipt } from './receipts.mjs'

export const MIGRATION_CLASSIFICATIONS = Object.freeze([
  'SAFE_TO_ONBOARD_NOW',
  'READ_ONLY_ONBOARDING_ONLY',
  'DIRTY_PRESERVE',
  'SENSITIVE',
  'NOT_READY',
  'TIM_REQUIRED'
])

const SENSITIVE_PATH_PATTERN = /(^|[\\/])(\.env(\..*)?|.*\bcredentials?\b.*|.*\bsecrets?\b.*|.*\bprivate[-_]?key.*|id_rsa|id_ed25519)$/i
const SENSITIVE_TEXT_PATTERN = /\b(production|prod)\s+(database|db|credential|deploy|secret)|real\s+(user|customer|payment)s?\b|\blive\s+(payment|billing|credential)s?\b/i

// Evidence-backed classification: every reason cites the exact fact that
// produced it, so the UI/planner can show why, not just the label.
export function classifyMigration(facts) {
  const reasons = []
  const evidence = {}

  if (!facts.gitRepositoryFound) {
    reasons.push('Not a Git repository (or Git top-level could not be determined) — cannot safely reason about state.')
    return { classification: 'NOT_READY', reasons, evidence: { gitRepositoryFound: false } }
  }

  if (facts.repositoryUnavailable) {
    reasons.push('Repository path is unavailable or inaccessible.')
    return { classification: 'NOT_READY', reasons, evidence: { repositoryUnavailable: true } }
  }

  const sensitivePaths = (facts.trackedAndUntrackedPaths ?? []).filter((p) => SENSITIVE_PATH_PATTERN.test(p))
  const sensitiveTextHits = [facts.readmeExcerpt, facts.instructionsExcerpt, facts.handoffText]
    .filter(Boolean)
    .some((text) => SENSITIVE_TEXT_PATTERN.test(text))
  if (sensitivePaths.length || sensitiveTextHits || facts.declaredSensitive) {
    evidence.sensitivePaths = sensitivePaths.slice(0, 10)
    evidence.sensitiveTextMatched = sensitiveTextHits
    reasons.push(
      sensitivePaths.length
        ? `Sensitive-looking path(s) present: ${sensitivePaths.slice(0, 3).join(', ')}${sensitivePaths.length > 3 ? '…' : ''}.`
        : 'Project text references production/real-user/payment concerns.'
    )
    return { classification: 'SENSITIVE', reasons, evidence }
  }

  if (facts.activeGitOperation) {
    reasons.push(`An unfinished Git operation is in progress (${facts.activeGitOperationKind ?? 'unknown'}) — repository state cannot be trusted yet.`)
    return { classification: 'TIM_REQUIRED', reasons, evidence: { activeGitOperationKind: facts.activeGitOperationKind ?? null } }
  }

  if (facts.handoffConflict) {
    reasons.push('The migration handoff disagrees with observed repository truth on branch/HEAD/dirty state — an authoritative source must be chosen.')
    evidence.handoffConflict = facts.handoffConflictSummary ?? true
    return { classification: 'TIM_REQUIRED', reasons, evidence }
  }

  if (facts.dirty) {
    const important = facts.untrackedCount > 0 || facts.stagedCount > 0 || facts.unstagedCount > 0
    reasons.push(
      `Repository has uncommitted work (${facts.stagedCount ?? 0} staged, ${facts.unstagedCount ?? 0} unstaged, ${facts.untrackedCount ?? 0} untracked) that must be preserved, not reset or cleaned.`
    )
    evidence.dirty = { staged: facts.stagedCount, unstaged: facts.unstagedCount, untracked: facts.untrackedCount }
    if (important) return { classification: 'DIRTY_PRESERVE', reasons, evidence }
  }

  if (facts.discoveryConfidence === 'LOW') {
    reasons.push('Discovery confidence is low — too little could be determined about this project to onboard normally yet.')
    return { classification: 'READ_ONLY_ONBOARDING_ONLY', reasons, evidence: { discoveryConfidence: 'LOW' } }
  }

  reasons.push('Repository is clean, understood, and shows no sensitive-runtime or conflict signals.')
  return { classification: 'SAFE_TO_ONBOARD_NOW', reasons, evidence }
}

// What Known Projects / Active Fleet / Work Set toggles are allowed and
// defaulted, per classification. Known Project never implies Work Set.
export function portfolioGatingForClassification(classification) {
  switch (classification) {
    case 'SAFE_TO_ONBOARD_NOW':
      return { knownProjects: { allowed: true, default: true }, activeFleet: { allowed: true, default: true }, workSet: { allowed: true, default: false } }
    case 'DIRTY_PRESERVE':
      return { knownProjects: { allowed: true, default: true }, activeFleet: { allowed: true, default: true }, workSet: { allowed: false, default: false } }
    case 'READ_ONLY_ONBOARDING_ONLY':
      return { knownProjects: { allowed: true, default: true }, activeFleet: { allowed: false, default: false }, workSet: { allowed: false, default: false } }
    case 'SENSITIVE':
      return { knownProjects: { allowed: true, default: true }, activeFleet: { allowed: false, default: false }, workSet: { allowed: false, default: false } }
    case 'NOT_READY':
    case 'TIM_REQUIRED':
    default:
      return { knownProjects: { allowed: false, default: false }, activeFleet: { allowed: false, default: false }, workSet: { allowed: false, default: false } }
  }
}

// Compares handoff claims (untrusted prose evidence) against observed repo
// truth. Repository truth always wins; disagreements are surfaced, never
// silently resolved in the handoff's favor.
export function reconcileHandoff({ handoffText, repoFacts }) {
  if (!handoffText?.trim()) {
    return { hasHandoff: false, claims: [], discrepancies: [], agreements: [] }
  }
  const text = handoffText
  const claims = []
  const discrepancies = []
  const agreements = []

  const shaClaim = text.match(/\b(?:at|head|commit)\s+([0-9a-f]{7,40})\b/i)?.[1]?.toLowerCase()
  if (shaClaim) {
    claims.push({ field: 'head', claimed: shaClaim })
    const observedHead = (repoFacts.head ?? '').toLowerCase()
    if (observedHead && !observedHead.startsWith(shaClaim) && !shaClaim.startsWith(observedHead.slice(0, shaClaim.length))) {
      discrepancies.push(`Handoff says HEAD is \`${shaClaim}\`. Repository is currently at \`${observedHead.slice(0, 10)}\`.`)
    } else if (observedHead) {
      agreements.push(`HEAD matches the handoff's claimed commit.`)
    }
  }

  const branchClaim = text.match(/\b(?:branch|on)\s+["'`]?([\w./-]+)["'`]?\s+(?:is|was)?\s*clean\b/i)
  const cleanClaimed = /\bclean\b/i.test(text) && !/\bnot\s+clean\b|\bdirty\b/i.test(text)
  const dirtyClaimed = /\bdirty\b|\buncommitted\b|\bwip\b/i.test(text)
  if (cleanClaimed && repoFacts.dirty) {
    discrepancies.push(
      `Handoff says the repository is clean. Repository is currently dirty${repoFacts.untrackedCount ? ` with ${repoFacts.untrackedCount} untracked file(s)` : ''}${repoFacts.head ? ` at \`${repoFacts.head.slice(0, 10)}\`` : ''}.`
    )
  } else if (cleanClaimed && !repoFacts.dirty) {
    agreements.push('Repository is clean, matching the handoff.')
  }
  if (dirtyClaimed && !repoFacts.dirty) {
    discrepancies.push('Handoff describes uncommitted/WIP work. Repository is currently clean — that work may already be committed, lost, or in a different location.')
  }

  if (branchClaim) {
    claims.push({ field: 'branch', claimed: branchClaim[1] })
    if (repoFacts.branch && repoFacts.branch !== branchClaim[1]) {
      discrepancies.push(`Handoff refers to branch \`${branchClaim[1]}\`. Repository is currently on \`${repoFacts.branch}\`.`)
    }
  }

  return { hasHandoff: true, claims, discrepancies, agreements, hasConflict: discrepancies.length > 0 }
}

// Reuses the real hash-chained receipt system (tsf/domain/receipts.mjs) —
// onboarding a project is a recorded decision like any other, not a
// separate ad hoc record shape.
export function buildOnboardingReceipt({ projectId, repoPath, classification, addedTo, orcaRegistration, previousReceiptHash = null, clock }) {
  return createReceipt(
    {
      kind: 'PROJECT_ONBOARDED',
      projectId,
      missionId: `onboarding:${projectId}`,
      result: classification,
      decision: JSON.stringify(addedTo),
      identities: { repoPath, orcaRegistration: orcaRegistration ?? null }
    },
    { previousReceiptHash, clock }
  )
}
