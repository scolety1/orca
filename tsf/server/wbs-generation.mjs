// M8 wave 3: turns real project evidence (or an idea/client-brief with no
// repo yet) into a structured Work Breakdown Structure the planner
// proposes, TSF validates, and the real deterministic estimation engine
// (tsf/domain/estimation.mjs) computes everything numeric from. Mirrors
// tsf/server/onboarding.mjs's own DIRECTION_SCHEMA/invokeLiveStructuredAnalysis
// pattern exactly -- the real, already-proven live-planner integration
// this program already has, not a second one.
//
// Per Tim's own explicit rule: "The planner must not directly invent the
// final numeric estimate." The schema below only asks the planner for
// judgment calls (decomposition, three-point ranges, clarity, confidence,
// assumptions) -- normalizeWbs (tsf/domain/estimation.mjs) re-validates
// every field structurally AND semantically (min<=expected<=max, only
// real routing.mjs roles, no dangling dependencies) as real defense in
// depth beyond the JSON schema's own structural constraint, and
// runMonteCarloEstimate does 100% of the actual arithmetic.
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'
import { normalizeWbs } from '../domain/estimation.mjs'

const THREE_POINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'expected', 'max'],
  properties: {
    min: { type: 'number', minimum: 0 },
    expected: { type: 'number', minimum: 0 },
    max: { type: 'number', minimum: 0 }
  }
}

// Mirrors estimation.mjs's own VALID_ROLES/VALID_RISKS exactly -- schema-
// level and domain-level validation must never disagree.
const WBS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'tasks'],
  properties: {
    schemaVersion: { const: 'TSF_WBS_GENERATION_REQUEST_V1' },
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'activeEffortHours', 'clarity', 'confidence'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          stage: { type: 'string' },
          category: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
          activeEffortHours: THREE_POINT_SCHEMA,
          humanReviewHours: THREE_POINT_SCHEMA,
          externalWaitHours: THREE_POINT_SCHEMA,
          clarity: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          risk: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH'] },
          providerRoleHint: {
            type: 'string',
            enum: [
              'PLANNER_DEEP',
              'PLANNER_BALANCED',
              'WORKER_CHEAP',
              'WORKER_BALANCED',
              'WORKER_DEEP',
              'VERIFIER_INDEPENDENT'
            ]
          },
          assumptions: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
}

const WBS_SYSTEM_PROMPT = [
  'You are the TSF Planner decomposing a project into a Work Breakdown Structure, in the PLANNER_DEEP role.',
  'You have no tools and cannot inspect anything yourself -- everything you need is in the facts below. Do not claim to have read files beyond the excerpts given.',
  'Your job is decomposition and uncertainty judgment ONLY -- you propose tasks, three-point effort ranges (min/expected/max hours), clarity (how well understood the task is), and confidence (how much you trust your own numbers). You do NOT compute percentiles, totals, deadlines, or costs -- a separate deterministic engine does all of that from your ranges. Never state a final estimate yourself.',
  'Ground every task in the given evidence. Cite assumptions and evidence explicitly. If something is unknown, say so in assumptions rather than guessing a number that looks precise.',
  'providerRoleHint must be one of the given enum values only -- never invent a new role name.',
  'Answer strictly as JSON matching the given schema.'
].join('\n')

function buildEvidencePrompt({ repoEvidence, ideaBrief }) {
  if (repoEvidence) {
    return [
      'Decompose the following REAL, onboarded project into a Work Breakdown Structure for remaining work (not the whole codebase from scratch):',
      JSON.stringify(repoEvidence, null, 2)
    ].join('\n\n')
  }
  return [
    'No repository exists yet for this project -- this is an IDEA/CLIENT BRIEF ONLY. Decompose it into a preliminary Work Breakdown Structure. Since there is no real repository evidence, widen your clarity/confidence downward accordingly (do not pretend to know more than a brief-only description supports), and note in assumptions what discovery (e.g. onboarding a real repo) would reduce uncertainty.',
    ideaBrief
  ].join('\n\n')
}

// Generates a WBS from either real onboarding evidence (repoEvidence) or
// an idea/client brief (ideaBrief, no repo yet) -- exactly one must be
// given. Returns {ok:true, wbs, preliminary} on success (wbs already
// passed through normalizeWbs's real validation) or {ok:false, reason,
// detail} honestly on any failure -- a schema-violating or domain-invalid
// LLM response is a real, disclosed failure, never silently patched or
// guessed into shape.
export async function generateWbs({ projectId, repoEvidence = null, ideaBrief = null }) {
  if (!!repoEvidence === !!ideaBrief) {
    throw new Error('generateWbs requires exactly one of repoEvidence or ideaBrief')
  }
  const preliminary = !repoEvidence

  const result = await invokeLiveStructuredAnalysis({
    systemPrompt: WBS_SYSTEM_PROMPT,
    prompt: buildEvidencePrompt({ repoEvidence, ideaBrief }),
    jsonSchema: WBS_SCHEMA,
    // Matches onboarding.mjs's own DIRECTION_SCHEMA timeout rationale --
    // schema-constrained multi-task decomposition genuinely takes longer
    // than a conversational chat turn.
    timeoutOverrideMs: 180000
  })

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? 'PLANNER_UNAVAILABLE',
      detail: result.detail ?? null
    }
  }

  let wbs
  try {
    wbs = normalizeWbs(result.data?.tasks)
  } catch (error) {
    return { ok: false, reason: 'INVALID_WBS', detail: error.message }
  }

  return {
    ok: true,
    schemaVersion: 'TSF_PROJECT_ESTIMATE_V1',
    projectId,
    preliminary,
    wbs,
    generatedAt: new Date().toISOString()
  }
}
