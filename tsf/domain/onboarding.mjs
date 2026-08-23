// Migration/onboarding classification and handoff reconciliation. Pure
// domain logic — no filesystem/Git access here (that's repo-inspector.mjs);
// this module only reasons about the facts it's given, evidence-backed.
import { createReceipt } from './receipts.mjs'

// Real onboarding evidence (WorldForge real-migration case): the selected
// repository can be a linked Git worktree — a bounded workstream branching
// off another local repository's admin directory — rather than the
// project's canonical checkout. `git rev-parse --absolute-git-dir` reports
// `<main-repo>/.git/worktrees/<name>` for a linked worktree (vs a plain
// `<repo>/.git` for the main checkout), which is exactly what
// repo-inspector.mjs's `gitDir` already carries — no new Git call needed.
export function isLinkedWorktreeGitDir(gitDir) {
  return typeof gitDir === 'string' && /[\\/]\.git[\\/]worktrees[\\/]/i.test(gitDir)
}

export const MIGRATION_CLASSIFICATIONS = Object.freeze([
  'SAFE_TO_ONBOARD_NOW',
  'READ_ONLY_ONBOARDING_ONLY',
  'DIRTY_PRESERVE',
  'SENSITIVE',
  'NOT_READY',
  // A handoff/live-repo disagreement over CURRENT-state facts (branch/HEAD/
  // dirty) that has not been explicitly resolved yet. Distinct from
  // TIM_REQUIRED (reserved for genuine repository-identity ambiguity, see
  // reconcileHandoff's identityAmbiguous below) — an ordinary current-state
  // discrepancy is a low-authority "we should confirm this" situation, not
  // one that should make even Known Projects impossible.
  'UNRESOLVED_HANDOFF_DISCREPANCY',
  'TIM_REQUIRED'
])

// Real onboarding/reconciliation deadlock (V1 stabilization finding): a
// handoff/live-repo conflict forced TIM_REQUIRED with no UI control to ever
// resolve it, and TIM_REQUIRED's gating blocked even Known Projects — a
// human decision the product never let the human make. These are the three
// resolutions Review can offer once real competing evidence is shown.
export const RECONCILIATION_RESOLUTION_MODES = Object.freeze([
  // Current-state facts (branch/HEAD/dirty/staged/unstaged/untracked/
  // worktrees/active Git operation) come from live Git truth; the handoff
  // is preserved as historical evidence/context, not deleted or rewritten.
  'USE_LIVE_REPO_FOR_CURRENT_STATE',
  // Explicitly preserve the discrepancy unresolved; only the safest
  // onboarding state is allowed.
  'KEEP_UNRESOLVED',
  // Deliberately chosen by the operator only. TSF still never overrides
  // observable Git truth for actual operations merely because a handoff
  // claims something different — this records the operator's acknowledged
  // choice, it does not change what current-state facts feed classification.
  'USE_HANDOFF'
])

// Real V1 stabilization finding (fleet-wide false positive, found refreshing
// real Known Projects): `\.env(\..*)?` matched `.env.example`/`.env.sample`
// identically to a real `.env` — but a committed template file with
// placeholder values is the RECOMMENDED safe convention, the opposite of a
// secret. Excluded by name, not by content (still zero filesystem reads
// beyond the existing path list).
const SENSITIVE_ENV_TEMPLATE_SUFFIX = /\.env\.(example|sample|template|dist)$/i
const SENSITIVE_PATH_PATTERN =
  /(^|[\\/])(\.env(\..*)?|.*\bcredentials?\b.*|.*\bsecrets?\b.*|.*\bprivate[-_]?key.*|id_rsa|id_ed25519)$/i

// Real V1 stabilization finding (flagged during the Health Repair Center
// build, fixed here): `.*\bcredentials?\b.*` / `.*\bsecrets?\b.*` match the
// word ANYWHERE in a path, so they fired identically on a project's own
// SECURITY-TOOLING filenames (real evidence: password-remediation's
// scripts/secret-scan.mjs, live/secret-safe-logger.mjs, tests/verify-
// rotate-credential-gate.test.mjs) and on VENDORED third-party dependency
// internals (real evidence: NWR's own .codex-cfbd-test-deps/pydantic_
// settings/sources/providers/secrets.py, .pycache-.../Lib/secrets.cpython-
// 312.pyc — that .pyc is the compiled bytecode of Python's own standard-
// library `secrets` module, nothing to do with a secret at all). Narrowed
// by exclusion, not by weakening the base pattern — a real secrets.json,
// .aws/credentials, or my-secret.pem is untouched by any of these three
// exclusions and still matches exactly as before.
const COMPILED_BYTECODE_ARTIFACT = /\.(pyc|pyo)$/i
const VENDORED_OR_DEPENDENCY_PATH =
  /(^|[\\/])(node_modules|\.venv|venv|site-packages|dist-packages|vendor|__pycache__|\.pycache-[^\\/]*|\.[a-z0-9]+-[a-z0-9-]*-deps)([\\/]|$)/i
// A filename carrying its own security-tooling/test marker (scans FOR
// secrets, gates/verifies credential handling, or is itself a test of
// that behavior) is evidence the project is testing/guarding against
// exposure, not exposing something — matched only against the final path
// segment so a directory named e.g. "safe" elsewhere in the path can't
// exempt an unrelated real secret file living inside it.
const SECURITY_TOOLING_OR_TEST_FILENAME =
  /(^|[\\/])[^\\/]*\b(scan|gate|audit|lint|verify|safe)\b[^\\/]*\.[a-z0-9]+$|\.(test|spec)\.[cm]?[jt]sx?$/i

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
  {
    code: 'PROD_DB_OR_DEPLOY',
    pattern: /\b(?:production|prod)\s+(?:database|db|deploy(?:ment)?|secrets?)\b/gi
  },
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
const NEGATION_MARKERS =
  /\b(?:no|not|none|never|n['’]t|zero|without|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|don['’]t|won['’]t|hasn['’]t|haven['’]t|didn['’]t|has\s+no|have\s+no|had\s+no)\b/i
const FUTURE_MARKERS =
  /\b(?:will\s+(?:be|become)|future|eventually|later|planned|plan\s+to|not\s+yet|once\s+we|when\s+we|upcoming|roadmap|someday|down\s+the\s+road|going\s+to\s+be)\b/i
const CLAUSE_BOUNDARY = /[.!?;\n]/

function extractClause(text, matchIndex, matchLength) {
  let start = matchIndex
  while (start > 0 && !CLAUSE_BOUNDARY.test(text[start - 1])) {
    start -= 1
  }
  let end = matchIndex + matchLength
  while (end < text.length && !CLAUSE_BOUNDARY.test(text[end])) {
    end += 1
  }
  return text.slice(start, end)
}

// Returns 'EXPLICIT_ABSENCE' | 'FUTURE' | 'CURRENT' for one signal occurrence,
// based only on the clause it appears in. Defaults to 'CURRENT' when neither
// a negation nor a future marker is present in that clause — a genuinely
// ambiguous match is treated as sensitive rather than silently downgraded,
// so this never weakens real detection (e.g. HouseOS/NWR-style projects).
function classifySignalTemporal(clause) {
  if (NEGATION_MARKERS.test(clause)) {
    return 'EXPLICIT_ABSENCE'
  }
  if (FUTURE_MARKERS.test(clause)) {
    return 'FUTURE'
  }
  return 'CURRENT'
}

// Scans one text for every configured prose signal, tagging each occurrence
// with its source and temporal class. Exported for the classifier's own
// tests and for `evidence.*` payloads consumed by the UI/planner.
export function detectSensitiveProseSignals(text, source) {
  if (!text) {
    return []
  }
  const found = []
  for (const { code, pattern } of SENSITIVE_PROSE_SIGNALS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text))) {
      const clause = extractClause(text, match.index, match[0].length)
      found.push({ code, source, phrase: match[0], temporal: classifySignalTemporal(clause) })
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex += 1
      }
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
    reasons.push(
      'Not a Git repository (or Git top-level could not be determined) — cannot safely reason about state.'
    )
    return { classification: 'NOT_READY', reasons, evidence: { gitRepositoryFound: false } }
  }

  if (facts.repositoryUnavailable) {
    reasons.push('Repository path is unavailable or inaccessible.')
    return { classification: 'NOT_READY', reasons, evidence: { repositoryUnavailable: true } }
  }

  const sensitivePaths = (facts.trackedAndUntrackedPaths ?? []).filter(
    (p) =>
      SENSITIVE_PATH_PATTERN.test(p) &&
      !SENSITIVE_ENV_TEMPLATE_SUFFIX.test(p) &&
      !COMPILED_BYTECODE_ARTIFACT.test(p) &&
      !VENDORED_OR_DEPENDENCY_PATH.test(p) &&
      !SECURITY_TOOLING_OR_TEST_FILENAME.test(p)
  )
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
    reasons.push(
      `An unfinished Git operation is in progress (${facts.activeGitOperationKind ?? 'unknown'}) — repository state cannot be trusted yet.`
    )
    return {
      classification: 'TIM_REQUIRED',
      reasons,
      evidence: { activeGitOperationKind: facts.activeGitOperationKind ?? null }
    }
  }

  // `facts.handoffConflict` here is the EFFECTIVE conflict (raw discrepancy
  // AND not resolved by an explicit USE_LIVE_REPO_FOR_CURRENT_STATE/
  // USE_HANDOFF choice — see reconcileHandoff). A genuine identity
  // ambiguity (neither the claimed branch nor the claimed commit can be
  // located anywhere in this repository) still fully blocks, matching the
  // pre-existing TIM_REQUIRED behavior for a case this uncertain. An
  // ordinary current-state discrepancy (branch/HEAD/dirty drift against a
  // repo that is still clearly the same project) no longer blocks Known
  // Projects — see portfolioGatingForClassification.
  if (facts.handoffConflict) {
    if (facts.handoffIdentityAmbiguous) {
      reasons.push(
        'The migration handoff cannot be placed in this repository at all (neither the claimed branch nor the claimed commit exists here) — this may be the wrong repository, or the handoff may belong elsewhere.'
      )
      evidence.handoffConflict = facts.handoffConflictSummary ?? true
      evidence.handoffIdentityAmbiguous = true
      return { classification: 'TIM_REQUIRED', reasons, evidence }
    }
    reasons.push(
      'The migration handoff disagrees with observed repository truth on branch/HEAD/dirty state — pick an authoritative source, or onboard as Known only until you do.'
    )
    evidence.handoffConflict = facts.handoffConflictSummary ?? true
    return { classification: 'UNRESOLVED_HANDOFF_DISCREPANCY', reasons, evidence }
  }

  if (facts.dirty) {
    const important = facts.untrackedCount > 0 || facts.stagedCount > 0 || facts.unstagedCount > 0
    reasons.push(
      `Repository has uncommitted work (${facts.stagedCount ?? 0} staged, ${facts.unstagedCount ?? 0} unstaged, ${facts.untrackedCount ?? 0} untracked) that must be preserved, not reset or cleaned.`
    )
    evidence.dirty = {
      staged: facts.stagedCount,
      unstaged: facts.unstagedCount,
      untracked: facts.untrackedCount
    }
    if (important) {
      return { classification: 'DIRTY_PRESERVE', reasons, evidence }
    }
  }

  const readOnlyReasons = []
  if (facts.discoveryConfidence === 'LOW') {
    readOnlyReasons.push(
      'Discovery confidence is low — too little could be determined about this project to onboard normally yet.'
    )
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

  reasons.push(
    'Repository is clean, understood, and shows no sensitive-runtime or conflict signals.'
  )
  if (explicitAbsenceSignals.length) {
    evidence.explicitlyAbsentSignals = explicitAbsenceSignals
  }
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
const PLANNED_WORK_PATTERN =
  /\b(?:planned|not\s+yet\s+implemented|to\s+be\s+built|future\s+work|roadmap\s+item|plans?\s+to\s+build)\b/i
const UNFINISHED_PRODUCT_PATTERN = /\b(?:unfinished|incomplete)\b/i
const BARE_WIP_PATTERN = /\b(?:wip|work[\s-]in[\s-]progress|dirty)\b/i

// V1 stabilization finding (silent-visual-speech-spike real migration): a
// handoff describing DATA/MEDIA/MODEL artifacts deliberately kept out of Git
// (licensing, size, or governance reasons — usually a .gitignore'd path) is
// not a claim about the project's own uncommitted SOURCE work. The real
// clause "Restricted NASA evaluation media stayed local and uncommitted"
// matched the bare word "uncommitted" and was misread as live, possibly-lost
// filesystem changes — it describes deliberately-excluded evaluation data,
// not code. Both a governance marker and a data/artifact noun must appear in
// the SAME clause for this exclusion to apply, so a genuine claim like
// ".env is uncommitted and restricted" (an actual file, not a data/media
// noun) is still flagged normally.
const RESTRICTED_ARTIFACT_MARKER_PATTERN =
  /\b(?:restricted|licens(?:e|ing|ed)|not\s+(?:a\s+)?durable\s+source\s+evidence|must\s+not\s+be\s+committed|should\s+not\s+be\s+committed|(?:git)?ignored)\b/i
const DATA_ARTIFACT_NOUN_PATTERN =
  /\b(?:media|datasets?|checkpoints?|model\s+weights?|training[\s-]data|evaluation\s+(?:media|data)|raw\s+(?:result|media)\s+files?|generated\s+media)\b/i

function classifyWorkStatusClaimInClause(clause) {
  if (GIT_STATE_COMMITTED_UNADOPTED_PATTERN.test(clause)) {
    return 'COMMITTED_UNADOPTED_WORK'
  }
  if (GIT_STATE_UNCOMMITTED_PATTERN.test(clause)) {
    if (
      RESTRICTED_ARTIFACT_MARKER_PATTERN.test(clause) &&
      DATA_ARTIFACT_NOUN_PATTERN.test(clause)
    ) {
      return null
    }
    return 'UNCOMMITTED_WORK'
  }
  if (PLANNED_WORK_PATTERN.test(clause)) {
    return 'PLANNED_WORK'
  }
  if (UNFINISHED_PRODUCT_PATTERN.test(clause)) {
    return 'UNFINISHED_PRODUCT_WORK'
  }
  if (BARE_WIP_PATTERN.test(clause)) {
    // A bare "WIP"/"dirty" adjective alongside an explicit "committed" claim
    // IN THE SAME CLAUSE describes HISTORY (work that used to be WIP and has
    // since been committed), not a live uncommitted-changes assertion.
    return /\bcommitted\b/i.test(clause) ? 'COMMITTED_UNADOPTED_WORK' : 'UNCOMMITTED_WORK'
  }
  return null
}

// Per-clause, not whole-text: a real independent-review finding showed a
// single whole-text classification lets an unrelated COMMITTED_UNADOPTED_WORK
// claim elsewhere in the handoff silently swallow a genuine UNCOMMITTED_WORK
// claim (whichever pattern matched first won, discarding the other) — a real
// two-topic handoff ("committed as a candidate ... separately, uncommitted
// debugging changes have not been committed yet") would lose its own
// legitimate "work may be lost" warning. Classifying clause-by-clause and
// returning every distinct claim actually present fixes that: each claim is
// judged only against its own sentence, and nothing is discarded because a
// different claim also appears elsewhere in the same handoff.
function classifyWorkStatusClaims(text) {
  const claims = new Set()
  for (const clause of text.split(/(?<=[.!?;\n])/)) {
    const claim = classifyWorkStatusClaimInClause(clause)
    if (claim) {
      claims.add(claim)
    }
  }
  return claims
}

// What Known Projects / Active Fleet / Work Set toggles are allowed and
// defaulted, per classification. Known Project never implies Work Set.
export function portfolioGatingForClassification(classification) {
  switch (classification) {
    case 'SAFE_TO_ONBOARD_NOW':
      return {
        knownProjects: { allowed: true, default: true },
        activeFleet: { allowed: true, default: true },
        workSet: { allowed: true, default: false }
      }
    case 'DIRTY_PRESERVE':
      return {
        knownProjects: { allowed: true, default: true },
        activeFleet: { allowed: true, default: true },
        workSet: { allowed: false, default: false }
      }
    case 'READ_ONLY_ONBOARDING_ONLY':
      return {
        knownProjects: { allowed: true, default: true },
        activeFleet: { allowed: false, default: false },
        workSet: { allowed: false, default: false }
      }
    case 'SENSITIVE':
      return {
        knownProjects: { allowed: true, default: true },
        activeFleet: { allowed: false, default: false },
        workSet: { allowed: false, default: false }
      }
    // Known Projects is a low-authority operation (TSF merely records that
    // the project exists) — an unresolved CURRENT-STATE discrepancy should
    // not make even that impossible. Active Fleet/Work Set stay gated until
    // the discrepancy is actually resolved.
    case 'UNRESOLVED_HANDOFF_DISCREPANCY':
      return {
        knownProjects: { allowed: true, default: true },
        activeFleet: { allowed: false, default: false },
        workSet: { allowed: false, default: false }
      }
    // TIM_REQUIRED is reserved for genuine repository-identity ambiguity
    // (see reconcileHandoff's identityAmbiguous) or an active, unfinished
    // Git operation — cases where even Known Projects would record a
    // project TSF cannot yet safely identify.
    case 'NOT_READY':
    case 'TIM_REQUIRED':
    default:
      return {
        knownProjects: { allowed: false, default: false },
        activeFleet: { allowed: false, default: false },
        workSet: { allowed: false, default: false }
      }
  }
}

// Real onboarding deadlock (V1 stabilization finding): the classifier could
// detect a handoff/live-repo disagreement but the product never gave the
// operator a way to resolve it, and every downstream toggle (Known/Active
// Fleet/Work Set) stayed disabled forever. `resolution` (optional) records
// an explicit operator choice among RECONCILIATION_RESOLUTION_MODES;
// `discrepancyDetails` gives Review the actual competing evidence
// (LIVE_REPO vs HANDOFF per field) to render controls against, not just a
// prose sentence.
function pushDiscrepancy(
  { discrepancies, discrepancyDetails },
  field,
  sentence,
  liveRepo,
  handoff
) {
  discrepancies.push(sentence)
  discrepancyDetails.push({ field, liveRepo, handoff })
}

// Compares handoff claims (untrusted prose evidence) against observed repo
// truth. Repository truth always wins; disagreements are surfaced, never
// silently resolved in the handoff's favor.
export function reconcileHandoff({ handoffText, repoFacts, resolution = null }) {
  if (!handoffText?.trim()) {
    return {
      hasHandoff: false,
      claims: [],
      discrepancies: [],
      discrepancyDetails: [],
      agreements: [],
      hasConflict: false,
      identityAmbiguous: false,
      resolution: null,
      effectiveConflict: false
    }
  }
  const text = handoffText
  const claims = []
  const discrepancies = []
  const discrepancyDetails = []
  const agreements = []
  const bucket = { discrepancies, discrepancyDetails }

  // Real onboarding evidence (Route Reader's and WorldForge's actual
  // migration handoffs): "Last experimental commit: `712e45c`." and
  // "Implementation checkpoint: `24922c66...`." are common structured
  // documentation lines the original prose-only pattern (requiring the
  // keyword immediately followed by whitespace then the hex) never matched
  // — a colon and/or backtick between the keyword and the value broke the
  // adjacency. Now allows an optional `:` and backticks in between.
  //
  // Independent-review finding (post-adoption hardening): [0-9a-f]{7,40}
  // also matches a bare decimal number ("Latency measured at 1234567890
  // nanoseconds") since every digit is valid hex — requiring at least one
  // a-f letter rules those out, since a real short SHA is never all-decimal
  // in practice, without narrowing genuine hex-only commit hashes.
  const shaMatch = text
    .match(/\b(?:at|head|commit)\b\s*:?\s*`?([0-9a-f]{7,40})`?\b/i)?.[1]
    ?.toLowerCase()
  const shaClaim = shaMatch && /[a-f]/.test(shaMatch) ? shaMatch : undefined
  let shaFoundAnywhere = true
  if (shaClaim) {
    claims.push({ field: 'head', claimed: shaClaim })
    const observedHead = (repoFacts.head ?? '').toLowerCase()
    const matchesHead =
      observedHead &&
      (observedHead.startsWith(shaClaim) ||
        shaClaim.startsWith(observedHead.slice(0, shaClaim.length)))
    const matchesRecentHistory = (repoFacts.recentCommits ?? []).some((c) => {
      const sha = (c.sha ?? '').toLowerCase()
      return sha && (sha.startsWith(shaClaim) || shaClaim.startsWith(sha.slice(0, shaClaim.length)))
    })
    shaFoundAnywhere = matchesHead || matchesRecentHistory
    // A claimed commit that's simply not the current tip anymore, but is
    // genuinely somewhere in this repository's recent history, is ordinary
    // drift (a few commits happened since the handoff was written) — not a
    // discrepancy worth surfacing, let alone blocking on.
    if (observedHead && !matchesHead && !matchesRecentHistory) {
      pushDiscrepancy(
        bucket,
        'head',
        `Handoff says HEAD is \`${shaClaim}\`. Repository is currently at \`${observedHead.slice(0, 10)}\`.`,
        { value: observedHead.slice(0, 10) },
        { value: shaClaim }
      )
    } else if (observedHead && matchesHead) {
      agreements.push(`HEAD matches the handoff's claimed commit.`)
    } else if (observedHead && matchesRecentHistory) {
      agreements.push(
        `Handoff's claimed commit \`${shaClaim}\` is in this repository's recent history (HEAD has since moved).`
      )
    }
  }

  // Real onboarding evidence (WorldForge's actual migration handoff): a
  // structured "Branch: `X`" header line declares which branch the handoff
  // is about without asserting cleanliness anywhere near it — the original
  // prose-only pattern (requiring the word "clean" in the same match) never
  // recognized this common documentation style at all. Falls back to it
  // only when no prose "branch X is clean" claim is present; downstream
  // comparison logic is identical either way.
  const branchClaim =
    text.match(/\b(?:branch|on)\s+["'`]?([\w./-]+)["'`]?\s+(?:is|was)?\s*clean\b/i) ??
    text.match(/^\s*[-*]?\s*Branch(?:\s+at\s+handoff)?\s*:\s*`?([\w./-]+)`?[.,;]?\s*$/im)
  const cleanClaimed = /\bclean\b/i.test(text) && !/\bnot\s+clean\b|\bdirty\b/i.test(text)
  if (cleanClaimed && repoFacts.dirty) {
    pushDiscrepancy(
      bucket,
      'workingTree',
      `Handoff says the repository is clean. Repository is currently dirty${repoFacts.untrackedCount ? ` with ${repoFacts.untrackedCount} untracked file(s)` : ''}${repoFacts.head ? ` at \`${repoFacts.head.slice(0, 10)}\`` : ''}.`,
      {
        value: 'dirty',
        staged: repoFacts.stagedCount,
        unstaged: repoFacts.unstagedCount,
        untracked: repoFacts.untrackedCount
      },
      { value: 'clean' }
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
  const workStatusClaims = classifyWorkStatusClaims(text)
  // Both checked independently (a handoff can legitimately make both claims
  // about different work in the same message) — a COMMITTED_UNADOPTED_WORK
  // claim elsewhere must never suppress a genuine UNCOMMITTED_WORK warning.
  if (workStatusClaims.has('UNCOMMITTED_WORK')) {
    if (!repoFacts.dirty) {
      pushDiscrepancy(
        bucket,
        'workingTree',
        'Handoff describes uncommitted work. Repository is currently clean — that work may already be committed, lost, or in a different location.',
        { value: 'clean' },
        { value: 'uncommitted work described' }
      )
    } else {
      agreements.push(
        "Handoff describes uncommitted work, matching the repository's current dirty state."
      )
    }
  }
  if (workStatusClaims.has('COMMITTED_UNADOPTED_WORK')) {
    agreements.push(
      'Handoff describes committed-but-unadopted work — a clean working tree is expected here, not a sign anything was lost.'
    )
  }
  // PLANNED_WORK and UNFINISHED_PRODUCT_WORK describe product/roadmap
  // completeness, not Git state — neither a clean nor a dirty tree
  // contradicts them, so no discrepancy or agreement is recorded either way.
  // UNKNOWN (no claim recognized at all) is likewise left unreconciled
  // rather than guessed at.

  let branchFoundAnywhere = true
  if (branchClaim) {
    const claimedBranch = branchClaim[1]
    claims.push({ field: 'branch', claimed: claimedBranch })
    const existsElsewhere = (repoFacts.localBranches ?? []).some((b) => b.name === claimedBranch)
    if (repoFacts.branch && repoFacts.branch !== claimedBranch && !existsElsewhere) {
      branchFoundAnywhere = false
      pushDiscrepancy(
        bucket,
        'branch',
        `Handoff refers to branch \`${claimedBranch}\`. Repository is currently on \`${repoFacts.branch}\`, and no local branch named \`${claimedBranch}\` was found.`,
        { value: repoFacts.branch },
        { value: claimedBranch }
      )
    } else if (repoFacts.branch && repoFacts.branch !== claimedBranch && existsElsewhere) {
      agreements.push(
        `Handoff refers to branch \`${claimedBranch}\`, which exists locally (just not currently checked out).`
      )
    }
  }

  // Real onboarding evidence (WorldForge's actual migration handoff): a
  // handoff can explicitly name a DIFFERENT repository path than the one
  // selected for onboarding (a stale/misattached handoff, or the wrong repo
  // was pointed at) — the strongest possible identity signal, distinct from
  // an ordinary branch/HEAD drift on the SAME repository.
  const repoClaim = text
    .match(
      /^\s*[-*]?\s*Repository(?:\s+path)?(?:\s+at\s+handoff)?\s*:\s*`?([^`\n]+?)`?[.,;]?\s*$/im
    )?.[1]
    ?.trim()
  let repositoryMismatch = false
  if (repoClaim && repoFacts.root) {
    claims.push({ field: 'repository', claimed: repoClaim })
    const normalize = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (normalize(repoClaim) !== normalize(repoFacts.root)) {
      repositoryMismatch = true
      pushDiscrepancy(
        bucket,
        'repository',
        `Handoff says this repository is \`${repoClaim}\`. The selected repository is \`${repoFacts.root}\`.`,
        { value: repoFacts.root },
        { value: repoClaim }
      )
    } else {
      agreements.push("Handoff's claimed repository path matches the selected repository.")
    }
  }

  const hasConflict = discrepancies.length > 0
  // Genuine repository-identity ambiguity, not ordinary current-state drift:
  // either the handoff explicitly names a different repository altogether
  // (repositoryMismatch), or BOTH a claimed branch and a claimed commit are
  // present AND neither can be located anywhere in this repository (not
  // just "not currently checked out"/"not the latest commit"). An ordinary
  // branch or HEAD mismatch alone — the common case when a handoff is
  // simply a bit stale — is not identity ambiguity and must not block
  // Known Projects.
  const identityAmbiguous =
    repositoryMismatch || !!(branchClaim && !branchFoundAnywhere && shaClaim && !shaFoundAnywhere)

  // Resolution: an explicit operator choice recorded against this exact set
  // of discrepancies. USE_LIVE_REPO_FOR_CURRENT_STATE and USE_HANDOFF both
  // clear the block (the handoff is preserved as historical evidence either
  // way — nothing here ever changes what `repoFacts` says, only whether the
  // conflict still blocks classification). KEEP_UNRESOLVED (or no
  // resolution at all) leaves it blocking.
  const resolved =
    hasConflict &&
    (resolution?.mode === 'USE_LIVE_REPO_FOR_CURRENT_STATE' || resolution?.mode === 'USE_HANDOFF')
  const effectiveConflict = hasConflict && !resolved

  return {
    hasHandoff: true,
    claims,
    discrepancies,
    discrepancyDetails,
    agreements,
    hasConflict,
    identityAmbiguous,
    resolution: resolution ?? null,
    effectiveConflict
  }
}

// Reuses the real hash-chained receipt system (tsf/domain/receipts.mjs) —
// onboarding a project is a recorded decision like any other, not a
// separate ad hoc record shape. `reconciliationResolution` (optional)
// records what the operator chose and which evidence was superseded for
// current-state purposes, so the durable receipt — not just the transient
// Review screen — answers "what did I decide, and why".
export function buildOnboardingReceipt({
  projectId,
  repoPath,
  classification,
  addedTo,
  orcaRegistration,
  reconciliationResolution = null,
  previousReceiptHash = null,
  clock
}) {
  return createReceipt(
    {
      kind: 'PROJECT_ONBOARDED',
      projectId,
      missionId: `onboarding:${projectId}`,
      result: classification,
      decision: JSON.stringify({ addedTo, reconciliationResolution }),
      identities: { repoPath, orcaRegistration: orcaRegistration ?? null }
    },
    { previousReceiptHash, clock }
  )
}
