// Hands-on pilot round 2, Finding 2: real ResearchSpecification synthesis
// from an already-reasonably-scoped chat request, proven through the real
// live-planner subprocess wiring (stub CLI, deterministic content) --
// sufficient/insufficient/unavailable, plus the structural re-validation
// this module does independent of whatever the CLI's own --json-schema
// enforcement already caught (defense in depth, same discipline
// domain/estimation.mjs's normalizeWbs applies to WBS generation).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const { synthesizeResearchSpecification, validateSynthesis } = await import('../server/command-research-spec-synthesis.mjs')

function withPlannerEnv(claudeCommand, extra, fn) {
  const saved = { TSF_PLANNER_CLAUDE_COMMAND: process.env.TSF_PLANNER_CLAUDE_COMMAND, TSF_PLANNER_CODEX_COMMAND: process.env.TSF_PLANNER_CODEX_COMMAND, ...Object.fromEntries(Object.keys(extra ?? {}).map((k) => [k, process.env[k]])) }
  process.env.TSF_PLANNER_CLAUDE_COMMAND = claudeCommand
  process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
  for (const [k, v] of Object.entries(extra ?? {})) process.env[k] = v
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
}

test('sufficient request (stub happy path): produces a real, structurally-valid specification/expectedUniverse/nodes', async () => {
  await withPlannerEnv(PLANNER_STUB, {}, async () => {
    const result = await synthesizeResearchSpecification({ message: 'research something reasonably scoped', missionId: 'mission:synth-test', freeOnly: true })
    assert.equal(result.ok, true)
    assert.equal(result.specification.schemaVersion, 'TSF_RESEARCH_SPECIFICATION_V1')
    assert.equal(result.specification.budget.maxCostUsd, 0, 'freeOnly must map to a real $0 budget ceiling, not merely a note')
    assert.equal(result.expectedUniverse.schemaVersion, 'TSF_EXPECTED_UNIVERSE_V1')
    assert.equal(result.expectedUniverse.expectedCount, result.nodes.length, 'expectedCount must match the real node count, never drift from it')
    assert.ok(result.nodes.length > 0)
    for (const node of result.nodes) {
      assert.ok(node.id.startsWith('node:'))
      assert.ok(node.targetEntity.entityId)
      assert.ok(node.requestedFields.length > 0)
    }
  })
})

test('REAL FREE-PATH RESEARCH EXECUTION V1: requestedOutputSchema.properties is populated from requestedFields -- a real, previously-undiscovered bug where it was always {} (no properties at all), meaning fieldNames(request) returned [] for every real worker dispatch', async () => {
  await withPlannerEnv(PLANNER_STUB, {}, async () => {
    const result = await synthesizeResearchSpecification({ message: 'research something reasonably scoped', missionId: 'mission:synth-schema-test', freeOnly: true })
    assert.equal(result.ok, true)
    for (const node of result.nodes) {
      assert.equal(node.requestedOutputSchema.type, 'object')
      const propertyNames = Object.keys(node.requestedOutputSchema.properties)
      assert.deepEqual(propertyNames.sort(), node.requestedFields.map((f) => f.fieldName).sort(), 'requestedOutputSchema.properties must name exactly the requested fields, so a real worker actually asks for them')
    }
  })
})

test('preferredSourceUrls proposed by the planner become sourcePolicy.preferredSources, filtering out anything not a real http(s) URL', async () => {
  await withPlannerEnv(PLANNER_STUB, {}, async () => {
    const result = await synthesizeResearchSpecification({ message: 'research something reasonably scoped', missionId: 'mission:synth-sources-test', freeOnly: true })
    assert.equal(result.ok, true)
    assert.deepEqual(result.specification.sourcePolicy.preferredSources, ['https://example.com/stub-source-1', 'https://example.com/stub-source-2'], 'the non-URL entry the stub planner proposed must be filtered out, never passed through to a real fetch attempt')
  })
})

test('under-specified request (stub NEEDS_INPUT): refuses with ONE bounded clarification, creates nothing', async () => {
  await withPlannerEnv(PLANNER_STUB, { STUB_RESEARCH_SPEC_INSUFFICIENT: '1' }, async () => {
    const result = await synthesizeResearchSpecification({ message: 'research something vague', missionId: 'mission:synth-needs-input', freeOnly: false })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'NEEDS_INPUT')
    assert.ok(result.clarification && result.clarification.length > 0)
  })
})

test('planner unavailable: an honest PLANNER_UNAVAILABLE failure, never a fabricated specification', async () => {
  await withPlannerEnv(NONEXISTENT, {}, async () => {
    const result = await synthesizeResearchSpecification({ message: 'research anything', missionId: 'mission:synth-unavailable', freeOnly: false })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'PLANNER_UNAVAILABLE')
  })
})

test('validateSynthesis: refuses a schema-conformant but structurally-empty universe (zero expected entities) -- defense in depth beyond the CLI\'s own JSON schema', () => {
  assert.equal(validateSynthesis({ expectedEntities: [], requestedFields: [{ fieldName: 'x', valueType: 'number' }] }), null)
})

test('validateSynthesis: refuses zero requested fields', () => {
  assert.equal(validateSynthesis({ expectedEntities: [{ entityId: 'e1', label: 'E1' }], requestedFields: [] }), null)
})

test('validateSynthesis: refuses a duplicate entityId -- never silently collapses the claimed universe size', () => {
  assert.equal(
    validateSynthesis({
      expectedEntities: [{ entityId: 'dup', label: 'A' }, { entityId: 'dup', label: 'B' }],
      requestedFields: [{ fieldName: 'x', valueType: 'number' }]
    }),
    null
  )
})

test('validateSynthesis: refuses an invalid valueType even if the CLI somehow emitted one', () => {
  assert.equal(
    validateSynthesis({
      expectedEntities: [{ entityId: 'e1', label: 'E1' }],
      requestedFields: [{ fieldName: 'x', valueType: 'not-a-real-type' }]
    }),
    null
  )
})

test('validateSynthesis: accepts a genuinely well-formed synthesis', () => {
  const data = { expectedEntities: [{ entityId: 'e1', label: 'E1' }], requestedFields: [{ fieldName: 'x', valueType: 'number' }] }
  assert.equal(validateSynthesis(data), data)
})
