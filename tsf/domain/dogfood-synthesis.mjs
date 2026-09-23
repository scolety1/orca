// TSF Owner Dogfood/Critique Loop V1, Chunk 2: turns a full dogfood
// session transcript into structured, classified observations. The
// planner proposes, TSF structurally validates -- same discipline as
// command-research-spec-synthesis.mjs and wbs-generation.mjs (REUSE
// PATTERN), never trusted blindly.
export const DOGFOOD_SYNTHESIS_SCHEMA_VERSION = 'TSF_DOGFOOD_SYNTHESIS_V1'

// The owner's own specified 10-category taxonomy (TSF OWNER DOGFOOD /
// CRITIQUE LOOP V1). Distinct from TSF_UI_FINDING_LEDGER.md's 6-category
// taxonomy (that one is for owner-screenshot-triggered UI review; this one
// is for synthesizing a whole spoken/typed rant, which also needs to
// represent ideas, questions, and retracted/ambiguous material that never
// existed as a category in the UI ledger).
export const DOGFOOD_FINDING_CATEGORIES = Object.freeze([
  'BUG',
  'UX_PROBLEM',
  'INFORMATION_ARCHITECTURE_PROBLEM',
  'VISUAL_POLISH_ISSUE',
  'PERSONAL_PREFERENCE',
  'IDEA_EXPLORATION',
  'GOOD_AS_IS_PROTECT',
  'QUESTION',
  'RETRACTED_SUPERSEDED',
  'AMBIGUOUS'
])

export const DOGFOOD_DISPOSITIONS = Object.freeze([
  'SAFE_TO_IMPLEMENT',
  'NEEDS_OWNER_DECISION',
  'DO_NOT_ACT'
])

// Categories that can NEVER be actioned, regardless of what the planner
// proposes -- a hard structural rule, not just prompt guidance. Retracted/
// superseded material, unresolved ambiguity, open questions, and explicit
// GOOD-AS-IS protections must never become implementation work; this is
// the "uncertain/contradictory material must not become implementation
// work" invariant enforced in code, not just asked for in the prompt.
const NEVER_ACTIONABLE_CATEGORIES = Object.freeze([
  'GOOD_AS_IS_PROTECT',
  'QUESTION',
  'RETRACTED_SUPERSEDED',
  'AMBIGUOUS',
  'PERSONAL_PREFERENCE',
  'IDEA_EXPLORATION'
])

export const DOGFOOD_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'observations'],
  properties: {
    schemaVersion: { const: DOGFOOD_SYNTHESIS_SCHEMA_VERSION },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'settledDescription', 'disposition', 'evidenceTurnIndexes'],
        properties: {
          category: { type: 'string', enum: [...DOGFOOD_FINDING_CATEGORIES] },
          settledDescription: {
            type: 'string',
            description:
              'The FINAL settled version of this observation, after resolving any retraction/correction within the transcript -- never the original pre-retraction wording.'
          },
          disposition: { type: 'string', enum: [...DOGFOOD_DISPOSITIONS] },
          evidenceTurnIndexes: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Zero-based indexes into the OWNER turns array that this observation is derived from, in order.'
          },
          severity: { type: ['string', 'null'], enum: ['P0', 'P1', 'P2', 'P3', null] },
          route: { type: ['string', 'null'] }
        }
      }
    }
  }
}

export const DOGFOOD_SYNTHESIS_SYSTEM_PROMPT = [
  "You are TSF's Owner Dogfood/Critique Loop, synthesizing a durable transcript of the owner rating/critiquing the product into structured observations. You do not execute or change anything yourself -- you only classify and summarize what was said.",
  '',
  `Classify each real, distinct observation into exactly one category: ${DOGFOOD_FINDING_CATEGORIES.join(', ')}.`,
  '',
  'CRITICAL: later settled owner intent always wins. If the owner says something and then corrects, retracts, or contradicts it later in the SAME transcript, the settledDescription must reflect the FINAL intent only -- never the original. A statement that is fully retracted with nothing left to act on ("delete it -- actually no, don\'t") becomes its own RETRACTED_SUPERSEDED observation (or is simply omitted if it carries no informational value), NOT a BUG/UX_PROBLEM observation demanding the retracted action. A statement that is corrected into a DIFFERENT concrete request ("move X under Y -- actually no, leave X alone") should produce an observation reflecting the FINAL request only (or GOOD_AS_IS_PROTECT if the final intent is to leave something unchanged).',
  '',
  'GOOD_AS_IS_PROTECT: the owner explicitly says something is fine / should not change / should not be touched. This protects it from being "fixed" later -- record it plainly, e.g. "The Needs-You indicator should not change."',
  '',
  'AMBIGUOUS: the owner refers to something ("this", "that button", "this thing") where the transcript alone does not make the referent clear enough to act on safely. Do not guess the referent -- classify as AMBIGUOUS and describe what is unclear.',
  '',
  'QUESTION: a genuine question the owner asked, not an instruction or complaint.',
  '',
  'disposition: SAFE_TO_IMPLEMENT only for a narrow, unambiguous, low-risk, purely-technical BUG fix with an obvious correct behavior. NEEDS_OWNER_DECISION for anything involving subjective judgment, visual/UX/IA taste, or any BUG whose correct fix is not obvious. DO_NOT_ACT for GOOD_AS_IS_PROTECT, QUESTION, RETRACTED_SUPERSEDED, AMBIGUOUS, PERSONAL_PREFERENCE, and IDEA_EXPLORATION -- these categories must always be DO_NOT_ACT regardless of how they sound worded.',
  '',
  'evidenceTurnIndexes: cite the zero-based indexes of the specific OWNER turns (provided to you as a numbered list) that this observation is drawn from, including both the original statement and any later retraction/correction turns that changed its settled meaning.',
  '',
  'Do not invent observations not grounded in the actual transcript. Do not merge two genuinely distinct issues into one observation just because they are related.'
].join('\n')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// Structural re-validation, independent of the JSON schema the CLI already
// enforced (defense in depth, same discipline as validateSynthesis in
// command-research-spec-synthesis.mjs). The disposition/category hard rule
// below is enforced here in CODE, not just requested in the prompt --
// a planner that ignores the prompt's instruction is still caught.
export function validateDogfoodSynthesis(data, transcriptLength) {
  if (!Array.isArray(data?.observations)) {
    return null
  }
  const cleaned = []
  for (const obs of data.observations) {
    if (!DOGFOOD_FINDING_CATEGORIES.includes(obs?.category)) {
      return null
    }
    if (!isNonEmptyString(obs?.settledDescription)) {
      return null
    }
    if (!DOGFOOD_DISPOSITIONS.includes(obs?.disposition)) {
      return null
    }
    if (!Array.isArray(obs?.evidenceTurnIndexes)) {
      return null
    }
    const indexes = obs.evidenceTurnIndexes.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < transcriptLength
    )
    // Fail-closed disposition rule: never trust the planner's own claim
    // that a never-actionable category is safe/needs-decision -- force it
    // to DO_NOT_ACT regardless of what was returned.
    const disposition = NEVER_ACTIONABLE_CATEGORIES.includes(obs.category)
      ? 'DO_NOT_ACT'
      : obs.disposition
    cleaned.push({
      category: obs.category,
      settledDescription: obs.settledDescription.trim(),
      disposition,
      evidenceTurnIndexes: indexes,
      severity: ['P0', 'P1', 'P2', 'P3'].includes(obs.severity) ? obs.severity : 'P2',
      route: isNonEmptyString(obs.route) ? obs.route.trim() : null
    })
  }
  return cleaned
}

// Whether a validated observation is eligible to become a real,
// implementation-tracked self-improvement finding at all -- never for a
// never-actionable category, regardless of disposition.
export function isActionableObservation(observation) {
  return !NEVER_ACTIONABLE_CATEGORIES.includes(observation.category)
}

// Stage 8 (coherent batching): groups actionable observations by shared
// affected surface (route, falling back to "unspecified") so a fix batch
// can be requested per surface instead of one mission per sentence --
// matches the owner's own "group by screen/workflow/root cause" and "do
// not create one mission per sentence" instructions. Pure grouping only;
// dispatching the batch is a separate step.
export function groupObservationsIntoBatches(actionableObservations) {
  const batches = new Map()
  for (const observation of actionableObservations) {
    const key = observation.route ?? 'UNSPECIFIED_SURFACE'
    if (!batches.has(key)) {
      batches.set(key, [])
    }
    batches.get(key).push(observation)
  }
  return [...batches.entries()].map(([surface, observations]) => ({ surface, observations }))
}
