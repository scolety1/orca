#!/usr/bin/env node
// Stands in for a real provider CLI (claude/codex) in tests, driven entirely
// by env vars so tests never spend real API cost or depend on network/auth.
// Emulates the real `claude -p ... --output-format json` contract observed
// from the actual binary, including its actual failure shapes: a rejected
// --resume prints plain text and exits 1 (not JSON).
const args = process.argv.slice(2)
const mode = process.env.STUB_MODE || 'success'
const sessionId = process.env.STUB_SESSION_ID || 'stub-session-aaaa'
const model = process.env.STUB_MODEL || 'stub-model-x'

function argValue(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}

if (process.env.STUB_DEBUG_FILE) {
  const fs = await import('node:fs')
  fs.writeFileSync(
    process.env.STUB_DEBUG_FILE,
    JSON.stringify({ args, cwd: process.cwd() }, null, 2)
  )
}

if (mode === 'timeout') {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  process.exit(0)
}

if (mode === 'malformed') {
  process.stdout.write('this is not json')
  process.exit(0)
}

if (mode === 'provider-error') {
  process.stdout.write(
    JSON.stringify({
      is_error: true,
      result: 'deliberate stub provider error',
      session_id: sessionId
    })
  )
  process.exit(0)
}

// Fails once (a real PROVIDER_ERROR shape), then succeeds on the very next
// call — proves invokeLiveStructuredAnalysis's one bounded retry recovers
// from a one-off provider hiccup without ever falling back to a different
// profile or fabricating a result. A call-count counter file distinguishes
// "first call" from "second call" across separate stub process invocations.
if (mode === 'flaky-then-success') {
  const { existsSync, writeFileSync } = await import('node:fs')
  const counterFile = process.env.STUB_FLAKY_COUNTER_FILE
  if (!existsSync(counterFile)) {
    writeFileSync(counterFile, '1')
    process.stdout.write(
      JSON.stringify({
        is_error: true,
        result: 'deliberate one-off stub provider error',
        session_id: sessionId
      })
    )
    process.exit(0)
  }
}

const resume = argValue('--resume')
if (resume && resume !== sessionId) {
  process.stderr.write(`No conversation found with session ID: ${resume}`)
  process.exit(1)
}

const prompt = argValue('-p') || ''
const jsonSchema = argValue('--json-schema')

// When --json-schema is passed (structured one-shot analysis calls), emit
// a result shaped for WHICHEVER schema was actually requested -- inspected
// by its schemaVersion const, not guessed by call order -- so this one
// stub serves every structured caller (onboarding direction analysis, M3's
// chat work-plan-request) without needing a separate stub per schema.
function structuredResponseFor(schemaJson, prompt) {
  let schema
  try {
    schema = JSON.parse(schemaJson)
  } catch {
    return null
  }
  const schemaVersion = schema?.properties?.schemaVersion?.const
  if (schemaVersion === 'TSF_CHAT_WORK_PLAN_REQUEST_V1') {
    return {
      schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
      objective: `stub-plan-for::${prompt}`.slice(0, 4000),
      decisions: [],
      allowedScope: ['docs/stub-work-plan-target.md'],
      constraints: [],
      prohibitedActions: [],
      relevantComponents: [],
      acceptanceCriteria: ['stub acceptance criterion'],
      requiredTests: [],
      stopConditions: ['stub stop condition']
    }
  }
  if (schemaVersion === 'TSF_WBS_GENERATION_REQUEST_V1') {
    // STUB_WBS_INVALID: schema-conformant (every field is individually the
    // right type) but domain-invalid (min > expected) -- lets tests prove
    // normalizeWbs's own semantic validation catches what the JSON schema
    // alone cannot.
    const activeEffortHours =
      process.env.STUB_WBS_INVALID === '1'
        ? { min: 20, expected: 8, max: 16 }
        : { min: 4, expected: 8, max: 16 }
    // STUB_WBS_MULTI: a larger, less-certain decomposition (dependency
    // chain + a conflicting pair + one low-clarity/confidence task) --
    // proves a real multi-task WBS flows end to end through normalizeWbs,
    // the Monte Carlo engine, and dependency-aware scheduling, not just
    // the single-task happy path.
    if (process.env.STUB_WBS_MULTI === '1') {
      return {
        schemaVersion: 'TSF_WBS_GENERATION_REQUEST_V1',
        tasks: [
          {
            id: 'discover',
            title: 'Discovery and design',
            stage: 'discovery',
            activeEffortHours: { min: 2, expected: 4, max: 8 },
            clarity: 0.8,
            confidence: 0.8,
            risk: 'LOW',
            providerRoleHint: 'PLANNER_BALANCED',
            assumptions: [],
            evidence: [],
            blockers: []
          },
          {
            id: 'implement',
            title: 'Core implementation',
            stage: 'implementation',
            dependencies: ['discover'],
            activeEffortHours: { min: 10, expected: 24, max: 60 },
            clarity: 0.3,
            confidence: 0.3,
            risk: 'HIGH',
            providerRoleHint: 'WORKER_DEEP',
            assumptions: ['Unfamiliar legacy module -- true effort is genuinely uncertain'],
            evidence: [],
            blockers: []
          },
          {
            id: 'verify',
            title: 'Independent verification',
            stage: 'verification',
            dependencies: ['implement'],
            conflictsWith: ['implement'],
            activeEffortHours: { min: 2, expected: 6, max: 12 },
            clarity: 0.7,
            confidence: 0.7,
            risk: 'MODERATE',
            providerRoleHint: 'VERIFIER_INDEPENDENT',
            assumptions: [],
            evidence: [],
            blockers: []
          }
        ]
      }
    }
    return {
      schemaVersion: 'TSF_WBS_GENERATION_REQUEST_V1',
      tasks: [
        {
          id: 'stub-task-1',
          title: `stub-wbs-for::${prompt}`.slice(0, 200),
          stage: 'implementation',
          activeEffortHours,
          clarity: 0.7,
          confidence: 0.7,
          risk: 'LOW',
          providerRoleHint: 'WORKER_BALANCED',
          assumptions: ['stub assumption'],
          evidence: ['stub evidence'],
          blockers: []
        }
      ]
    }
  }
  if (schemaVersion === 'TSF_COMMAND_SCOPE_CLASSIFICATION_V1') {
    // STUB_SCOPE_OVERRIDE picks the classified scope directly (tests
    // proving each branch); default is a reasonable GLOBAL_ADVISORY guess
    // so an unconfigured call still exercises the real wiring end to end.
    return {
      schemaVersion: 'TSF_COMMAND_SCOPE_CLASSIFICATION_V1',
      scope: process.env.STUB_SCOPE_OVERRIDE || 'GLOBAL_ADVISORY',
      reasoning: `stub-reasoning-for::${prompt}`.slice(0, 500)
    }
  }
  if (schemaVersion === 'TSF_RESEARCH_SPEC_SYNTHESIS_V1') {
    // STUB_RESEARCH_SPEC_INSUFFICIENT=1 simulates a genuinely under-
    // specified request -- the NEEDS_INPUT path, not the happy path.
    if (process.env.STUB_RESEARCH_SPEC_INSUFFICIENT === '1') {
      return {
        schemaVersion: 'TSF_RESEARCH_SPEC_SYNTHESIS_V1',
        sufficientlySpecified: false,
        clarificationNeeded: 'stub: which specific years and fields do you want?',
        researchQuestion: null,
        entityType: null,
        expectedEntities: [],
        expectedUniverseSource: null,
        requestedFields: [],
        temporalPeriodScope: null,
        sourceStrategy: null,
        verificationRequirement: null,
        completenessRequirement: null
      }
    }
    return {
      schemaVersion: 'TSF_RESEARCH_SPEC_SYNTHESIS_V1',
      sufficientlySpecified: true,
      clarificationNeeded: null,
      researchQuestion: `stub-research-question-for::${prompt}`.slice(0, 500),
      entityType: 'STUB_ENTITY',
      expectedEntities: [
        { entityId: 'stub-entity-1', label: 'stub entity 1' },
        { entityId: 'stub-entity-2', label: 'stub entity 2' }
      ],
      expectedUniverseSource: 'stub: inferred from the request\'s own explicit scope',
      requestedFields: [
        { fieldName: 'stubValue', valueType: 'number', required: true },
        { fieldName: 'stubSource', valueType: 'string', required: true }
      ],
      temporalPeriodScope: 'stub-period',
      preferredSourceUrls: ['https://example.com/stub-source-1', 'not-a-real-url', 'https://example.com/stub-source-2'],
      sourceStrategy: 'stub: official/deterministic/public acquisition before AI research',
      verificationRequirement: 'stub: independent source cross-check where available',
      completenessRequirement: 'stub: every expected entity has a value and a source'
    }
  }
  // Falls back to the onboarding direction-analysis shape (the only other
  // structured caller today).
  return {
    purpose: `stub-answer-for::${prompt}`.slice(0, 4000),
    completedSummary: 'stub completed summary',
    unfinishedSummary: 'stub unfinished summary',
    alignment: 'ALIGNED',
    alignmentRationale: 'stub alignment rationale',
    recommendedNextMission: { title: 'stub next mission', rationale: 'stub rationale' },
    upgradeCandidates: []
  }
}

const structured = jsonSchema ? structuredResponseFor(jsonSchema, prompt) : null

process.stdout.write(
  JSON.stringify({
    is_error: false,
    result: structured ? JSON.stringify(structured) : `stub-answer-for::${prompt}`,
    structured_output: structured,
    session_id: sessionId,
    total_cost_usd: 0.001,
    modelUsage: { [model]: { canonicalModel: model } }
  })
)
process.exit(0)
