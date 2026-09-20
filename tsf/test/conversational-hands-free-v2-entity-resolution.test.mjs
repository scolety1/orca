// Conversational Command + Continuous Hands-Free V2 -- Phase 3 (Project /
// Entity Resolution V2). Real reproductions of the mission's own reported
// Failure 1: spoken "Thousand Sunny Fleet"/"TSF"/"Sunny Fleet" (and CLC/
// Colety Labs) resolved to nothing at all, even though the canonical
// tsf-orca/colety-labs-sales-engine projects exist. Uses the REAL default
// aliases (domain/project-aliases.mjs, no override) and the real project
// id/displayName shapes as they actually exist in the live catalog
// (`tsf-orca` / `TSF_ORCA`, `colety-labs-sales-engine` /
// `colety-labs-sales-engine`, `niners-war-room` / `Niners-War-Room`) --
// this file never touches real owner state, it only proves the pure
// resolver function against inert, hand-shaped project objects matching
// the real catalog's own real ids/displayNames.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'

const REAL_PROJECTS = [
  { id: 'tsf-orca', displayName: 'TSF_ORCA' },
  { id: 'niners-war-room', displayName: 'Niners-War-Room' },
  { id: 'colety-labs-sales-engine', displayName: 'colety-labs-sales-engine' }
]

function ids(matches) {
  return matches.map((m) => m.project.id)
}

test('REPRODUCTION (Failure 1): "what is currently going on within tsf at the moment" now resolves TSF', () => {
  const { matches } = resolveProjectsFromText(
    'hello I think this is working ... what is currently going on within tsf at the moment',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('REPRODUCTION (Failure 1): "let\'s work on Thousand Sunny Fleet I need an upgrade" now resolves TSF', () => {
  const { matches } = resolveProjectsFromText(
    "let's work on Thousand Sunny Fleet I need an upgrade",
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('bare "TSF" alone resolves (previously 0.5 fuzzy ratio, just under the 0.6 floor)', () => {
  const { matches } = resolveProjectsFromText('what is TSF doing?', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('"Sunny Fleet" (the shorter real spoken name) resolves TSF', () => {
  const { matches } = resolveProjectsFromText('switch to Sunny Fleet', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

test('"TSF Orca" (spoken, no underscore) resolves via the normalized-name tier, at exact confidence', () => {
  const { matches } = resolveProjectsFromText('status on TSF Orca please', REAL_PROJECTS)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].project.id, 'tsf-orca')
  assert.notEqual(matches[0].matchedOn, 'fuzzy')
})

test('NWR aliases: "NWR", "Niners War Room" (no hyphens, as spoken), and the literal hyphenated displayName all resolve the same real project', () => {
  for (const phrase of [
    "what's NWR doing?",
    "let's work on Niners War Room",
    'status on Niners-War-Room'
  ]) {
    const { matches } = resolveProjectsFromText(phrase, REAL_PROJECTS)
    assert.deepEqual(ids(matches), ['niners-war-room'], `failed for: "${phrase}"`)
  }
})

test('CLC / Colety Labs aliases resolve the real Colety Labs project', () => {
  for (const phrase of ['how is CLC doing?', "let's work on Colety Labs"]) {
    const { matches } = resolveProjectsFromText(phrase, REAL_PROJECTS)
    assert.deepEqual(ids(matches), ['colety-labs-sales-engine'], `failed for: "${phrase}"`)
  }
})

test('genuinely ambiguous speech-normalized names still refuse rather than guess', () => {
  const projects = [
    { id: 'alpha-project-one', displayName: 'Alpha Project One' },
    { id: 'alpha-project-two', displayName: 'Alpha Project Two' }
  ]
  const { matches, ambiguous } = resolveProjectsFromText(
    'not sure if this is alpha project one or alpha project two',
    projects
  )
  // Both are full, contiguous phrase matches at exact confidence -- two
  // real exact candidates in one message is a genuinely different (and
  // already-covered) ambiguity shape than "no exact signal at all"; either
  // way, this must never silently collapse to one guessed project.
  assert.equal(matches.length, 2)
  void ambiguous
})

test('an unrelated real project is never dragged in by the new normalized-name tier', () => {
  const { matches } = resolveProjectsFromText("let's work on TSF", REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['tsf-orca'])
})

// REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): a normalized-tier
// match ("password remediation" -> the real `password-remediation`
// project) that co-occurs with a DIFFERENT project's own stronger,
// literal match ("HouseOS") in the same message was silently trusted at
// full exact confidence, resolving BOTH as real dispatch targets -- even
// though "password remediation flow" reads at least as plausibly as
// ordinary descriptive prose about a FEATURE, not a second named project.
test("CODEX FINDING (P0, fixed): a normalized match co-occurring with a different project's real match is demoted, never silently treated as a second real target", () => {
  const projects = [
    { id: 'houseos', displayName: 'HouseOS' },
    { id: 'password-remediation', displayName: 'Password-Remediation' }
  ]
  const { matches } = resolveProjectsFromText('Fix HouseOS password remediation flow', projects)
  assert.deepEqual(
    ids(matches),
    ['houseos'],
    "password-remediation's own normalized-only match must be demoted once HouseOS is already named via a real, stronger signal"
  )
})

test('CODEX FINDING (bonus, confirms the guard is narrow): a SOLE normalized match, with no other project named at all, is unaffected and stays fully trusted', () => {
  const projects = [{ id: 'password-remediation', displayName: 'Password-Remediation' }]
  const { matches } = resolveProjectsFromText(
    "let's discuss password remediation for the current app",
    projects
  )
  assert.deepEqual(ids(matches), ['password-remediation'])
})

// REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): "Ask TSF/Orca to fix
// NWR" bypassed INFRA_MENTION_PATTERN (only use/using/via/through/with/
// run(ning) were covered, not "ask") and resolved tsf-orca as a real
// second dispatch target alongside NWR -- "ask/tell/have/get TSF/Orca to
// ..." addresses the system itself, exactly the class of phrasing this
// guard exists for.
test('CODEX FINDING (P0, fixed): "Ask TSF/Orca to fix NWR" addresses the system, not a real second target -- only NWR resolves', () => {
  const { matches } = resolveProjectsFromText('Ask TSF/Orca to fix NWR', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['niners-war-room'])
})

// REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): the new short "tsf"
// alias collided with the real, live, always-present TSF UI fixture
// project (`tsf-ui-capability-check`, displayName "TSF UI Capability
// Check", which literally starts with "TSF") -- "fix TSF UI Capability
// Check" resolved BOTH tsf-orca (via the alias) and the fixture project
// as real dispatch targets. The longest-specific-match-wins rule fixes
// this the same way it fixes the VOICE-ALPHA/VOICE-ALPHA-TWO case.
test('CODEX FINDING (P0, fixed): the short "tsf" alias never shadows the real, longer "TSF UI Capability Check" project it collides with', () => {
  const projects = [
    { id: 'tsf-orca', displayName: 'TSF_ORCA' },
    { id: 'tsf-ui-capability-check', displayName: 'TSF UI Capability Check' }
  ]
  const { matches } = resolveProjectsFromText('fix TSF UI Capability Check', projects)
  assert.deepEqual(ids(matches), ['tsf-ui-capability-check'])
})
