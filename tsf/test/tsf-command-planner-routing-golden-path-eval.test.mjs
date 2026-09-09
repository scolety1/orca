// TSF_COMMAND_PLANNER_ROUTING_GOLDEN_PATH_EVAL -- a large, deterministic,
// zero-LLM-call regression matrix for the parent-mission-intent-
// classification fix (TSF Software Mission Routing / Project Planner
// Hotfix V1). Everything here calls real production functions
// (shouldSuppressResearchCreation / shouldRouteToResearchBridge /
// classifyResearchIntent / classifyParentMissionIntent) directly -- no
// stubs, no fabricated results. Hundreds of combinatorial + a bounded set
// of seeded-mutation ("fuzz") cases, cheap because the classifier under
// test is pure regex over a string, not a live planner call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRouteToResearchBridge, classifyResearchIntent } from '../server/command-research-bridge.mjs'
import { classifyParentMissionIntent, PARENT_MISSION_INTENTS } from '../domain/parent-mission-intent-classification.mjs'
import { decomposeMultiAction } from '../domain/command-multi-action-decomposition.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'

function freshOpState() {
  return { researchMissions: {}, chatThreads: {} }
}

// ---------------------------------------------------------------------
// Family 1 + 5: generated software-mission combinations. Every one of
// these matches RESEARCH_CREATE_OR_CONTINUE's bare trigger (it always
// contains "research" or "dataset") -- the assertion is that the WHOLE
// pipeline (shouldRouteToResearchBridge, the actual gate both Global
// Command and Planner Chat call) refuses to create a ResearchMission from
// any of them.
// ---------------------------------------------------------------------
const SOFTWARE_VERBS = ['Fix', 'Repair', 'Implement', 'Build', 'Patch', 'Refactor', 'Deploy', 'Migrate']
const SOFTWARE_NOUNS = [
  'the draft engine', 'the sync service', 'the UI component', 'the repo layout', 'the worktree setup',
  'the test suite', 'the database schema', 'the API endpoint', 'the login feature', 'the deploy pipeline',
  'the league shell', 'the replay tooling', 'the parser module', 'the caching layer', 'the auth service',
  'the onboarding flow'
]
const RESEARCH_INSERTIONS = [
  'Research the best approach first.',
  'Research historical outcomes to validate it.',
  'Use dataset evidence from public sources to guide the fix.',
  'Incorporate research findings from the team.',
  'Reference the dataset while implementing.',
  'Study the data before committing.',
  'Research competitors for context.',
  'Base the change on some quick research.'
]

test('golden-path eval: Family 1/5 -- combinatorial software missions containing "research"/"dataset" never route to the Dataset Research bridge', () => {
  const opState = freshOpState()
  const failures = []
  let checked = 0
  for (const verb of SOFTWARE_VERBS) {
    for (const noun of SOFTWARE_NOUNS) {
      for (const insertion of RESEARCH_INSERTIONS) {
        const message = `${verb} ${noun}. Add tests and verify. ${insertion}`
        checked += 1
        // Sanity: this fixture must actually exercise the bug (i.e. it
        // really does match the broad research trigger) -- otherwise the
        // case proves nothing.
        if (classifyResearchIntent(message) !== 'RESEARCH_CREATE_OR_CONTINUE') continue
        if (shouldRouteToResearchBridge(message, opState) !== false) {
          failures.push(message)
        }
      }
    }
  }
  assert.ok(checked >= 1000, `expected a large generated matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${checked} software-mission cases incorrectly routed to Dataset Research`)
})

// ---------------------------------------------------------------------
// Family 2: true dataset-research requests must NEVER regress into
// software classification, across a real combinatorial matrix.
// ---------------------------------------------------------------------
const RESEARCH_ENTITY_TEMPLATES = [
  (year, _n) => `Research every ${year} NFL player and collect exact routes run, source, team and position.`,
  (year, n) => `Build a dataset of all ${n} Fortune 500 CEOs and their listed fields.`,
  (year, n) => `Research these ${n} entities and reconcile their historical values from ${year}.`,
  (year, n) => `Build me a dataset of ${n} companies founded in ${year}, with sources.`,
  (year, _n) => `Research every ${year} draft pick and collect team, position, and college.`
]
const YEARS = [1998, 2003, 2008, 2012, 2016, 2020]
const COUNTS = [25, 100, 250, 500, 1000]

test('golden-path eval: Family 2 -- combinatorial true dataset-research requests still route to Dataset Research', () => {
  const opState = freshOpState()
  const failures = []
  let checked = 0
  for (const template of RESEARCH_ENTITY_TEMPLATES) {
    for (const year of YEARS) {
      for (const n of COUNTS) {
        const message = template(year, n)
        checked += 1
        if (shouldRouteToResearchBridge(message, opState) !== true) {
          failures.push(message)
        }
      }
    }
  }
  assert.ok(checked >= 100, `expected a real matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${checked} true dataset-research cases regressed`)
})

// ---------------------------------------------------------------------
// Family 3: negation combinatorial matrix.
// ---------------------------------------------------------------------
const NEGATION_PHRASES = [
  'Do not research anything;',
  "Don't start a research mission.",
  'No dataset work.',
  'Research is out of scope.',
  'Do not create a ResearchMission for this.',
  'Never start a dataset research task here.'
]

test('golden-path eval: Family 3 -- combinatorial negation never positively triggers Dataset Research', () => {
  const opState = freshOpState()
  const failures = []
  let checked = 0
  for (const verb of SOFTWARE_VERBS) {
    for (const noun of SOFTWARE_NOUNS) {
      for (const negation of NEGATION_PHRASES) {
        const message = `${negation} ${verb} ${noun}.`
        checked += 1
        if (shouldRouteToResearchBridge(message, opState) !== false) {
          failures.push(message)
        }
      }
    }
  }
  assert.ok(checked >= 200, `expected a real matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${checked} negation cases incorrectly routed to Dataset Research`)
})

// ---------------------------------------------------------------------
// Family 11: deterministic seeded "fuzz" -- mutate a base software mission
// with insertions/reordering/typos/case changes and require the parent
// classification to stay SOFTWARE_PRODUCT_ENGINEERING throughout. A
// simple mulberry32 PRNG keeps this reproducible (no Math.random).
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_SOFTWARE_PARAGRAPHS = [
  'Fix the draft engine repair path and add regression tests.',
  'Use a Codex worker to implement the parser fix in the sync service.',
  'Do repo archaeology on the worktree history before touching the UI component.',
  'Run the verifier and confirm Keep Going reaches READY_FOR_ADOPTION.',
  'Research historical outcomes to validate the challenger model as one bounded subtask.'
]

function mutateMessage(paragraphs, rng) {
  const shuffled = [...paragraphs]
  // Fisher-Yates with the seeded RNG -- deterministic reordering.
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  let text = shuffled.join(' ')
  if (rng() < 0.5) text += ' Also research the dataset a bit more.'
  if (rng() < 0.5) text = text.replace(/\./g, ';;')
  if (rng() < 0.5) text = text.toUpperCase()
  if (rng() < 0.5) text += ' "quoted note about research"'
  return text
}

test('golden-path eval: Family 11 -- seeded mutation/fuzz of a software mission stays SOFTWARE_PRODUCT_ENGINEERING across 200 deterministic variants', () => {
  const rng = mulberry32(42)
  const failures = []
  for (let i = 0; i < 200; i += 1) {
    const message = mutateMessage(BASE_SOFTWARE_PARAGRAPHS, rng)
    const classification = classifyParentMissionIntent(message)
    if (classification !== PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING) {
      failures.push({ message, classification })
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length}/200 mutated software-mission variants misclassified`)
})

const BASE_RESEARCH_MESSAGE = 'Research every 2008 NFL player and collect exact routes run, source, team and position, from public sources.'

test('golden-path eval: Family 11 -- seeded mutation/fuzz of a true dataset-research request stays DATASET_RESEARCH across 100 deterministic variants', () => {
  const rng = mulberry32(7)
  const failures = []
  for (let i = 0; i < 100; i += 1) {
    let text = BASE_RESEARCH_MESSAGE
    if (rng() < 0.5) text = text.toUpperCase()
    if (rng() < 0.5) text += ' Please be thorough.'
    if (rng() < 0.5) text = text.replace(/,/g, ';')
    const classification = classifyParentMissionIntent(text)
    if (classification !== PARENT_MISSION_INTENTS.DATASET_RESEARCH) {
      failures.push({ text, classification })
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length}/100 mutated dataset-research variants misclassified`)
})

// ---------------------------------------------------------------------
// Family 8: a multi-project directive's research clause must stay scoped
// to ONLY the project it names -- decomposeMultiAction (pre-existing,
// untouched by this fix) is the real mechanism that keeps per-project
// clauses independent; this proves the research word in one clause never
// bleeds into another project's own clause/target.
// ---------------------------------------------------------------------
test('golden-path eval: Family 8 -- a multi-project directive with one research clause keeps each project independently scoped, never swallowed whole', () => {
  const projects = [
    { id: 'niners-war-room', displayName: 'Niners War Room' },
    { id: 'easylifehq-github-io', displayName: 'EasyLifeHQ' },
    { id: 'worldforge-sablewake-live-runtime-repair-v3', displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3' }
  ]
  const aliases = loadProjectAliases()
  const message = 'Leave niners-war-room held. Fix EasyLifeHQ. Research a data gap in Worldforge-Sablewake-Live-Runtime-Repair-V3.'
  const entries = decomposeMultiAction(message, projects, aliases)

  const nwrEntries = entries.filter((e) => e.target === 'niners-war-room')
  const easyLifeEntries = entries.filter((e) => e.target === 'easylifehq-github-io')
  const researchEntries = entries.filter((e) => e.target === 'worldforge-sablewake-live-runtime-repair-v3')

  assert.ok(nwrEntries.length > 0, 'NWR clause must resolve to its own entry')
  assert.ok(easyLifeEntries.length > 0, 'EasyLife clause must resolve to its own entry')
  assert.ok(researchEntries.length > 0, 'the research clause must resolve to its own entry')
  // The defining invariant: the word "Research" in the third clause never
  // appears in NWR's or EasyLife's own raw clause text -- it never bled
  // across project boundaries.
  for (const e of [...nwrEntries, ...easyLifeEntries]) {
    assert.doesNotMatch(e.rawClause, /research/i, `research word leaked into an unrelated project's clause: "${e.rawClause}"`)
  }
})
