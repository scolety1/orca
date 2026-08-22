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

// Prose signals: each pattern captures a phrase that, read at face value with
// no surrounding negation/future framing, asserts a CURRENT sensitive-
// operational condition (real production data, real users, live payments/
// credentials). Deliberately separate from SENSITIVE_PATH_PATTERN above,
// which is unaffected by any of this and still fires on its own.
//
// Real defect this replaces (M7 real-migration finding): the original single
// regex matched the bare phrase anywhere in the text, so "no production
// database", "no real users", and "no paid services" — a project explicitly
// describing what it is NOT — matched identically to a project asserting
// those conditions ARE true. Negation/future framing must be checked in the
// same clause as the match, not assumed away.
const SENSITIVE_PROSE_SIGNALS = [
  { code: 'PROD_DB_OR_DEPLOY', pattern: /\b(?:production|prod)\s+(?:database|db|deploy(?:ment)?|secrets?)\b/gi },
  { code: 'REAL_USER_DATA', pattern: /\breal[\s-](?:user|customer)s?\b/gi },
  { code: 'REAL_PAYMENTS', pattern: /\breal\s+payments?\b/gi },
  { code: 'LIVE_PAYMENTS_OR_BILLING', pattern: /\blive\s+(?:payments?|billing)\b/gi },
  { code: 'LIVE_CREDENTIALS', pattern: /\blive\s+credentials?\b/gi },
  { code: 'PAID_SERVICES', pattern: /\bpaid\s+(?:service|api|subscription)s?\b/gi },
  { code: 'CREDENTIALS_REQUIRED', pattern: /\bcredentials?\s+(?:are|is)\s+required\b/gi },
  { code: 'DEPLOYED_TO_PRODUCTION', pattern: /\b(?:deployed|deployment)\s+to\s+production\b/gi },
  { code: 'LIVE_CUSTOMER_DATA', pattern: /\blive\s+customer\s+data\b/gi },
  { code: 'GPS_OR_LOCATION_DATA', pattern: /\b(?:real|live)\s+(?:gps|location)\s+data\b/gi }
]

// Negation/future markers are checked within the same clause as the match
// (bounded by sentence/line/semicolon punctuation on either side), not just
// a fixed character window — "no production database is active" and
// "production database is active" must not share a clause-detection window
// wide enough to blur which phrase they actually modify.
const NEGATION_MARKERS = /\b(?:no|not|none|never|n['’]t|zero|without|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|don['’]t|won['’]t|hasn['’]t|haven['’]t|didn['’]t|has\s+no|have\s+no|had\s+no)\b/i
const FUTURE_MARKERS = /\b(?:will\s+(?:be|become)|future|eventually|later|planned|plan\s+to|not\s+yet|once\s+we|when\s+we|upcoming|roadmap|someday|down\s+the\s+road|going\s+to\s+be)\b/i
const CLAUSE_BOUNDARY = /[.!?;\n]/

function extractClause(text, matchIndex, matchLength) {
  let start = matchIndex
  while (start > 0 && !CLAUSE_BOUNDARY.test(text[start - 1])) start -= 1
  let end = matchIndex + matchLength
  while (end < text.length && !CLAUSE_BOUNDARY.test(text[end])) end += 1
  return text.slice(start, end)
}

// Returns 'EXPLICIT_ABSENCE' | 'FUTURE' | 'CURRENT' for one signal occurrence,
// based only on the clause it appears in. Defaults to 'CURRENT' when neither
// a negation nor a future marker is present in that clause — a genuinely
// ambiguous match is treated as sensitive rather than silently downgraded,
// so this never weakens real detection (e.g. HouseOS/NWR-style projects).
function classifySignalTemporal(clause) {
  if (NEGATION_MARKERS.test(clause)) return 'EXPLICIT_ABSENCE'
  if (FUTURE_MARKERS.test(clause)) return 'FUTURE'
  return 'CURRENT'
}

// Scans one text for every configured prose signal, tagging each occurrence
// with its source and temporal class. Exported for the classifier's own
// tests and for `evidence.*` payloads consumed by the UI/planner.
export function detectSensitiveProseSignals(text, source) {
  if (!text) return []
  const found = []
  for (const { code, pattern } of SENSITIVE_PROSE_SIGNALS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text))) {
      const clause = extractClause(text, match.index, match[0].length)
      found.push({ code, source, phrase: match[0], temporal: classifySignalTemporal(clause) })
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1
    }
  }
  return found
}

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
  const proseSignals = [
    ...detectSensitiveProseSignals(facts.readmeExcerpt, 'README'),
    ...detectSensitiveProseSignals(facts.instructionsExcerpt, 'INSTRUCTIONS'),
    ...detectSensitiveProseSignals(facts.handoffText, 'HANDOFF')
  ]
  const currentSignals = proseSignals.filter((s) => s.temporal === 'CURRENT')
  const futureSignals = proseSignals.filter((s) => s.temporal === 'FUTURE')
  const explicitAbsenceSignals = proseSignals.filter((s) => s.temporal === 'EXPLICIT_ABSENCE')

  if (sensitivePaths.length || currentSignals.length || facts.declaredSensitive) {
    evidence.sensitivePaths = sensitivePaths.slice(0, 10)
    evidence.currentSensitiveSignals = currentSignals
    evidence.futureSensitiveSignals = futureSignals
    evidence.explicitlyAbsentSignals = explicitAbsenceSignals
    reasons.push(
      sensitivePaths.length
        ? `Sensitive-looking path(s) present: ${sensitivePaths.slice(0, 3).join(', ')}${sensitivePaths.length > 3 ? '…' : ''}.`
        : `Project text asserts a current sensitive condition: "${currentSignals[0].phrase}" (${currentSignals[0].source.toLowerCase()}, evidence class: CURRENT).`
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

  const readOnlyReasons = []
  if (facts.discoveryConfidence === 'LOW') {
    readOnlyReasons.push('Discovery confidence is low — too little could be determined about this project to onboard normally yet.')
  }
  // A FUTURE-classed signal (e.g. "future real GPS data will be sensitive")
  // is real evidence worth surfacing, but it does not mean the project is
  // CURRENTLY sensitive — the correct, non-punitive response is read-only
  // onboarding, not the SENSITIVE label reserved for a current condition.
  if (futureSignals.length) {
    readOnlyReasons.push(
      `Project text describes a future/potential sensitive condition: "${futureSignals[0].phrase}" (${futureSignals[0].source.toLowerCase()}, evidence class: FUTURE) — not currently sensitive, but read-only onboarding is the safer default until that materializes.`
    )
  }
  if (readOnlyReasons.length) {
    evidence.discoveryConfidence = facts.discoveryConfidence ?? null
    evidence.futureSensitiveSignals = futureSignals
    evidence.explicitlyAbsentSignals = explicitAbsenceSignals
    return { classification: 'READ_ONLY_ONBOARDING_ONLY', reasons: readOnlyReasons, evidence }
  }

  reasons.push('Repository is clean, understood, and shows no sensitive-runtime or conflict signals.')
  if (explicitAbsenceSignals.length) evidence.explicitlyAbsentSignals = explicitAbsenceSignals
  return { classification: 'SAFE_TO_ONBOARD_NOW', reasons, evidence }
}

// Work-status claim model (M7 real-migration finding): a handoff's mention of
// unfinished/WIP-sounding work is NOT equivalent to a live filesystem-level
// uncommitted-changes claim. Distinguishes:
//  - UNCOMMITTED_WORK: staged/unstaged/untracked changes right now.
//  - COMMITTED_UNADOPTED_WORK: a real commit/branch/candidate exists but
//    isn't accepted — a clean working tree is the EXPECTED state here.
//  - UNFINISHED_PRODUCT_WORK: the product/research is incomplete even
//    though Git can be perfectly clean.
//  - PLANNED_WORK: not yet implemented at all.
//  - UNKNOWN / null: no recognizable work-status claim in the text.
const GIT_STATE_UNCOMMITTED_PATTERN =
  /\b(?:uncommitted|not\s+committed|unstaged|un-staged|untracked\s+files?|working\s+tree\s+(?:has|contains)\s+changes|haven['’]t\s+committed|dirty\s+working\s+(?:tree|directory)|working\s+directory\s+is\s+dirty)\b/i
const GIT_STATE_COMMITTED_UNADOPTED_PATTERN =
  /\bcommitted\b.{0,60}?\b(?:unadopted|not\s+(?:yet\s+)?adopted|not\s+(?:yet\s+)?merged|unmerged|awaiting\s+adoption|pending\s+adoption|candidate)\b|\b(?:unadopted|not\s+(?:yet\s+)?adopted|not\s+(?:yet\s+)?merged|unmerged|awaiting\s+adoption|pending\s+adoption)\b.{0,60}?\bcommitted\b/is
const PLANNED_WORK_PATTERN = /\b(?:planned|not\s+yet\s+implemented|to\s+be\s+built|future\s+work|roadmap\s+item|plans?\s+to\s+build)\b/i
const UNFINISHED_PRODUCT_PATTERN = /\b(?:unfinished|incomplete)\b/i
const BARE_WIP_PATTERN = /\b(?:wip|work[\s-]in[\s-]progress|dirty)\b/i

function classifyWorkStatusClaim(text) {
  if (GIT_STATE_COMMITTED_UNADOPTED_PATTERN.test(text)) return 'COMMITTED_UNADOPTED_WORK'
  if (GIT_STATE_UNCOMMITTED_PATTERN.test(text)) return 'UNCOMMITTED_WORK'
  if (PLANNED_WORK_PATTERN.test(text)) return 'PLANNED_WORK'
  if (UNFINISHED_PRODUCT_PATTERN.test(text)) return 'UNFINISHED_PRODUCT_WORK'
  if (BARE_WIP_PATTERN.test(text)) {
    // A bare "WIP"/"dirty" adjective alongside an explicit "committed" claim
    // describes HISTORY (work that used to be WIP and has since been
    // committed), not a live uncommitted-changes assertion — nothing here
    // actually claims the working tree itself is dirty right now.
    return /\bcommitted\b/i.test(text) ? 'COMMITTED_UNADOPTED_WORK' : 'UNCOMMITTED_WORK'
  }
  return null
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
  if (cleanClaimed && repoFacts.dirty) {
    discrepancies.push(
      `Handoff says the repository is clean. Repository is currently dirty${repoFacts.untrackedCount ? ` with ${repoFacts.untrackedCount} untracked file(s)` : ''}${repoFacts.head ? ` at \`${repoFacts.head.slice(0, 10)}\`` : ''}.`
    )
  } else if (cleanClaimed && !repoFacts.dirty) {
    agreements.push('Repository is clean, matching the handoff.')
  }

  // Work-status model (M7 real-migration finding): a handoff mentioning
  // unfinished/WIP-sounding work does not always mean the *filesystem* is
  // currently dirty. "Committed YELLOW research", "implemented but
  // unadopted", and "unfinished research" all naturally leave a clean
  // working tree — only a genuine UNCOMMITTED_WORK claim against a clean
  // repo is real evidence something might be lost.
  const workStatusClaim = classifyWorkStatusClaim(text)
  if (workStatusClaim === 'UNCOMMITTED_WORK') {
    if (!repoFacts.dirty) {
      discrepancies.push('Handoff describes uncommitted work. Repository is currently clean — that work may already be committed, lost, or in a different location.')
    } else {
      agreements.push('Handoff describes uncommitted work, matching the repository\'s current dirty state.')
    }
  } else if (workStatusClaim === 'COMMITTED_UNADOPTED_WORK') {
    agreements.push('Handoff describes committed-but-unadopted work — a clean working tree is expected here, not a sign anything was lost.')
  }
  // PLANNED_WORK and UNFINISHED_PRODUCT_WORK describe product/roadmap
  // completeness, not Git state — neither a clean nor a dirty tree
  // contradicts them, so no discrepancy or agreement is recorded either way.
  // UNKNOWN (no claim recognized at all) is likewise left unreconciled
  // rather than guessed at.

  if (branchClaim) {
    const claimedBranch = branchClaim[1]
    claims.push({ field: 'branch', claimed: claimedBranch })
    const existsElsewhere = (repoFacts.localBranches ?? []).some((b) => b.name === claimedBranch)
    if (repoFacts.branch && repoFacts.branch !== claimedBranch && !existsElsewhere) {
      discrepancies.push(`Handoff refers to branch \`${claimedBranch}\`. Repository is currently on \`${repoFacts.branch}\`, and no local branch named \`${claimedBranch}\` was found.`)
    } else if (repoFacts.branch && repoFacts.branch !== claimedBranch && existsElsewhere) {
      agreements.push(`Handoff refers to branch \`${claimedBranch}\`, which exists locally (just not currently checked out).`)
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
