// TSF Control Plane -- Command Act Model V1 (CASE-31/CASE-32 structural
// repair, Full Conversational Control Plane Exhaustive Gauntlet V1).
//
// Locks in, PERMANENTLY, the exact CASE-31 (self-correction/quoted-
// reversal negation) and CASE-32 (decomposer target-bleed) regressions the
// owner's own directive specified verbatim, plus the 10 named properties
// (P1-P10) and a representative slice of the generalized combinatorial
// matrix (verbs x target-counts x joiners x polarity x exclusion x
// correction). See domain/command-act-model.mjs's own header for the
// design this proves.
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAdoptionCommandIntent, decomposeMultiActionFromActs } from '../domain/command-act-model.mjs'
import { decomposeMultiAction } from '../domain/command-multi-action-decomposition.mjs'

const A = { id: 'proj-a', displayName: 'A' }
const B = { id: 'proj-b', displayName: 'B' }
const C = { id: 'proj-c', displayName: 'C' }
const PROJECTS = [A, B, C]
const ALIASES = {}

function entriesFor(target, entries) {
  return entries.filter((e) => e.target === target)
}
function intentsFor(target, entries) {
  return new Set(entriesFor(target, entries).map((e) => e.intent))
}
function decompose(message) {
  return decomposeMultiActionFromActs(message, PROJECTS, ALIASES)
}

// ============================================================================
// CASE-31: self-correction / reversal / quoted-language negation semantics.
// Exact 11 owner-specified examples.
// ============================================================================

test('CASE-31 #1: "Adopt A -- actually, don\'t." => NO ADOPTION', () => {
  assert.equal(classifyAdoptionCommandIntent("Adopt A — actually, don't.", [A]), 'NOT_ADOPTION')
})

test('CASE-31 #2: "Don\'t adopt A -- actually, go ahead." => adoption (unambiguously bound to the pending act)', () => {
  assert.equal(classifyAdoptionCommandIntent("Don't adopt A — actually, go ahead.", [A]), 'EXECUTE_ADOPTION')
})

test('CASE-31 #3: quoted-then-retracted -- "I said \'adopt A\' earlier, but don\'t do that." => NO ADOPTION', () => {
  assert.equal(classifyAdoptionCommandIntent("I said 'adopt A' earlier, but don't do that.", [A]), 'NOT_ADOPTION')
})

test('CASE-31 #4: "Don\'t adopt A; actually adopt B." => A NO / B YES (real decomposer targets)', () => {
  const entries = decompose("Don't adopt A; actually adopt B.")
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('CASE-31 #5: quoted assistant text grants no authority -- "Claude said \'adopt A\', but I don\'t want that." => NO ADOPTION', () => {
  assert.equal(classifyAdoptionCommandIntent("Claude said 'adopt A', but I don't want that.", [A]), 'NOT_ADOPTION')
})

test('CASE-31 #6: retracted hypothetical -- "I was going to say adopt it, but never mind." => NO ADOPTION', () => {
  assert.equal(classifyAdoptionCommandIntent('I was going to say adopt it, but never mind.', [A]), 'NOT_ADOPTION')
})

// CASE-31 #7 ("Not that one -- adopt the other one.") is explicitly scoped
// OUT of this module -- it belongs to domain/command-referent-resolution.mjs's
// own EXCLUDE_INTENT_PATTERN + prior-turn-item resolution (see the CASE-31/
// 32 design report's own cross-case determination). Not duplicated here.

test('CASE-31 #8: "Don\'t not adopt it." => never wrongly EXECUTE_ADOPTION (double-negation fail-safe)', () => {
  assert.notEqual(classifyAdoptionCommandIntent("Don't not adopt it.", [A]), 'EXECUTE_ADOPTION')
})

test('CASE-31 #9: "I don\'t think we shouldn\'t adopt it." => no consequential action (ambiguous double-negative)', () => {
  const result = classifyAdoptionCommandIntent("I don't think we shouldn't adopt it.", [A])
  assert.notEqual(result, 'EXECUTE_ADOPTION')
})

test('CASE-31 #10: "Hold off on adopting A; B is fine." => A not adopted, praise alone is not adoption for B', () => {
  assert.equal(classifyAdoptionCommandIntent('Hold off on adopting A; B is fine.', [A]), 'NOT_ADOPTION')
  const entries = decompose('Hold off on adopting A; B is fine.')
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('CASE-31 #11: "Don\'t adopt A yet, but adopt B." => A no / B yes', () => {
  const entries = decompose("Don't adopt A yet, but adopt B.")
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

// ============================================================================
// CASE-32: clause/comma/multi-action decomposer boundary semantics.
// Exact 18 owner-specified examples (the message text is identical for
// several -- one test group each).
// ============================================================================

for (const message of ['Pause A, adopt B.', 'Pause A, and adopt B.', 'Pause A but adopt B.', 'Pause A; adopt B.', 'Pause A. Adopt B.', 'Pause A, then adopt B.']) {
  test(`CASE-32: "${message}" => A pause only / B adopt only, never bled`, () => {
    const entries = decompose(message)
    assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false, 'PAUSE must never bleed ADOPT onto A')
    assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true, 'B must still get its own real adopt')
  })
}

test('CASE-32: "Pause A, B, and C." => a bare target list shares ONE act, never invents cross-target adoption', () => {
  const entries = decompose('Pause A, B, and C.')
  assert.equal(new Set(entries.map((e) => e.target)).size, 3, 'every named target resolves')
  assert.equal(entries.some((e) => e.intent.startsWith('ADOPT')), false)
})

test('CASE-32: "Adopt A, not B." => A yes / B explicitly excluded', () => {
  const entries = decompose('Adopt A, not B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('CASE-32: "Don\'t adopt A, adopt B." => A no / B yes', () => {
  const entries = decompose("Don't adopt A, adopt B.")
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('CASE-32: "Keep A running, B paused." => no action bleed', () => {
  const entries = decompose('Keep A running, B paused.')
  assert.equal(entries.some((e) => e.intent.startsWith('ADOPT')), false)
  assert.equal(entries.some((e) => e.intent === 'START_KEEP_GOING'), false, '"keep...running" is not the "keep going" trigger')
})

test('CASE-32: "Pause A, unless B finishes." => no invented conditional scheduling, no bleed', () => {
  const entries = decompose('Pause A, unless B finishes.')
  assert.equal(entries.some((e) => e.intent.startsWith('ADOPT')), false)
})

test('CASE-32: "Adopt A, if it is still verified." => adoption request still parses; execution-time revalidation is unaffected/out of scope here', () => {
  const entries = decompose('Adopt A, if it is still verified.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('CASE-32: "Pause A, then adopt B." => A pause / B adopt', () => {
  const entries = decompose('Pause A, then adopt B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('CASE-32: "Pause A, adopt B, leave C alone." => A pause, B adopt, C protected -- ABSOLUTELY NO ADOPT C', () => {
  const entries = decompose('Pause A, adopt B, leave C alone.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-c', entries).has('ADOPT_CANDIDATE_REPORT'), false, 'ABSOLUTELY NO ADOPT C')
  assert.equal(intentsFor('proj-c', entries).has('EXTERNAL_WORK_HOLD'), true)
})

test('CASE-32: "Adopt everything except B." => B excluded', () => {
  const entries = decompose('Adopt everything except B.')
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('CASE-32: "Adopt A, except B." => A yes / B excluded', () => {
  const entries = decompose('Adopt A, except B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('CASE-32: "Adopt A, however B needs more review." => A adopt only / B no adoption', () => {
  const entries = decompose('Adopt A, however B needs more review.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('CASE-32: "Adopt A, also B needs serious work." => A adopt, B assessment only (no adoption B)', () => {
  const entries = decompose('Adopt A, also B needs serious work.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ASSESS_AND_UPGRADE'), true)
})

test('CASE-32: "Adopt A while B gets ready." => A adopt only / B no adoption', () => {
  const entries = decompose('Adopt A while B gets ready.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

// ============================================================================
// P11 (systemic, not in the original named list): the REAL execution-time
// safety net. Independent-review finding (BLOCKING, round 3, the most
// severe finding across all review rounds): every prior test in this file
// checked only decomposeMultiActionFromActs' OWN `intent` field --
// nothing ever verified that server/command-multi-action-bridge.mjs's
// executeAdoptionCandidate, which hands ONLY `rawClause` to its own
// independent execution-time re-derivation
// (classifyAdoptionCommandIntent(rawClause, [project]) -- invariant 7's
// own "existing execution-time revalidation remains authoritative and
// must not be weakened"), actually AGREES. "Don't adopt A, adopt B."
// passed every test in this file for months of this mission's own work
// while A's real rawClause was silently truncated to "adopt A, " (losing
// "Don't"), so the real re-derivation reclassified EXECUTE_ADOPTION and
// would have reached a genuine git merge for an explicitly declined
// target -- see test/command-act-model-live-execution-proof.test.mjs's
// own dedicated real-git-repo proof of this exact fix. This property
// closes the gap generally: for EVERY message this file already tests,
// re-derive on every ADOPT_CANDIDATE_DECLINED entry's own rawClause and
// require the real gate to agree it is never EXECUTE_ADOPTION.
// ============================================================================

test('P11: the real execution-time re-derivation (classifyAdoptionCommandIntent on rawClause, exactly as executeAdoptionCandidate calls it) agrees with every ADOPT_CANDIDATE_DECLINED entry this file produces, across every multi-target message tested above', () => {
  const projectsById = new Map([A, B, C].map((p) => [p.id, p]))
  const messages = [
    "Don't adopt A; actually adopt B.",
    "Don't adopt A yet, but adopt B.",
    "Don't adopt A, adopt B.",
    'Adopt A and B, not B.',
    'Adopt A, B, C, and D, except B and C.',
    'Adopt A and B, not B, hold off on adopting C, pause D.',
    'A is fine, B needs serious work, hold off on adopting B.',
    'Pause A, hold off on adopting B.'
  ]
  const D = { id: 'proj-d', displayName: 'D' }
  projectsById.set('proj-d', D)
  let checked = 0
  for (const message of messages) {
    const entries = decomposeMultiActionFromActs(message, [A, B, C, D], ALIASES)
    for (const entry of entries.filter((e) => e.intent === 'ADOPT_CANDIDATE_DECLINED')) {
      const project = projectsById.get(entry.target)
      const recheck = classifyAdoptionCommandIntent(entry.rawClause, [project])
      assert.notEqual(recheck, 'EXECUTE_ADOPTION', `${message} -- target ${entry.target}, rawClause=${JSON.stringify(entry.rawClause)}`)
      checked++
    }
  }
  assert.ok(checked >= 6, `expected to have actually re-derived several real DECLINED entries, only checked ${checked}`)
})

// ============================================================================
// Named properties P1-P10 (property/metamorphic tests).
// ============================================================================

test('P1: punctuation alone cannot bleed -- a hard boundary between two targets never merges their acts', () => {
  const entries = decompose('Pause A. Adopt B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('P2: an unrelated target cannot inherit a consequential verb it was never paired with', () => {
  const entries = decompose('Adopt A, however B needs more review.')
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('P3: an excluded target never receives the excluded action, under either exclusion phrasing', () => {
  for (const message of ['Adopt A, not B.', 'Adopt A, except B.', 'Adopt A, excluding B.', 'Adopt A, other than B.']) {
    const entries = decompose(message)
    assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false, message)
  }
})

test('P4: quoted/reported text cannot grant authority', () => {
  assert.equal(classifyAdoptionCommandIntent('"adopt A" was the old plan.', [A]), 'NOT_ADOPTION')
  assert.equal(classifyAdoptionCommandIntent('I said adopt A.'.replace('adopt A', "'adopt A'"), [A]), 'NOT_ADOPTION')
})

test('P5: a later NEGATIVE current-owner act cancels an earlier POSITIVE one for the same act', () => {
  assert.equal(classifyAdoptionCommandIntent("Adopt A — actually, don't.", [A]), 'NOT_ADOPTION')
})

test('P6: a later POSITIVE current-owner act may supersede an earlier NEGATIVE one only when explicitly bound', () => {
  assert.equal(classifyAdoptionCommandIntent("Don't adopt A — actually, go ahead.", [A]), 'EXECUTE_ADOPTION')
})

test('P7: reordering a target list preserves semantics', () => {
  const forward = decompose('Pause A, adopt B.')
  const reversed = decompose('Adopt B, pause A.')
  assert.equal(intentsFor('proj-b', forward).has('ADOPT_CANDIDATE_REPORT'), intentsFor('proj-b', reversed).has('ADOPT_CANDIDATE_REPORT'))
  assert.equal(intentsFor('proj-a', forward).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-a', reversed).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('P8: praise does not add adoption', () => {
  const entries = decompose('B is fine.')
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('P9: "please" does not alter scope or authority', () => {
  const entries = decompose('Please adopt A, not B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test("P10: an unrelated second project's clause cannot change the first project's own action", () => {
  const entries = decompose('Adopt A. B needs serious work.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ASSESS_AND_UPGRADE'), true)
})

// ============================================================================
// Representative slice of the generalized combinatorial matrix (verbs x
// target-counts x joiners x polarity x exclusion x provenance x
// correction) -- not exhaustive (the full space is combinatorially large),
// but exercises at least one real case per axis beyond the named examples
// above.
// ============================================================================

test('matrix: 4+ targets in one bare list share ONE act', () => {
  const D = { id: 'proj-d', displayName: 'D' }
  const entries = decomposeMultiActionFromActs('Adopt A, B, C, and D.', [A, B, C, D], ALIASES)
  for (const id of ['proj-a', 'proj-b', 'proj-c', 'proj-d']) {
    assert.equal(intentsFor(id, entries).has('ADOPT_CANDIDATE_REPORT'), true, id)
  }
})

test('matrix: "hold off on adopting A" carries BOTH EXTERNAL_WORK_HOLD and ADOPT_CANDIDATE_DECLINED for the same target', () => {
  const entries = decompose('Hold off on adopting A.')
  assert.equal(intentsFor('proj-a', entries).has('EXTERNAL_WORK_HOLD'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('matrix: accept/approve verbs participate in the same boundary/target-scoping as bare adopt', () => {
  const entries = decompose('Pause A, approve the candidate for B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('matrix: research/fix/cancel verbs are boundary-scoped without bleeding onto a co-mentioned target (disclosed gap, mapped to GENERAL)', () => {
  const entries = decompose('Research a gap in A. Fix B.')
  assert.equal(entries.some((e) => e.intent.startsWith('ADOPT')), false)
  assert.equal(intentsFor('proj-a', entries).size > 0, true)
  assert.equal(intentsFor('proj-b', entries).size > 0, true)
})

// ============================================================================
// Independent adversarial review findings (same mission, post-first-
// implementation review) -- real, live-confirmed BLOCKING/SHOULD-FIX bugs
// a fresh reviewer who did not implement this found, all traced to a
// single root cause (projectMentionsWithPositions only found the FIRST
// occurrence of each project per segment) plus one separate provenance
// gap and one correction-binding gap. Fixed and locked in permanently.
// ============================================================================

test('REVIEW FINDING 1: exclusion after an earlier positive re-mention of the same target -- "Adopt A and B, not B." => B excluded, not adopted', () => {
  const entries = decompose('Adopt A and B, not B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('REVIEW FINDING 1b: a multi-target exclusion clause excludes EVERY named target, not just the first -- "Adopt A, B, C, and D, except B and C."', () => {
  const D = { id: 'proj-d', displayName: 'D' }
  const entries = decomposeMultiActionFromActs('Adopt A, B, C, and D, except B and C.', [A, B, C, D], ALIASES)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-d', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-c', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('REVIEW FINDING 2: a project id that is a strict substring-prefix of another project\'s id never bleeds -- "foo-other needs serious work, adopt foo."', () => {
  const foo = { id: 'foo', displayName: 'Foo' }
  const fooOther = { id: 'foo-other', displayName: 'Foo-Other' }
  const entries = decomposeMultiActionFromActs('foo-other needs serious work, adopt foo.', [foo, fooOther], ALIASES)
  assert.equal(intentsFor('foo', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('foo-other', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('foo-other', entries).has('ASSESS_AND_UPGRADE'), true, 'the longer, more specific id must win the match, not bleed onto the shorter one')
})

test('REVIEW FINDING 3: quoted text in "target-then-verb" word order still grants no authority -- \'"A, adopt it right now" is what the old draft said.\'', () => {
  const entries = decompose('"A, adopt it right now" is what the old draft said. B needs serious work.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  const aEntry = entriesFor('proj-a', entries)[0]
  if (aEntry) {
    assert.notEqual(classifyAdoptionCommandIntent(aEntry.rawClause, [A]), 'EXECUTE_ADOPTION')
  }
})

test('REVIEW FINDING 3b: reported speech (no quote marks) in "target-then-verb" order still grants no authority', () => {
  const entries = decompose('I said A should be adopted immediately, but ignore that. Adopt B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

test('REVIEW FINDING 4: a correction marker never silently binds to an unrelated intervening act across a hard segment boundary', () => {
  const entries = decompose("Don't adopt A. Pause B. Actually go ahead.")
  // Fail-safe: A must never end up positively adopted via a cross-segment
  // bind to an unrelated act -- staying declined (the correction finding
  // no in-bounds target to amend) is the correct, safe outcome.
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('REVIEW FINDING 4b: a bare affirmation must not silently flip an unrelated, cross-segment target\'s own separate decline into a positive adoption', () => {
  // Stronger repro than 4 above: both A and B are independently declined;
  // an unbounded "nearest preceding act by raw position" search would
  // wrongly bind "actually go ahead" to B (the nearest one) and flip it
  // positive, even though B's own decline has nothing to do with A's.
  const entries = decompose("Don't adopt A. Don't adopt B. Actually go ahead.")
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

test('REVIEW FINDING 4 control: same-segment correction still works correctly (unaffected by the segment-bound fix)', () => {
  assert.equal(classifyAdoptionCommandIntent("Don't adopt A -- actually, go ahead.", [A]), 'EXECUTE_ADOPTION')
})

// ============================================================================
// Independent adversarial review, ROUND 2 (same mission -- a fresh
// reviewer re-probing the round-1 fixes themselves for fix-induced
// regressions found two more real BLOCKING bugs, both the same root
// cause: the round-1 "only the last anchor claims a non-first mention"
// restriction was too strict for a genuine contiguous compound verb
// phrase, and independent (unclaimed) mentions were being wrongly merged
// into one shared null-group zone).
// ============================================================================

test('REVIEW ROUND 2, FINDING 1: an unrelated PRECEDING null-group mention never inherits a LATER, unrelated mention\'s own compound verb phrase', () => {
  const entries = decompose('A is fine, B needs serious work, hold off on adopting B.')
  assert.equal(intentsFor('proj-a', entries).has('EXTERNAL_WORK_HOLD'), false)
  assert.equal(intentsFor('proj-a', entries).has('ASSESS_AND_UPGRADE'), false)
  assert.equal(intentsFor('proj-b', entries).has('ASSESS_AND_UPGRADE'), true)
  assert.equal(intentsFor('proj-b', entries).has('EXTERNAL_WORK_HOLD'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
})

test('REVIEW ROUND 2, FINDING 2: a genuine contiguous compound verb phrase for a NON-first mention keeps BOTH its verbs -- "Pause A, hold off on adopting B."', () => {
  const entries = decompose('Pause A, hold off on adopting B.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('EXTERNAL_WORK_HOLD'), true, 'EXTERNAL_WORK_HOLD must not be silently dropped')
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
})

test('REVIEW ROUND 2, FINDING 2 (3-target variant): compound phrase + exclusion together, none of the three targets bleed into each other', () => {
  const D = { id: 'proj-d', displayName: 'D' }
  const entries = decomposeMultiActionFromActs('Pause A, adopt B, hold off on adopting C, not D.', [A, B, C, D], ALIASES)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-c', entries).has('EXTERNAL_WORK_HOLD'), true)
  assert.equal(intentsFor('proj-c', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-d', entries).has('ADOPT_CANDIDATE_REPORT'), false, 'D is explicitly excluded from C\'s own adopt act, not a separate target of anything')
})

// Review round 2, FINDING 3 (MINOR, disclosed, NOT fixed this batch): a
// bare-comma list continuation can still absorb an unrelated LATER
// clause's own target when nothing but a comma separates it from an
// already-active bare-verb list ("Adopt A, pause B, C needs serious
// work." -- C wrongly joins B's PAUSE list instead of getting its own
// ASSESS_AND_UPGRADE from "C needs serious work"). Pre-existing
// BARE_LIST_JOINER_RE design (not introduced by round 1 or round 2's
// fixes -- confirmed via the independent reviewer's own root-cause
// isolation), safe in consequence today (PAUSE maps to the disclosed
// no-op GENERAL intent, so this is an information-loss/false-decline gap,
// never a wrongful dispatch/adoption/hold) but a real, known limitation.
// Pinned here as the CURRENT (imperfect but safe) behavior so a future
// batch's fix has a locked baseline to improve from, not a silent
// regression risk.
test('KNOWN DISCLOSED GAP (not fixed this batch, safe consequence): a bare-comma list continuation can absorb an unrelated later clause\'s own target -- pins current behavior', () => {
  const entries = decompose('Adopt A, pause B, C needs serious work.')
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  // Current (imperfect) behavior: C gets swept into GENERAL via the same
  // list as B, rather than its own ASSESS_AND_UPGRADE -- never anything
  // consequential (GENERAL only), so safe, just imprecise.
  assert.ok(intentsFor('proj-c', entries).size > 0, 'C must still resolve to SOME entry, never silently dropped')
  assert.equal(entries.some((e) => e.target === 'proj-c' && (e.intent === 'ADOPT_CANDIDATE_REPORT' || e.intent === 'EXTERNAL_WORK_HOLD')), false, 'never a consequential intent for C from this ambiguity')
})

// ============================================================================
// Self-caught, real, live-confirmed finding (adversarial self-review
// after independent review rounds 1-2, same mission, same broad root-
// cause family -- overlapping vocabulary between exclusion markers and
// negation triggers, both use the bare word "not").
// ============================================================================

test('SELF-REVIEW FINDING: an exclusion marker tied to an EARLIER target never leaks into a LATER, unrelated verb\'s own negation window', () => {
  const D = { id: 'proj-d', displayName: 'D' }
  const entries = decomposeMultiActionFromActs('Adopt A and B, not B, hold off on adopting C, pause D.', [A, B, C, D], ALIASES)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), true)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-c', entries).has('EXTERNAL_WORK_HOLD'), true, 'the exclusion marker for B must never negate C\'s own genuine hold request')
  assert.equal(intentsFor('proj-c', entries).has('MULTI_ACTION_DECLINED'), false)
  assert.equal(intentsFor('proj-d', entries).has('ADOPT_CANDIDATE_REPORT'), false)
})

// ============================================================================
// Independent-review finding (SHOULD-FIX, round 4, real, live-confirmed).
// ============================================================================

test('REVIEW ROUND 4: a correction marker\'s own amendment text is bounded by the SAME hard boundaries (but/however/while) as everything else -- "Adopt A, actually don\'t, but adopt B."', () => {
  const entries = decompose("Adopt A, actually don't, but adopt B.")
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_DECLINED'), true)
  assert.equal(intentsFor('proj-a', entries).has('ADOPT_CANDIDATE_REPORT'), false)
  assert.equal(intentsFor('proj-b', entries).has('ADOPT_CANDIDATE_REPORT'), true)
})

// ============================================================================
// Backward-compatibility spot check: the public decomposeMultiAction
// (domain/command-multi-action-decomposition.mjs) is now a thin adapter
// over this module -- confirm it still produces the same shape/behavior.
// ============================================================================

test('backward compatibility: decomposeMultiAction (the public re-export) matches decomposeMultiActionFromActs for the same input', () => {
  const message = "Pause A, adopt B, leave C alone."
  const viaPublic = decomposeMultiAction(message, PROJECTS, ALIASES)
  const viaDirect = decomposeMultiActionFromActs(message, PROJECTS, ALIASES)
  assert.deepEqual(viaPublic, viaDirect)
})
