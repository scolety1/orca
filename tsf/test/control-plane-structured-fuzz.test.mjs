// Full Conversational Control Plane Exhaustive Gauntlet V1, one-hour
// continuation, Priority 6: bounded, seeded, structured fuzzing across the
// intent classifier, the adoption/consequential detector, the referent
// resolver, and the multi-action decomposer -- with the specific
// adversarial-formatting dimensions the mission's own directive named:
// whitespace, punctuation, unicode, emoji, nested quotes, semicolons,
// CRLF/LF, Windows paths, Markdown, partial JSON, command-like filenames,
// and very long individual lines. No browser required, no heavy
// dependencies -- every case here is a synchronous, in-process call.
//
// Design: unlike test/control-plane-negation-vocabulary-fuzz.test.mjs's
// own pure-garbage crash-fuzzing, this file mixes REAL trigger vocabulary
// (adopt/pause/research/run) with adversarial formatting AROUND it, so it
// exercises the real classification logic under hostile input shapes, not
// just proves nothing throws.
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIntent, classifyDecision } from '../server/chat-responder.mjs'
import { classifyAdoptionCommandIntent } from '../domain/command-adoption-execution.mjs'
import { decomposeMultiAction } from '../domain/command-multi-action-decomposition.mjs'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'

function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(0xba5ed)
function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)]
}

const PROJECTS = [
  { id: 'batch14-project-a', displayName: 'Batch14ProjectA' },
  { id: 'batch14-project-b', displayName: 'Batch14ProjectB' }
]
const aliases = loadProjectAliases()

// The specific adversarial-formatting "noise" dimensions the mission's own
// directive named, each as a short snippet to splice in around real
// trigger vocabulary.
const NOISE_SNIPPETS = [
  '',
  '   ',
  '\t\t',
  '\r\n',
  '\n\n\n',
  '...',
  '!!!',
  '???',
  ';;;',
  '💥🔥😀',
  '\u200b', // zero-width space
  '\u00a0', // non-breaking space
  '"nested \'quoted\' text"',
  "'nested \"quoted\" text'",
  'C:\\Users\\test\\file.txt',
  '/usr/local/bin/run-this.sh',
  '```js\nconst x = 1;\n```',
  '**bold** _italic_ [link](https://example.com)',
  '{"partial": "json", "missing":',
  '{ "key": [1, 2, 3',
  'run.exe --adopt --force',
  'rm -rf --no-preserve-root',
  'a'.repeat(2000), // one very long token
  '한국어 텍스트 테스트', // non-Latin unicode
  'émojis and àccents: café, naïve, Zürich'
]

const TRIGGER_TEMPLATES = [
  (p) => `adopt ${p}`,
  (p) => `pause ${p}`,
  (p) => `research ${p}`,
  (p) => `run ${p}`,
  (p) => `don't adopt ${p}`,
  (p) => `status of ${p}?`,
  (p) => `is ${p} finished?`
]

function buildNoisyMessage(rand) {
  const template = pick(rand, TRIGGER_TEMPLATES)
  const target = pick(rand, PROJECTS).id
  const before = pick(rand, NOISE_SNIPPETS)
  const middle = pick(rand, NOISE_SNIPPETS)
  const after = pick(rand, NOISE_SNIPPETS)
  const core = template(target)
  // Splice noise before/inside/after the real trigger text.
  const mid = Math.max(1, Math.floor(core.length / 2))
  return `${before}${core.slice(0, mid)}${middle}${core.slice(mid)}${after}`
}

const KNOWN_INTENTS = new Set([
  'STATUS', 'FINISHED', 'DISPATCH_REQUEST', 'NEXT_ACTION', 'RATIONALE', 'CRITIQUE',
  'FIX_REQUEST', 'RESEARCH', 'HEALTH', 'ADOPTION', 'QUESTION', 'FEEDBACK_BUG',
  'ACKNOWLEDGEMENT', 'GENERAL'
])
const KNOWN_DECISIONS = new Set(['AUTO_DECIDE', 'RECOMMEND_AND_PROCEED', 'TIM_REQUIRED'])
const KNOWN_ADOPTION_CLASSES = new Set(['NOT_ADOPTION', 'AMBIGUOUS', 'EXECUTE_ADOPTION'])

test('Batch 14 structured fuzz: classifyIntent/classifyDecision never crash and always return a known label under adversarial formatting', () => {
  const ITERATIONS = 500
  for (let i = 0; i < ITERATIONS; i++) {
    const message = buildNoisyMessage(rng)
    const intent = classifyIntent(message)
    assert.ok(KNOWN_INTENTS.has(intent), `iteration ${i}: unrecognized intent "${intent}" for ${JSON.stringify(message)}`)
    const decision = classifyDecision(message, intent)
    assert.ok(KNOWN_DECISIONS.has(decision), `iteration ${i}: unrecognized decision "${decision}" for ${JSON.stringify(message)}`)
  }
})

test('Batch 14 structured fuzz: classifyAdoptionCommandIntent never crashes and always returns a known class under adversarial formatting', () => {
  const ITERATIONS = 500
  for (let i = 0; i < ITERATIONS; i++) {
    const message = buildNoisyMessage(rng)
    const cls = classifyAdoptionCommandIntent(message, PROJECTS)
    assert.ok(KNOWN_ADOPTION_CLASSES.has(cls), `iteration ${i}: unrecognized class "${cls}" for ${JSON.stringify(message)}`)
  }
})

test('Batch 14 structured fuzz: decomposeMultiAction never crashes and never fabricates an unmentioned target under adversarial formatting', () => {
  const ITERATIONS = 500
  const knownIds = new Set(PROJECTS.map((p) => p.id))
  for (let i = 0; i < ITERATIONS; i++) {
    const message = `${buildNoisyMessage(rng)} ${buildNoisyMessage(rng)}`
    const entries = decomposeMultiAction(message, PROJECTS, aliases)
    assert.ok(Array.isArray(entries), `iteration ${i}: must always return an array`)
    for (const entry of entries) {
      assert.ok(knownIds.has(entry.target), `iteration ${i}: fabricated target "${entry.target}" for ${JSON.stringify(message)}`)
    }
  }
})

test('Batch 14 structured fuzz: resolveProjectsFromText never crashes and every returned match is a real project under adversarial formatting', () => {
  const ITERATIONS = 500
  const knownIds = new Set(PROJECTS.map((p) => p.id))
  for (let i = 0; i < ITERATIONS; i++) {
    const message = buildNoisyMessage(rng)
    const resolution = resolveProjectsFromText(message, PROJECTS, {})
    assert.ok(resolution && Array.isArray(resolution.matches), `iteration ${i}: must always return a real matches array`)
    for (const match of resolution.matches) {
      assert.ok(knownIds.has(match.project.id), `iteration ${i}: fabricated match "${match.project.id}" for ${JSON.stringify(message)}`)
    }
  }
})

// Pure garbage (no trigger vocabulary at all) across the same adversarial
// dimensions, concatenated randomly -- proves robustness even with zero
// recognizable content, not just noise-around-a-real-trigger.
function buildPureNoiseMessage(rand) {
  const count = 1 + Math.floor(rand() * 4)
  let s = ''
  for (let i = 0; i < count; i++) {
    s += pick(rand, NOISE_SNIPPETS)
  }
  return s
}

test('Batch 14 structured fuzz: pure adversarial-formatting noise (no trigger vocabulary) never crashes any classifier', () => {
  const ITERATIONS = 300
  for (let i = 0; i < ITERATIONS; i++) {
    const message = buildPureNoiseMessage(rng)
    assert.ok(KNOWN_INTENTS.has(classifyIntent(message)), `iteration ${i}: classifyIntent failed on ${JSON.stringify(message)}`)
    assert.ok(KNOWN_ADOPTION_CLASSES.has(classifyAdoptionCommandIntent(message, PROJECTS)), `iteration ${i}: classifyAdoptionCommandIntent failed on ${JSON.stringify(message)}`)
    assert.ok(Array.isArray(decomposeMultiAction(message, PROJECTS, aliases)), `iteration ${i}: decomposeMultiAction failed on ${JSON.stringify(message)}`)
    const resolution = resolveProjectsFromText(message, PROJECTS, {})
    assert.ok(resolution && Array.isArray(resolution.matches), `iteration ${i}: resolveProjectsFromText failed on ${JSON.stringify(message)}`)
  }
})
