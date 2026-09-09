// Long-Form Mission Spec (TSF Software Mission Routing / Project Planner
// Hotfix V1, Phase 5): a long directive is treated as ONE durable parent
// artifact, not reduced to a short extracted clause anywhere downstream.
// This extends the existing Keep Going run schema (createOvernightRun's new
// optional `missionSpec` field, domain/keep-going.mjs) rather than inventing
// a second mission store -- a run's missionSpec IS this shape, persisted the
// moment a chat/Command dispatch creates the run, and therefore already
// covered by every existing durable-state save/load path (including Planner
// Context Lifecycle rollover, which reads the run unchanged).
import { createHash } from 'node:crypto'

export const MISSION_SPECIFICATION_SCHEMA_VERSION = 'TSF_MISSION_SPECIFICATION_V1'

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// Bounded, best-effort extraction of a few explicitly-named contract
// clauses out of the raw directive text, purely for human-scannable
// summary fields on the durable record -- the record's real authority is
// `rawDirective` itself (always the complete, unmodified text), never
// these derived lists. A directive with none of these phrasings still
// gets a real, complete missionSpec; these arrays are simply empty.
const FORBIDDEN_ACTION_PATTERNS = [
  /\bdo not\b[^.\n]{0,80}/gi,
  /\bnever\b[^.\n]{0,80}/gi
]

function extractForbiddenActions(rawDirective) {
  const found = new Set()
  for (const pattern of FORBIDDEN_ACTION_PATTERNS) {
    for (const match of rawDirective.matchAll(pattern)) {
      const clause = match[0].trim().replace(/\s+/g, ' ')
      if (clause.length > 3) found.add(clause.slice(0, 160))
    }
  }
  return [...found].slice(0, 50)
}

const AUTHORIZATION_PATTERNS = [/\bexplicit(?:ly)? authoriz(?:e|ation)[^.\n]{0,120}/gi, /\bi authorize\b[^.\n]{0,120}/gi]

function extractOwnerAuthorizations(rawDirective) {
  const found = new Set()
  for (const pattern of AUTHORIZATION_PATTERNS) {
    for (const match of rawDirective.matchAll(pattern)) {
      found.add(match[0].trim().replace(/\s+/g, ' ').slice(0, 200))
    }
  }
  return [...found].slice(0, 20)
}

// Builds the durable long-form mission specification for a real chat/
// Command dispatch. `rawDirective` is ALWAYS the complete, untruncated
// message text (the caller must not have already sliced it for routing --
// see chat-http-routes.mjs's own message-length fix, Phase 4/5). Never
// throws on unusual input; a missing/empty directive still returns a real,
// well-formed record (empty derived fields) rather than null, so a run
// always has a spec once one is requested.
export function buildMissionSpecification({
  rawDirective,
  projectId,
  parentMissionType,
  acceptanceCriteria = [],
  resourcePolicy = null,
  continuationPolicy = null,
  artifactReferences = [],
  createdAt
}) {
  const text = typeof rawDirective === 'string' ? rawDirective : ''
  return {
    schemaVersion: MISSION_SPECIFICATION_SCHEMA_VERSION,
    missionSpecId: `mission-spec-${sha256(text || String(createdAt)).slice(0, 16)}`,
    projectId: projectId ?? null,
    parentMissionType: parentMissionType ?? null,
    rawDirective: text,
    directiveHash: sha256(text),
    directiveLength: text.length,
    ownerAuthorizations: extractOwnerAuthorizations(text),
    forbiddenActions: extractForbiddenActions(text),
    resourcePolicy,
    continuationPolicy,
    acceptanceCriteria: [...acceptanceCriteria],
    artifactReferences: artifactReferences.map((a) => ({
      name: a?.name ?? 'attachment',
      type: a?.type ?? null,
      sha256: typeof a?.extractedText === 'string' ? sha256(a.extractedText) : null
    })),
    createdAt: createdAt ?? new Date().toISOString()
  }
}

// Integrity check used by tests/verification: the durable record's own
// hash must still match its own rawDirective -- catches any future call
// site that accidentally passes a truncated/mutated directive in.
export function verifyMissionSpecificationIntegrity(missionSpec) {
  if (!missionSpec) return false
  return sha256(missionSpec.rawDirective) === missionSpec.directiveHash
}
