// Native Self-Improvement Loop V1, Phase 3: the structured authority
// envelope every originated repair mission carries. Pure, deterministic --
// built entirely from a VERIFIED-eligible finding's own fields, never
// free-form. Mirrors cleanup-lifecycle.mjs's own "each stage is a plain,
// inspectable object" discipline (REUSE_PATTERN, not REUSE_CODE: cleanup's
// stages are destructive-action-specific, this is a bounded-code-fix
// envelope) rather than free prose a worker must interpret.
import { deepClone } from './canonical.mjs'

// Mechanically checkable against a real `git diff --name-only` (server
// layer) -- every entry is a path prefix relative to the canonical repo
// root that a repair worker's own diff must never contain. Covers exactly
// the files the mission brief names as forbidden AND are addressable
// within this one repo's tree: Cleanup V1's real destructive-authority
// gate, and this wave's own adoption-authorization gate (a repair worker
// must never be able to open its own adoption gate).
export const FORBIDDEN_PATH_PREFIXES = Object.freeze([
  'tsf/server/cleanup-owner-authorization-gate.mjs',
  'tsf/server/cleanup-protected-registry-defaults.mjs',
  'tsf/domain/cleanup-protected-registry.mjs',
  'tsf/server/self-improvement-adoption-authorization-gate.mjs'
])

// Forbidden by construction, not by diffing a file list -- each of these
// is either a different repository entirely (NWR, a separate project) or a
// different git worktree (dataset-research-engine-v0) that a repair
// worker's own isolated worktree has no path reference to, or the
// canonical repo root itself, which createIsolatedRepairWorktree
// (self-improvement-worktree.mjs) never returns as a dispatch target --
// see dispatchRepairWorker's own `worktreePath !== canonicalRepoPath`
// assertion. Documented here so the envelope is a complete, honest
// description of authority even where enforcement is structural rather
// than a diffable check.
export const STRUCTURALLY_FORBIDDEN_SURFACES = Object.freeze([
  { surface: 'NWR (niners-war-room) project data', mechanism: 'a different repository entirely -- never reachable from this worktree' },
  { surface: 'dataset-research-engine-v0 worktree', mechanism: 'a different linked worktree -- the worker is never given its path' },
  { surface: 'canonical tsf/main as a direct write target', mechanism: 'the worker only ever runs inside its own freshly-created isolated worktree, never the canonical repo root' }
])

function fail(message) {
  throw new Error(`self-improvement authority envelope: ${message}`)
}

// Every status a finding can be in once a repair mission legitimately
// exists for it -- ELIGIBLE_FOR_AUTOFIX (origination time) through the
// whole mission lifecycle. buildAuthorityEnvelope is called again on every
// later repair-cycle tick (server/self-improvement-repair-cycle.mjs), by
// which point origination has already moved the finding on to
// FIX_MISSION_CREATED/FIX_IN_PROGRESS -- the envelope is a pure
// reconstruction from the finding's own stable fields (evidence,
// reproduction, candidateFixScope), not a one-time snapshot, so it must
// stay reconstructible for as long as a mission can legitimately act on
// this finding.
const MISSION_TRACK_STATUSES = Object.freeze(['ELIGIBLE_FOR_AUTOFIX', 'FIX_MISSION_CREATED', 'FIX_IN_PROGRESS', 'READY_FOR_ADOPTION', 'NEEDS_OWNER'])

// allowedScope is derived from candidateFixScope.filesHint -- never
// invented. An empty/absent filesHint means the finding gave no scope
// hint at all, so the envelope says so honestly (empty array) rather than
// guessing a directory; buildWorkerPrompt (self-improvement-worker-
// prompt.mjs) turns an empty allowedScope into an explicit "stay minimal
// and name what you touched" instruction, per the mission brief.
export function buildAuthorityEnvelope(finding, missionId) {
  if (!finding || !MISSION_TRACK_STATUSES.includes(finding.status)) {
    fail(`an authority envelope can only be built for a finding on the repair-mission track (got status: ${finding?.status})`)
  }
  if (!missionId) { fail('missionId is required') }
  return {
    schemaVersion: 'TSF_SELF_IMPROVEMENT_AUTHORITY_ENVELOPE_V1',
    missionId,
    findingId: finding.findingId,
    evidence: deepClone(finding.evidence),
    reproduction: deepClone(finding.reproduction),
    affectedSurface: finding.affectedSurface,
    allowedScope: deepClone(finding.candidateFixScope?.filesHint ?? []),
    forbiddenPathPrefixes: [...FORBIDDEN_PATH_PREFIXES],
    structurallyForbiddenSurfaces: STRUCTURALLY_FORBIDDEN_SURFACES.map((s) => ({ ...s })),
    acceptanceTest: { reproduction: deepClone(finding.reproduction), verificationMethod: finding.verificationMethod },
    verifierRequirements: {
      role: 'VERIFIER_INDEPENDENT',
      mustDifferFromWorkerWhenAvailable: true,
      checks: ['REPRODUCTION_PASSES', 'REGRESSION_TESTS_PASS', 'FORBIDDEN_SURFACE_CLEAN', 'SCOPE_RESPECTED', 'NO_DUPLICATE_ARCHITECTURE_HEURISTIC']
    },
    projectAttribution: finding.projectId,
    resourceClass: 'HEAVYWEIGHT_WORKER_DISPATCH',
    adoptionPolicy: 'REQUIRES_OWNER_AUTHORIZATION_GATE_OPEN',
    rollbackExpectations: 'the isolated worktree IS the rollback boundary -- nothing is real until adoption merges it into canonical tsf/main'
  }
}

// Defense-in-depth, checked before dispatch (not just after, at verify
// time): a filesHint that already names a forbidden path is a
// mis-classified finding, not a legitimate bounded scope -- refuse to even
// build the envelope's downstream prompt rather than dispatch a worker
// whose OWN stated scope already violates the authority it's granted.
export function assertScopeDoesNotOverlapForbidden(envelope) {
  const hits = envelope.allowedScope.filter((hint) =>
    envelope.forbiddenPathPrefixes.some((forbidden) => hint.startsWith(forbidden) || forbidden.startsWith(hint))
  )
  if (hits.length > 0) {
    const error = new Error(`candidateFixScope.filesHint overlaps a forbidden surface: ${hits.join(', ')}`)
    error.code = 'TSF_SELF_IMPROVEMENT_SCOPE_OVERLAPS_FORBIDDEN'
    throw error
  }
}
