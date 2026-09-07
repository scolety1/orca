// Native Self-Improvement Loop V1, Phase 1: ONE generic durable finding
// contract spanning every detector this program has (UI Dogfood, golden-path
// eval, Research eval, runtime assertions, Command dogfood, security/
// adversarial fixtures, resource/runtime diagnostics). Modeled directly on
// research-mission.mjs's own assertNodeTransition convention (REUSE_PATTERN:
// same frozen ALLOWED-transition table + throw-with-.code shape) and reuses
// ui-dogfood-finding.mjs's SEVERITY_LEVELS vocabulary rather than inventing a
// parallel one (that module's own FINDING_CATEGORIES stays UI-viewport-scoped
// by design -- see candidateFixScope.kind below for the generalized,
// cross-detector equivalent, owned by self-improvement-autofix-eligibility.mjs).
//
// Field names here are camelCase, not the mission brief's literal snake_case
// (finding_id, project_id, ...) -- every existing durable record in this
// codebase (schemaVersion, projectId, createdAt, ...) uses camelCase with zero
// exceptions; introducing snake_case here would be a second, inconsistent
// convention for no real benefit.
import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { SEVERITY_LEVELS } from './ui-dogfood-finding.mjs'

export { SEVERITY_LEVELS }

export const FINDING_SCHEMA_VERSION = 'TSF_SELF_IMPROVEMENT_FINDING_V1'

// One entry per detector class named in the mission brief. Fail-closed
// eligibility (self-improvement-autofix-eligibility.mjs) refuses anything
// outside this set rather than guessing.
export const SOURCE_DETECTORS = Object.freeze([
  'UI_DOGFOOD',
  'COMMAND_DOGFOOD',
  'GOLDEN_PATH_EVAL',
  'RESEARCH_EVAL',
  'RUNTIME_ASSERTION',
  'SECURITY_ADVERSARIAL',
  'RESOURCE_DIAGNOSTIC'
])

export const FINDING_STATUSES = Object.freeze([
  'DETECTED',
  'VERIFIED',
  'ELIGIBLE_FOR_AUTOFIX',
  'NEEDS_OWNER',
  'FIX_MISSION_CREATED',
  'FIX_IN_PROGRESS',
  'READY_FOR_ADOPTION',
  'RESOLVED',
  'REOPENED',
  'REJECTED_FALSE_POSITIVE'
])

// Mirrors research-mission.mjs's NODE_ALLOWED shape exactly (a frozen map of
// legal next-states per current state). Non-obvious edges only:
// - DETECTED never jumps straight to an eligibility outcome -- verification
//   (confirming the finding actually reproduces) always comes first, exactly
//   like research-mission.mjs never lets a claim skip straight to VERIFIED.
// - VERIFIED/ELIGIBLE_FOR_AUTOFIX/REOPENED may all still resolve to
//   REJECTED_FALSE_POSITIVE -- a later re-examination can overturn an earlier
//   verification (mirrors research-mission.mjs's own FAILED -> ADMITTED late-
//   correction allowance).
// - NEEDS_OWNER -> RESOLVED covers an owner fixing something out-of-band
//   (never via an autofix mission) without forcing a fake FIX_MISSION_CREATED
//   hop first.
// - RESOLVED -> REOPENED is the only way back in; REJECTED_FALSE_POSITIVE is
//   terminal by design (a human decision, never silently reversed by a
//   detector re-observing the same symptom -- see recordFindingDetection's
//   own comment below for what happens instead).
const STATUS_ALLOWED = Object.freeze({
  DETECTED: ['VERIFIED', 'REJECTED_FALSE_POSITIVE'],
  VERIFIED: ['ELIGIBLE_FOR_AUTOFIX', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE'],
  ELIGIBLE_FOR_AUTOFIX: ['FIX_MISSION_CREATED', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE'],
  NEEDS_OWNER: ['FIX_MISSION_CREATED', 'RESOLVED', 'REJECTED_FALSE_POSITIVE'],
  FIX_MISSION_CREATED: ['FIX_IN_PROGRESS', 'NEEDS_OWNER'],
  FIX_IN_PROGRESS: ['READY_FOR_ADOPTION', 'NEEDS_OWNER'],
  READY_FOR_ADOPTION: ['RESOLVED', 'NEEDS_OWNER'],
  RESOLVED: ['REOPENED'],
  REOPENED: ['VERIFIED', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE'],
  REJECTED_FALSE_POSITIVE: []
})

export function assertFindingTransition(fromStatus, toStatus) {
  if (!STATUS_ALLOWED[fromStatus]?.includes(toStatus)) {
    const error = new Error(`invalid finding transition: ${fromStatus} -> ${toStatus}`)
    error.code = 'TSF_INVALID_FINDING_TRANSITION'
    throw error
  }
}

function fail(message) {
  throw new Error(`self-improvement finding: ${message}`)
}

// Fail-closed normalization -- a malformed detection is a thrown error,
// never a silently-patched guess (matches normalizeFinding's convention in
// ui-dogfood-finding.mjs and normalizeEvalPack's in evaluation-pack.mjs).
function assertRaw(raw) {
  if (!raw || typeof raw !== 'object') { fail('must be an object') }
  if (!SOURCE_DETECTORS.includes(raw.sourceDetector)) { fail(`unknown sourceDetector ${raw.sourceDetector}`) }
  if (!SEVERITY_LEVELS.includes(raw.severity)) { fail(`unknown severity ${raw.severity}`) }
  if (typeof raw.affectedSurface !== 'string' || !raw.affectedSurface.trim()) { fail('affectedSurface is required') }
  if (raw.evidence === undefined || raw.evidence === null) { fail('evidence is required') }
  if (raw.reproduction === undefined || raw.reproduction === null) { fail('reproduction is required') }
  if (typeof raw.confidence !== 'number' || !(raw.confidence >= 0 && raw.confidence <= 1)) {
    fail('confidence must be a number in [0,1]')
  }
  if (typeof raw.verificationMethod !== 'string' || !raw.verificationMethod.trim()) {
    fail('verificationMethod is required')
  }
  if (raw.projectId !== undefined && raw.projectId !== null && typeof raw.projectId !== 'string') {
    fail('projectId must be a string or null')
  }
}

// Content-addressed identity: the SAME detector reporting the SAME symptom
// at the SAME surface always resolves to the SAME findingId, so a re-scan
// naturally dedupes into "touch the existing record" instead of manufacturing
// a fresh one -- mirrors ui-dogfood-finding.mjs's dedupeKey intent (one real
// defect, not N near-duplicate detections) and verifyResearchClaim's own
// sha256-of-content id pattern (research-verification.mjs), generalized
// across detector kinds. reproduction is included (not just affectedSurface)
// so two genuinely distinct bugs at the same surface never collide.
export function findingIdFor({ sourceDetector, affectedSurface, reproduction }) {
  const fingerprint = sha256({ sourceDetector, affectedSurface, reproduction })
  return `finding:${fingerprint.slice(0, 24)}`
}

// candidateFixScope is nullable at detection time (a detector may not yet
// know what a bounded fix would look like) but, when present, must name a
// `kind` -- self-improvement-autofix-eligibility.mjs's classifier fails
// closed on a missing/unrecognized kind rather than guessing eligibility.
function normalizeCandidateFixScope(raw) {
  if (raw == null) { return null }
  if (typeof raw !== 'object' || typeof raw.kind !== 'string' || !raw.kind.trim()) {
    fail('candidateFixScope, when present, requires a string kind')
  }
  return {
    kind: raw.kind,
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    filesHint: Array.isArray(raw.filesHint) ? [...raw.filesHint] : []
  }
}

// Creates a brand-new DETECTED finding. `raw.findingId` is never accepted --
// identity is always derived via findingIdFor so two independent detectors
// can never accidentally collide on a caller-chosen id, and the SAME real
// defect reported twice always resolves to the SAME record (see
// findingIdFor above).
export function createFinding(raw, clock) {
  assertRaw(raw)
  const at = isoNow(clock)
  const findingId = findingIdFor(raw)
  return {
    schemaVersion: FINDING_SCHEMA_VERSION,
    findingId,
    // Honest-null discipline (research-mission.mjs's projectId is required
    // and throws when absent; a self-improvement finding is legitimately
    // sometimes platform-wide -- e.g. a resource-governor diagnostic with no
    // single owning project -- so null is a real, first-class value here,
    // never a placeholder for "not looked up yet").
    projectId: raw.projectId ?? null,
    sourceDetector: raw.sourceDetector,
    severity: raw.severity,
    evidence: deepClone(raw.evidence),
    reproduction: deepClone(raw.reproduction),
    affectedSurface: raw.affectedSurface,
    confidence: raw.confidence,
    firstSeen: at,
    lastSeen: at,
    occurrences: 1,
    candidateFixScope: normalizeCandidateFixScope(raw.candidateFixScope),
    verificationMethod: raw.verificationMethod,
    // Set only by self-improvement-autofix-eligibility.mjs's
    // applyAutofixEligibility, once the finding reaches VERIFIED -- null
    // until then, never fabricated ahead of a real classification.
    authorityRequired: null,
    status: 'DETECTED',
    revision: 0,
    transitions: [{ from: null, to: 'DETECTED', reason: 'FINDING_DETECTED', at }],
    createdAt: at,
    updatedAt: at
  }
}

// Applies a legal status transition, appending an audit entry -- mirrors
// transitionResearchMission's shape (from/to/reason/evidence/at) exactly.
export function transitionFinding(finding, to, { reason, evidence = [] } = {}, clock) {
  if (!FINDING_STATUSES.includes(to)) { fail(`unknown status ${to}`) }
  assertFindingTransition(finding.status, to)
  const next = deepClone(finding)
  const at = isoNow(clock)
  next.transitions.push({ from: finding.status, to, reason: reason ?? 'UNSPECIFIED', evidence, at })
  next.status = to
  next.revision += 1
  next.updatedAt = at
  return next
}

// Re-detection of an already-known finding (same findingId, i.e. same
// fingerprint). A finding still open (anything short of RESOLVED/
// REJECTED_FALSE_POSITIVE) just gets lastSeen/occurrences bumped -- no
// status change, since it was already being tracked. RESOLVED recurring is a
// real regression and transitions to REOPENED. REJECTED_FALSE_POSITIVE is
// deliberately NEVER auto-reopened by a detector observing the same symptom
// again (that would let a noisy detector silently overturn a human's
// false-positive call) -- occurrences still increments so the recurrence is
// visible, but a human/owner action is required to create a fresh finding if
// they disagree, exactly like REJECTED_FALSE_POSITIVE's empty transition
// list already enforces.
export function recordFindingRecurrence(finding, clock) {
  const at = isoNow(clock)
  const bumped = { ...deepClone(finding), lastSeen: at, occurrences: finding.occurrences + 1, updatedAt: at }
  if (finding.status !== 'RESOLVED') { return bumped }
  return transitionFinding(bumped, 'REOPENED', { reason: 'RECURRED_AFTER_RESOLUTION' }, clock)
}

// The one entry point a detector should call: creates on first sighting,
// or applies recordFindingRecurrence's dedup/reopen logic on every
// subsequent one. `current` is whatever the store currently holds for
// findingIdFor(raw) (or null) -- kept pure/synchronous so the durable store
// (self-improvement-finding-store.mjs) can use it directly as a CAS
// mutator with no I/O inside this function.
export function applyDetection(current, raw, clock) {
  if (!current) { return createFinding(raw, clock) }
  assertRaw(raw)
  return recordFindingRecurrence(current, clock)
}
