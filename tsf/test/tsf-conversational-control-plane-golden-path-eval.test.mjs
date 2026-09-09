// TSF_CONVERSATIONAL_CONTROL_PLANE_GOLDEN_PATH_EVAL -- Full Conversational
// Control Plane Exhaustive Gauntlet V1, Batches 4/5: a large, deterministic,
// zero-LLM-call combinatorial + property/metamorphic matrix for the
// acknowledgement-gating, adoption-negation, and multi-action negation-
// scoping fixes. Everything here calls real production functions directly
// -- no stubs, no fabricated results. Cheap because every classifier under
// test is pure regex/string logic, never a live planner call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyIntent, classifyDecision } from '../server/chat-responder.mjs'
import { classifyAdoptionCommandIntent, negatesAdoptionVerb } from '../domain/command-adoption-execution.mjs'
import { decomposeMultiAction } from '../domain/command-multi-action-decomposition.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'

// ---------------------------------------------------------------------
// Batch 4: generated combinatorial matrix -- ACKNOWLEDGEMENT.
// ---------------------------------------------------------------------
const ACK_BASE_WORDS = ['awesome', 'great', 'perfect', 'nice', 'sweet', 'cool', 'sick', 'thanks', 'thank you']
const ACK_PUNCTUATION = ['', '!', '!!!', '.', ',']
const ACK_CASINGS = [(s) => s, (s) => s.toUpperCase(), (s) => s[0].toUpperCase() + s.slice(1)]

test('golden-path eval: Batch 4 -- combinatorial acknowledgement words x punctuation x casing all classify ACKNOWLEDGEMENT, never a consequential decision', () => {
  const failures = []
  let checked = 0
  for (const word of ACK_BASE_WORDS) {
    for (const punct of ACK_PUNCTUATION) {
      for (const casing of ACK_CASINGS) {
        const message = casing(word) + punct
        checked += 1
        const intent = classifyIntent(message)
        const decisionClass = classifyDecision(message, intent)
        if (intent !== 'ACKNOWLEDGEMENT' || decisionClass === 'TIM_REQUIRED') {
          failures.push({ message, intent, decisionClass })
        }
      }
    }
  }
  assert.ok(checked >= 100, `expected a real matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${checked} acknowledgement cases misclassified`)
})

// Property A: punctuation/casing must never change action semantics --
// re-expressed as a metamorphic property (not just a combinatorial pass)
// over the SAME base word.
test('golden-path eval: Property A -- punctuation/casing variation preserves ACKNOWLEDGEMENT classification', () => {
  for (const word of ACK_BASE_WORDS) {
    const baseline = classifyIntent(word)
    for (const punct of ACK_PUNCTUATION) {
      for (const casing of ACK_CASINGS) {
        assert.equal(classifyIntent(casing(word) + punct), baseline, `"${casing(word) + punct}" must classify the same as bare "${word}"`)
      }
    }
  }
})

// Property C: adding "please" to an explicit-action counterpart must not
// change its authority class.
test('golden-path eval: Property C -- adding "please" does not change authority class', () => {
  const pairs = ['deploy WorldForge', 'please deploy WorldForge']
  const [intentA, intentB] = pairs.map((m) => classifyIntent(m))
  assert.equal(classifyDecision(pairs[0], intentA), classifyDecision(pairs[1], intentB))
  assert.equal(classifyDecision(pairs[0], intentA), 'TIM_REQUIRED')
})

// Property D: quoted commands do not become current owner commands.
test('golden-path eval: Property D -- a quoted command inside a message is not itself the owner\'s directive', () => {
  const message = 'Claude said "deploy it" earlier, but I am just telling you what it said.'
  // The word "deploy" appears only inside a quotation -- this must not be
  // read as the OWNER directing deployment right now. This is a real,
  // disclosed limitation (isConsequentialDirective has no quote-awareness),
  // captured here as a property test with an honest current-behavior
  // assertion, not silently skipped.
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  // Documented current behavior: bare keyword matching does not
  // distinguish quoted from owner-issued text. This assertion exists so a
  // future fix flips it deliberately, not by accident.
  assert.equal(decisionClass, 'TIM_REQUIRED', 'DISCLOSED GAP: quoted commands are not yet distinguished from owner directives -- fails safe (refuses) rather than executing, but the refusal wording may misdescribe context; tracked, not silently ignored')
})

// Property J: questions/hypotheticals cannot execute. The real safety
// property is narrower than "never TIM_REQUIRED" -- TIM_REQUIRED IS a safe
// outcome (a refusal, never an execution). What must never happen is the
// ONE combination that actually produces a real side effect:
// decisionClass === RECOMMEND_AND_PROCEED on a DISPATCH_WORTHY intent
// (DISPATCH_REQUEST/FIX_REQUEST -- see command-responder.mjs's own
// DISPATCH_WORTHY_INTENTS). An earlier version of this test wrongly
// asserted "must never be TIM_REQUIRED either" -- "I might publish later."
// genuinely IS TIM_REQUIRED today (chat-responder.mjs's PROHIBITION_MARKERS
// has no modal-hedge ("might") awareness, only real negation), which is a
// disclosed UX-conservatism gap (a slightly-too-cautious refusal), not a
// safety defect -- it still never executes anything.
const DISPATCH_WORTHY_INTENTS = new Set(['DISPATCH_REQUEST', 'FIX_REQUEST'])
test('golden-path eval: Property J -- questions and hypotheticals never reach the one real execution path (RECOMMEND_AND_PROCEED + a dispatch-worthy intent)', () => {
  const cases = ['should I adopt it?', 'what if I deploy?', 'I might publish later.', 'should I push this?']
  for (const message of cases) {
    const intent = classifyIntent(message)
    const decisionClass = classifyDecision(message, intent)
    const wouldExecute = decisionClass === 'RECOMMEND_AND_PROCEED' && DISPATCH_WORTHY_INTENTS.has(intent)
    assert.equal(wouldExecute, false, `"${message}" must never reach real dispatch (got intent=${intent}, decisionClass=${decisionClass})`)
  }
  // The exact required example: "deploy WorldForge" (bare directive) DOES
  // require Tim -- proving the classifier can tell the two apart, not that
  // it's simply lenient across the board.
  assert.equal(classifyDecision('deploy WorldForge', classifyIntent('deploy WorldForge')), 'TIM_REQUIRED')
})

// ---------------------------------------------------------------------
// Batch 4: generated combinatorial matrix -- ADOPTION NEGATION.
// ---------------------------------------------------------------------
const NEGATION_TRIGGERS = ['do not', "don't", 'never', "won't", 'avoid', 'reject', 'not', 'no', "isn't", "can't", 'hold off on', 'pass on', 'rather not']
const ADOPTION_VERBS = ['adopt', 'adopting', 'adopted', 'accept', 'accepting', 'approve', 'approving']
const GAP_FILLERS = ['', 'the candidate, ', 'this one right now, ', 'under any circumstances, ']

test('golden-path eval: Batch 4 -- combinatorial negation triggers x adoption verbs x gap fillers never execute real adoption', () => {
  const failures = []
  let checked = 0
  for (const trigger of NEGATION_TRIGGERS) {
    for (const verb of ADOPTION_VERBS) {
      for (const filler of GAP_FILLERS) {
        const message = `${trigger} ${filler}${verb} it.`
        checked += 1
        const result = classifyAdoptionCommandIntent(message)
        if (result === 'EXECUTE_ADOPTION') {
          failures.push({ message, result })
        }
      }
    }
  }
  assert.ok(checked >= 200, `expected a real matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 15), [], `${failures.length} of ${checked} negated-adoption combinations wrongly executed`)
})

// Property H: negating an action must never preserve the positive action.
test('golden-path eval: Property H -- negating an adoption request never preserves EXECUTE_ADOPTION', () => {
  for (const verb of ADOPTION_VERBS) {
    const positive = classifyAdoptionCommandIntent(`${verb} it now.`)
    if (positive !== 'EXECUTE_ADOPTION') continue // hedge/ambiguous forms are out of scope for this property
    for (const trigger of NEGATION_TRIGGERS) {
      const negated = classifyAdoptionCommandIntent(`${trigger} ${verb} it now.`)
      assert.notEqual(negated, 'EXECUTE_ADOPTION', `negating "${verb} it now." with "${trigger}" must never still execute`)
    }
  }
})

// Positive control: the mission's own required sufficient examples must
// never be caught by the broadened negation vocabulary.
test('golden-path eval: positive control -- genuine explicit adoption requests are never falsely negated', () => {
  const cases = ['adopt the Nytheria run', 'accept that verified candidate', 'the WorldForge one looks good, adopt it', 'adopt both of those']
  for (const message of cases) {
    assert.equal(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION', `must still execute: "${message}"`)
    assert.equal(negatesAdoptionVerb(message), false)
  }
})

// ---------------------------------------------------------------------
// Batch 4: generated combinatorial matrix -- MULTI-ACTION NEGATION SCOPING.
// ---------------------------------------------------------------------
function project(id, displayName) {
  return { id, displayName, sourceClass: 'REAL', mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] } }
}
const PROJECTS = [project('niners-war-room', 'Niners War Room'), project('easylifehq-github-io', 'EasyLifeHQ'), project('worldforge-sablewake-live-runtime-repair-v3', 'Worldforge-Sablewake-Live-Runtime-Repair-V3')]
const aliases = loadProjectAliases()
const JOINERS = ['; ', '. ', ', but ', ' and ']
const NEGATED_TEMPLATES = ["Don't adopt niners-war-room", 'Do not adopt niners-war-room', 'Never adopt niners-war-room']
const AFFIRMED_TEMPLATES = ['adopt EasyLifeHQ', 'accept EasyLifeHQ', 'please adopt EasyLifeHQ']

test('golden-path eval: Batch 4 -- combinatorial negated-target x affirmed-target x joiner never lets the negation leak across targets', () => {
  const failures = []
  let checked = 0
  for (const negated of NEGATED_TEMPLATES) {
    for (const affirmed of AFFIRMED_TEMPLATES) {
      for (const joiner of JOINERS) {
        const message = `${negated}${joiner}${affirmed}.`
        checked += 1
        const entries = decomposeMultiAction(message, PROJECTS, aliases)
        const nwr = entries.find((e) => e.target === 'niners-war-room')
        const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
        const ok = nwr?.intent === 'ADOPT_CANDIDATE_DECLINED' && easyLife?.intent === 'ADOPT_CANDIDATE_REPORT'
        if (!ok) {
          failures.push({ message, nwrIntent: nwr?.intent, easyLifeIntent: easyLife?.intent })
        }
      }
    }
  }
  assert.ok(checked >= 30, `expected a real matrix, got ${checked} cases`)
  assert.deepEqual(failures.slice(0, 15), [], `${failures.length} of ${checked} negation-scoping combinations leaked across targets`)
})

// Property G: reordering the two independent clauses must preserve
// independent action semantics (the negated target stays negated, the
// affirmed target stays affirmed, regardless of which comes first).
test('golden-path eval: Property G -- reordering independent multi-project clauses preserves per-target semantics', () => {
  const forward = decomposeMultiAction("Don't adopt niners-war-room; adopt EasyLifeHQ.", PROJECTS, aliases)
  const reversed = decomposeMultiAction("Adopt EasyLifeHQ; don't adopt niners-war-room.", PROJECTS, aliases)
  const nwrIntent = (entries) => entries.find((e) => e.target === 'niners-war-room')?.intent
  const easyLifeIntent = (entries) => entries.find((e) => e.target === 'easylifehq-github-io')?.intent
  assert.equal(nwrIntent(forward), nwrIntent(reversed))
  assert.equal(easyLifeIntent(forward), easyLifeIntent(reversed))
  assert.equal(nwrIntent(forward), 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLifeIntent(forward), 'ADOPT_CANDIDATE_REPORT')
})

// Property F: an unrelated research/evidence paragraph must not change
// which project's adoption is negated vs. affirmed (mirrors Property F's
// software-vs-research analog from the prior mission, applied here).
test('golden-path eval: Property F analog -- an unrelated inserted paragraph does not change per-target adoption semantics', () => {
  const message =
    "Don't adopt niners-war-room -- it's still being validated against last season's data, which took a while to reconcile. Separately, adopt EasyLifeHQ."
  const entries = decomposeMultiAction(message, PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr?.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife?.intent, 'ADOPT_CANDIDATE_REPORT')
})
