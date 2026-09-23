// TSF Owner Dogfood/Critique Loop V1, Chunk 2: real synthesis proof using
// the mission's own realistic messy owner rant, through the real
// live-planner subprocess wiring (stub CLI, deterministic content) --
// mirrors command-research-spec-synthesis.test.mjs's discipline exactly.
// A real LLM's own creative classification of a rant is covered
// separately by live UI/Command dogfood against a real provider; this
// file proves the structural validation, the fail-closed disposition
// rule, and the real finding-store dedup/handoff wiring.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-synthesis-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { synthesizeDogfoodSession } = await import('../server/dogfood-synthesis.mjs')
const { validateDogfoodSynthesis, isActionableObservation } =
  await import('../domain/dogfood-synthesis.mjs')
const { createDogfoodSession, appendDogfoodTurn, endDogfoodSession } =
  await import('../domain/dogfood-session.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')

function withPlannerEnv(claudeCommand, extra, fn) {
  const saved = {
    TSF_PLANNER_CLAUDE_COMMAND: process.env.TSF_PLANNER_CLAUDE_COMMAND,
    TSF_PLANNER_CODEX_COMMAND: process.env.TSF_PLANNER_CODEX_COMMAND,
    ...Object.fromEntries(Object.keys(extra ?? {}).map((k) => [k, process.env[k]]))
  }
  process.env.TSF_PLANNER_CLAUDE_COMMAND = claudeCommand
  process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
  for (const [k, v] of Object.entries(extra ?? {})) {
    process.env[k] = v
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = v
      }
    }
  })
}

// The mission brief's own realistic messy owner rant, split into distinct
// owner turns roughly matching its natural sentence breaks.
const RANT_TURNS = [
  'This top card is kind of useless.',
  "Actually maybe not useless, but it definitely shouldn't be the first thing I see.",
  "This Needs You thing is good though, don't fuck with that.",
  'The hold is way more important than the health thing.',
  'Maybe move Research under Work.',
  'Actually forget that, leave Research alone.',
  'This button looks ugly.',
  'Delete it.',
  "Actually no, don't delete it, just make it less prominent.",
  'Why does this count say two when I can see three things?',
  'This right here is confusing.',
  "Maybe we should pause this project -- wait, I'm just talking about the UI, don't actually pause anything."
]

function buildRantSession(clock) {
  let session = createDogfoodSession(
    { id: 'dogfood:rant-test', projectId: 'rant-test-project' },
    clock
  )
  for (const content of RANT_TURNS) {
    session = appendDogfoodTurn(session, { role: 'OWNER', content }, clock)
  }
  return endDogfoodSession(session, clock)
}

const RANT_OBSERVATIONS = [
  {
    category: 'UX_PROBLEM',
    settledDescription:
      'The top summary card should not be the first thing shown -- it should move lower, not be removed.',
    disposition: 'NEEDS_OWNER_DECISION',
    evidenceTurnIndexes: [0, 1],
    severity: 'P2',
    route: '/hq'
  },
  {
    category: 'GOOD_AS_IS_PROTECT',
    settledDescription: 'The Needs You indicator is good as-is and must not change.',
    disposition: 'DO_NOT_ACT',
    evidenceTurnIndexes: [2],
    severity: null,
    route: '/hq'
  },
  {
    category: 'RETRACTED_SUPERSEDED',
    settledDescription:
      "Moving Research under Work was suggested then retracted -- Research's placement stays unchanged.",
    disposition: 'DO_NOT_ACT',
    evidenceTurnIndexes: [4, 5],
    severity: null,
    route: null
  },
  {
    category: 'VISUAL_POLISH_ISSUE',
    settledDescription: 'The button should be made less prominent, not deleted.',
    disposition: 'NEEDS_OWNER_DECISION',
    evidenceTurnIndexes: [6, 7, 8],
    severity: 'P3',
    route: null
  },
  {
    category: 'BUG',
    settledDescription:
      'A count displays 2 when 3 items are visibly present -- likely a stale or off-by-one count.',
    disposition: 'SAFE_TO_IMPLEMENT',
    evidenceTurnIndexes: [9],
    severity: 'P2',
    route: null
  },
  {
    category: 'AMBIGUOUS',
    settledDescription:
      'An unspecified UI element was called confusing with no clear referent in the transcript.',
    disposition: 'DO_NOT_ACT',
    evidenceTurnIndexes: [10],
    severity: null,
    route: null
  },
  {
    category: 'RETRACTED_SUPERSEDED',
    settledDescription:
      'A suggestion to pause the project was immediately retracted -- purely a UI comment, not a real pause request.',
    disposition: 'DO_NOT_ACT',
    evidenceTurnIndexes: [11],
    severity: null,
    route: null
  }
]

test("Realistic rant E2E: the mission's own messy example synthesizes into correctly classified, disposition-safe observations", async () => {
  await withPlannerEnv(
    PLANNER_STUB,
    { STUB_DOGFOOD_SYNTHESIS_JSON: JSON.stringify(RANT_OBSERVATIONS) },
    async () => {
      const session = buildRantSession(() => new Date('2026-09-22T18:00:00.000Z'))
      const result = await synthesizeDogfoodSession(session, { clock: () => new Date() })

      assert.equal(result.ok, true)
      assert.equal(result.observations.length, RANT_OBSERVATIONS.length)

      const byCategory = Object.fromEntries(result.observations.map((o) => [o.category, o]))
      assert.equal(byCategory.GOOD_AS_IS_PROTECT.disposition, 'DO_NOT_ACT')
      assert.match(byCategory.GOOD_AS_IS_PROTECT.settledDescription, /Needs You/)
      assert.equal(byCategory.AMBIGUOUS.disposition, 'DO_NOT_ACT')
      assert.equal(
        result.observations.filter((o) => o.category === 'RETRACTED_SUPERSEDED').length,
        2,
        'both retracted threads (Research placement, the accidental pause mention) must be captured, never as live directives'
      )
      // The literal directive-shaped phrase "pause this project" appeared
      // in the rant -- proving it never became a real action is the whole
      // point of this test family (Chunk 1 already proves capture-time
      // non-execution; this proves synthesis-time non-escalation too).
      const pauseObservation = result.observations.find((o) =>
        o.settledDescription.toLowerCase().includes('pause')
      )
      assert.equal(pauseObservation.disposition, 'DO_NOT_ACT')

      // Only the genuinely actionable observations (UX_PROBLEM,
      // VISUAL_POLISH_ISSUE, BUG) become real, tracked findings, routed
      // through VERIFIED to the real, existing NEEDS_OWNER status -- a
      // dogfood-sourced finding is a genuine direct report, but never
      // trusted enough to skip owner review, even the one SAFE_TO_IMPLEMENT
      // bug observation.
      assert.equal(result.findingIds.length, 3)
      for (const findingId of result.findingIds) {
        const finding = readFinding(findingId)
        assert.ok(finding, `finding ${findingId} must be durably persisted`)
        assert.equal(finding.sourceDetector, 'COMMAND_DOGFOOD')
        assert.equal(finding.projectId, 'rant-test-project')
        assert.equal(finding.status, 'NEEDS_OWNER')
        assert.deepEqual(
          finding.transitions.map((t) => t.to),
          ['DETECTED', 'VERIFIED', 'NEEDS_OWNER']
        )
        assert.equal(finding.transitions[1].reason, 'OWNER_DOGFOOD_DIRECT_REPORT')
      }

      // Batching: the UX_PROBLEM (route /hq) groups separately from the
      // two route-less observations (VISUAL_POLISH_ISSUE, BUG), which
      // share the UNSPECIFIED_SURFACE bucket together.
      assert.equal(result.batches.length, 2)
      const hqBatch = result.batches.find((b) => b.surface === '/hq')
      assert.equal(hqBatch.observations.length, 1)
      const unspecifiedBatch = result.batches.find((b) => b.surface === 'UNSPECIFIED_SURFACE')
      assert.equal(unspecifiedBatch.observations.length, 2)
    }
  )
})

test('Recurring detection of an already-reviewed dogfood finding is never re-transitioned', async () => {
  await withPlannerEnv(
    PLANNER_STUB,
    { STUB_DOGFOOD_SYNTHESIS_JSON: JSON.stringify([RANT_OBSERVATIONS[4]]) }, // the BUG observation
    async () => {
      const clock = () => new Date('2026-09-22T18:00:00.000Z')
      const first = await synthesizeDogfoodSession(
        endDogfoodSession(
          appendDogfoodTurn(
            createDogfoodSession({ id: 'dogfood:recur-1', projectId: 'recur-project' }, clock),
            { role: 'OWNER', content: RANT_TURNS[9] },
            clock
          ),
          clock
        ),
        { clock }
      )
      assert.equal(first.findingIds.length, 1)
      const findingId = first.findingIds[0]
      const afterFirst = readFinding(findingId)
      assert.equal(afterFirst.status, 'NEEDS_OWNER')
      assert.equal(afterFirst.occurrences, 1)

      // A SECOND session, same underlying observation (same detector +
      // surface + settled description) -- the SAME content-addressed
      // finding recurs, occurrence count bumps, but status must NOT be
      // re-transitioned (NEEDS_OWNER has no self-loop; attempting one
      // would throw).
      const second = await synthesizeDogfoodSession(
        endDogfoodSession(
          appendDogfoodTurn(
            createDogfoodSession({ id: 'dogfood:recur-2', projectId: 'recur-project' }, clock),
            { role: 'OWNER', content: RANT_TURNS[9] },
            clock
          ),
          clock
        ),
        { clock }
      )
      assert.equal(
        second.findingIds[0],
        findingId,
        'must resolve to the SAME finding, never a duplicate'
      )
      const afterSecond = readFinding(findingId)
      assert.equal(afterSecond.status, 'NEEDS_OWNER')
      assert.equal(afterSecond.occurrences, 2, 'recurrence must still bump the occurrence counter')
    }
  )
})

test('Fail-closed disposition rule: a never-actionable category is forced to DO_NOT_ACT even if the planner wrongly claims otherwise', async () => {
  const maliciousObservations = [
    {
      category: 'GOOD_AS_IS_PROTECT',
      settledDescription: 'This is fine as-is.',
      disposition: 'SAFE_TO_IMPLEMENT', // wrong on purpose -- must be overridden
      evidenceTurnIndexes: [0],
      severity: 'P1',
      route: null
    },
    {
      category: 'RETRACTED_SUPERSEDED',
      settledDescription: 'A retracted idea.',
      disposition: 'NEEDS_OWNER_DECISION', // also wrong -- must be overridden
      evidenceTurnIndexes: [0],
      severity: null,
      route: null
    }
  ]
  const cleaned = validateDogfoodSynthesis(
    { schemaVersion: 'TSF_DOGFOOD_SYNTHESIS_V1', observations: maliciousObservations },
    5
  )
  assert.ok(cleaned)
  for (const observation of cleaned) {
    assert.equal(observation.disposition, 'DO_NOT_ACT')
    assert.equal(isActionableObservation(observation), false)
  }
})

test('Structural validation refuses a malformed synthesis response (unknown category)', async () => {
  const invalid = validateDogfoodSynthesis(
    {
      schemaVersion: 'TSF_DOGFOOD_SYNTHESIS_V1',
      observations: [
        {
          category: 'NOT_A_REAL_CATEGORY',
          settledDescription: 'x',
          disposition: 'DO_NOT_ACT',
          evidenceTurnIndexes: []
        }
      ]
    },
    5
  )
  assert.equal(invalid, null)
})

test('Nothing captured: synthesis refuses cleanly rather than calling the planner on an empty transcript', async () => {
  await withPlannerEnv(PLANNER_STUB, {}, async () => {
    const session = endDogfoodSession(
      createDogfoodSession({ id: 'dogfood:empty-test', projectId: null }, () => new Date()),
      () => new Date()
    )
    const result = await synthesizeDogfoodSession(session, { clock: () => new Date() })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'NOTHING_CAPTURED')
  })
})

test('Planner unavailable: synthesis degrades honestly instead of throwing', async () => {
  await withPlannerEnv(NONEXISTENT, {}, async () => {
    const session = buildRantSession(() => new Date('2026-09-22T18:00:00.000Z'))
    const result = await synthesizeDogfoodSession(session, { clock: () => new Date() })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'PLANNER_UNAVAILABLE')
  })
})
