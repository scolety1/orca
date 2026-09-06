// Command architecture fix (hands-on pilot round 2, Finding 2): "research
// the history of the NFL salary cap from 2018 through 2020 and give me a
// sourced dataset. don't spend any money" already carries enough real
// scope (an implied expected universe of 3 seasons, an implied field --
// the cap value -- a NO_NEW_SPEND policy) for a real ResearchSpecification
// to be synthesized. Creating an empty scaffold and asking Tim to restate
// what he already said is the bug this file fixes.
//
// Generic by construction, not NFL-specific: this module (and the schema/
// prompt below) never mentions salary caps, sports, or any other domain --
// PLANNER_DEEP fills in the actual content for WHATEVER topic is asked
// about, exactly like WBS generation (server/wbs-generation.mjs) never
// hard-codes what kind of project it's decomposing. Same live-planner
// bridge (REUSE_DIRECTLY), same "the planner proposes, TSF structurally
// validates" discipline: every field synthesized here is re-validated
// against the REAL TSF_RESEARCH_SPECIFICATION_V1/TSF_EXPECTED_UNIVERSE_V1
// shapes before a mission is ever created from it -- a schema-conformant
// but structurally-invalid synthesis (e.g. zero expected entities) is
// still refused, not trusted blindly.
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'

const FIELD_VALUE_TYPES = Object.freeze(['string', 'number', 'boolean', 'date'])

const SPEC_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'sufficientlySpecified'],
  properties: {
    schemaVersion: { const: 'TSF_RESEARCH_SPEC_SYNTHESIS_V1' },
    sufficientlySpecified: { type: 'boolean' },
    clarificationNeeded: { type: ['string', 'null'] },
    researchQuestion: { type: ['string', 'null'] },
    entityType: { type: ['string', 'null'] },
    expectedEntities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entityId', 'label'],
        properties: { entityId: { type: 'string' }, label: { type: 'string' } }
      }
    },
    expectedUniverseSource: { type: ['string', 'null'] },
    requestedFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldName', 'valueType', 'required'],
        properties: {
          fieldName: { type: 'string' },
          valueType: { type: 'string', enum: FIELD_VALUE_TYPES },
          required: { type: 'boolean' }
        }
      }
    },
    temporalPeriodScope: { type: ['string', 'null'] },
    preferredSourceUrls: {
      description: 'Real, specific candidate public page URLs likely to contain a genuine data table for the requested fields -- never a search-engine URL, never fabricated as certain. A wrong/dead URL just fails cleanly at fetch time; this is a starting hint, not an oracle.',
      type: 'array',
      items: { type: 'string' }
    },
    sourceStrategy: { type: ['string', 'null'] },
    verificationRequirement: { type: ['string', 'null'] },
    completenessRequirement: { type: ['string', 'null'] }
  }
}

const SPEC_SYNTHESIS_SYSTEM_PROMPT = [
  'You are TSF Dataset Research\'s PLANNER_DEEP role, synthesizing a ResearchSpecification proposal from ONE chat request. You do not execute any research yourself -- you only propose structure. Nothing you say here spends money or dispatches a real request.',
  '',
  'Judge whether the request is sufficiently specified to propose a real, bounded specification. It is sufficient when you can identify: what is being researched (the entity type and, ideally, an enumerable expected universe of specific items -- e.g. explicit years/names/categories the request itself names or clearly implies), and at least one concrete field to collect per item.',
  '',
  'If sufficient: propose entityType, expectedEntities (one per item in the expected universe -- prefer a SMALL, explicit, enumerable set genuinely implied by the request over a vague open-ended one; if the request gives a bounded range like specific years, enumerate each one as its own entity), expectedUniverseSource (a short honest note on how you derived the universe -- e.g. "inferred from the request\'s own explicit year range", never claim a real external oracle you don\'t have), requestedFields, preferredSourceUrls (0-3 real, specific public page URLs you genuinely believe are likely to contain a table with this data -- e.g. a specific Wikipedia article, an official league/government page; never a search-engine URL, never a URL you are only guessing exists -- leave empty rather than invent one), temporalPeriodScope, sourceStrategy (prefer official/deterministic/public sources before speculative AI research when you can name one), verificationRequirement, and completenessRequirement.',
  '',
  'requestedFields: only the identity field(s) needed to distinguish entities (e.g. a year/name already implied by expectedEntities need not be repeated) and the actual substantive value(s) the user is asking for -- name each to plausibly match a real page\'s own column header text, e.g. "Cap Number" rather than an internal identifier like "capNum". Never propose "Source Name", "Source URL", "Date Retrieved", "Date Verified", or similar provenance/citation fields -- TSF already attaches source references and evidence to every claim outside this schema; adding them here would falsely demand the user re-answer something the system already tracks. Set required:true only on the field(s) the user actually asked for or need to identify the entity; set required:false on any extra derived/enrichment field you add beyond what was asked (an unresolved optional field must never block completion).',
  '',
  'If NOT sufficient: set sufficientlySpecified to false and clarificationNeeded to ONE short, specific, bounded question that would unblock it -- never a vague "can you clarify?".',
  '',
  'Never invent fake specific facts (real dollar figures, real historical values, etc.) -- you are proposing STRUCTURE (what to look for and where), not answering the research question itself.'
].join('\n')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// Structural re-validation, independent of the JSON schema the CLI already
// enforced -- the same "planner proposes, TSF validates" defense-in-depth
// normalizeWbs (domain/estimation.mjs) established for WBS generation.
// Returns null (refused) rather than a partially-usable shape on any
// structural problem.
export function validateSynthesis(data) {
  if (!Array.isArray(data.expectedEntities) || data.expectedEntities.length === 0) return null
  if (data.expectedEntities.some((e) => !isNonEmptyString(e.entityId) || !isNonEmptyString(e.label))) return null
  if (!Array.isArray(data.requestedFields) || data.requestedFields.length === 0) return null
  if (data.requestedFields.some((f) => !isNonEmptyString(f.fieldName) || !FIELD_VALUE_TYPES.includes(f.valueType))) {
    return null
  }
  // Duplicate entity ids would silently collapse into fewer real nodes than
  // the proposed universe claims -- refused rather than silently shrinking
  // the universe.
  if (new Set(data.expectedEntities.map((e) => e.entityId)).size !== data.expectedEntities.length) return null
  return data
}

export async function synthesizeResearchSpecification({ message, missionId, freeOnly, clock = () => new Date() }) {
  const live = await invokeLiveStructuredAnalysis({
    systemPrompt: SPEC_SYNTHESIS_SYSTEM_PROMPT,
    prompt: message,
    jsonSchema: SPEC_SYNTHESIS_SCHEMA,
    // Real specification synthesis is closer to onboarding's direction
    // analysis in depth than a routing decision -- given real headroom,
    // never the fast routing-call budget classifyGlobalScope uses.
    timeoutOverrideMs: 90000
  })
  if (!live.ok) {
    return { ok: false, reason: 'PLANNER_UNAVAILABLE', detail: live.reason }
  }
  const data = live.data
  if (!data?.sufficientlySpecified) {
    return {
      ok: false,
      reason: 'NEEDS_INPUT',
      clarification: isNonEmptyString(data?.clarificationNeeded)
        ? data.clarificationNeeded
        : 'Can you say more about what specifically to research and what fields matter?'
    }
  }
  const validated = validateSynthesis(data)
  if (!validated) {
    return { ok: false, reason: 'NEEDS_INPUT', clarification: 'I couldn\'t turn that into a concrete, bounded set of items and fields to research -- can you name specific items (years, names, categories) and what to collect about each?' }
  }

  const requestedFields = validated.requestedFields.map((f) => ({
    fieldName: f.fieldName,
    valueType: f.valueType,
    required: !!f.required,
    derivationRule: null
  }))
  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `${missionId}-spec`,
    researchQuestion: isNonEmptyString(validated.researchQuestion) ? validated.researchQuestion : `Chat request: "${message}"`,
    entityType: isNonEmptyString(validated.entityType) ? validated.entityType : 'UNSPECIFIED',
    requestedFields,
    sourcePolicy: {
      preferredSources: Array.isArray(validated.preferredSourceUrls)
        ? validated.preferredSourceUrls.filter((url) => typeof url === 'string' && /^https?:\/\//.test(url))
        : [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    // Real, independently-found bug (hands-on pilot round 3, Bug 1
    // investigation): both fields are REQUIRED non-empty strings in
    // TSF_RESEARCH_SPECIFICATION_V1/BoundedResearchRequest (contracts/
    // research-specification.schema.v1.json,
    // bounded-research-worker-protocol.schema.v1.json) -- this always set
    // asOfDate to null, meaning EVERY Command-synthesized mission's
    // specification was structurally invalid the moment any real dispatch
    // was attempted (buildBoundedResearchRequest throws). Never caught
    // before because no existing test exercised a real dispatch against a
    // Command-created mission -- only free-path library reuse, which
    // never calls buildBoundedResearchRequest at all. asOfDate defaults
    // honestly to the date the request was actually made (this is never a
    // claim about when the DATA is from, only when TSF asked); periodScope
    // defaults to an honest 'UNSPECIFIED' rather than null when the
    // planner's own proposal didn't include one.
    temporalRequirements: {
      asOfDate: clock().toISOString().slice(0, 10),
      // Adversarial-review finding: the planner's JSON schema allows
      // temporalPeriodScope to be an empty string (no minLength), which
      // `?? 'UNSPECIFIED'` does not catch (only null/undefined) -- an
      // empty string still fails the contract's own non-empty-string
      // requirement at real dispatch time. Trimmed truthiness catches that too.
      periodScope: validated.temporalPeriodScope?.trim() ? validated.temporalPeriodScope.trim() : 'UNSPECIFIED'
    },
    budget: { maxCostUsd: freeOnly ? 0 : null, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  const expectedUniverse = {
    schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
    entityType: specification.entityType,
    expectedCount: validated.expectedEntities.length,
    expectedEntities: validated.expectedEntities.map((e) => ({ entityId: e.entityId, identityHints: { label: e.label } })),
    source: isNonEmptyString(validated.expectedUniverseSource)
      ? validated.expectedUniverseSource
      : 'PLANNER_DEEP-inferred from the request itself -- not a real external oracle'
  }
  // Real, independently-found bug (REAL FREE-PATH RESEARCH EXECUTION V1
  // investigation): requestedOutputSchema had no `properties` at all, so
  // fieldNames(request) (Exa/Parallel/the web-table worker all read
  // Object.keys(requestedOutputSchema.properties)) always returned []
  // for a Command-synthesized mission -- ANY real worker dispatch would
  // have requested zero fields. Never caught before because no existing
  // test exercised a real dispatch's field list against a Command-
  // synthesized node, only against hand-built fixtures that already
  // included `properties` explicitly.
  const requestedOutputSchema = {
    type: 'object',
    properties: Object.fromEntries(requestedFields.map((f) => [f.fieldName, { type: f.valueType === 'date' ? 'string' : f.valueType }]))
  }
  const nodes = validated.expectedEntities.map((e) => ({
    id: `node:${e.entityId}`,
    nodeRole: 'PRIMARY_RESEARCH',
    targetEntity: { entityId: e.entityId, name: e.label },
    requestedFields,
    requestedOutputSchema
  }))

  return {
    ok: true,
    specification,
    expectedUniverse,
    nodes,
    sourceStrategy: validated.sourceStrategy ?? null,
    verificationRequirement: validated.verificationRequirement ?? null,
    completenessRequirement: validated.completenessRequirement ?? null
  }
}
