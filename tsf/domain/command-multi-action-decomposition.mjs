// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A3:
// decomposes ONE free-text Command message into an ordered list of real
// { target, intent, rawClause } actions across potentially several
// projects -- the genuinely new capability dispatchAndRespond
// (command-responder.mjs) does not have: that function applies the SAME
// action to N projects, this module recognizes DISTINCT actions naming
// DIFFERENT projects in one message ("leave NWR alone, adopt Nytheria and
// keep going, EasyLife needs work").
//
// Pure, domain-only (no server import, matching this codebase's own
// domain/server layering -- see project-name-resolver.mjs for the
// server-layer counterpart this module deliberately does NOT reuse: that
// module's exclusion-clause semantics ("except X") don't apply here, since
// "leave X alone" is expressed as a real EXTERNAL_WORK_HOLD intent targeting
// X, never a silent drop). Never invents an execution intent that doesn't
// exist -- ADOPT_CANDIDATE_REPORT only, never an "ADOPT_CANDIDATE_EXECUTE"
// (see chat-responder.mjs's own hard-coded, load-bearing "chat has no tools
// and can't act on adoption" refusal -- this module's whole intent taxonomy
// respects that architectural fact, not works around it).
import { loadProjectAliases } from './project-aliases.mjs'
import { negatesAdoptionVerb, hasAdoptionVerb } from './command-adoption-execution.mjs'

// Adversarial-review finding (Batch 3, BLOCKING, real dispatch confirmed
// end-to-end): unlike ADOPT_CANDIDATE_REPORT/DECLINED, START_KEEP_GOING and
// ASSESS_AND_UPGRADE had ZERO negation awareness at all -- "Don't keep
// going on niners-war-room; EasyLifeHQ needs serious work." classified
// "Don't keep going on niners-war-room" as a real, positive START_KEEP_GOING
// action (the bare "keep going" pattern doesn't care about "Don't" at all),
// which server/command-multi-action-bridge.mjs's handleEntry routes
// straight to dispatchAction -> planAndDispatchFromCommand -> a REAL new
// Keep Going mission dispatch. Nothing downstream catches this: the
// per-clause TIM_REQUIRED check (chat-responder.mjs's own classifyDecision
// on the rawClause) doesn't recognize "keep going"/"assess" as
// consequential at all, so it never fires either. This is the exact same
// negation-leak class already fixed for adoption, just with real DISPATCH
// as the consequence instead of a mis-worded report -- arguably more
// severe. Generalized here (not adoption-specific) since the negation
// vocabulary/bounded-gap design is identical regardless of which verb it
// guards.
// Fuzzing finding (Full Conversational Control Plane Exhaustive Gauntlet
// V1, Batch 5): the hand-picked negator list never generalized the
// "-n't" contraction family beyond don't/isn't/aren't/shouldn't/wouldn't/
// couldn't -- "niners-war-room doesn't need work." and "... didn't need
// work." both wrongly fired the real, positive ASSESS_AND_UPGRADE intent
// (a real planAndDispatchFromCommand dispatch via handleEntry), the exact
// opposite of what was said. Same root cause and fix as domain/command-
// adoption-execution.mjs's ADOPTION_NEGATION_PATTERN (found in the same
// fuzzing pass) -- see that file's own comment for why can't/cannot stay
// listed separately from the shared "-n't" family.
// Adversarial-review finding (BLOCKING, real, verified -- same review pass
// as domain/command-adoption-execution.mjs's own copy of this fix, see that
// file's header for the full repro/rationale): straight-quote-only "n'?t"
// reopened this exact P0 class for the curly/"smart" apostrophe (U+2019)
// every macOS/iOS/Word autocorrect produces by default, even for the
// already-covered base "don't". Also adds the archaic/dialectal forms
// (shan't/oughtn't/daren't/amn't) found in the same pass.
const NOT_CONTRACTION_SOURCE =
  "(?:do|does|did|is|are|was|were|has|have|had|would|should|could|must|might|need|ai|sha|ought|dare|am)n['’]?t"
const NEGATION_TRIGGER_SOURCE =
  `(?:do not|${NOT_CONTRACTION_SOURCE}|never|won['’]?t|refuse(?:d|s)?\\s+to|avoid|reject(?:ed|ing|s)?|rather not|hold off(?:\\s+on)?|pass on|not(?!\\s+sure\\b)|no|can['’]?t|cannot)`
const NEVER_MIND_IDIOM = /\bnever\s+mind\b/gi

// `verbSources`: an array of regex SOURCE strings (not compiled patterns)
// for the verb/phrase this action's own INTENT_PATTERNS entry already
// matches on -- checked independently so a negation bound to ONE verb
// shape (e.g. "keep going") doesn't require rebuilding a single giant
// combined regex per action.
function isVerbNegated(text, verbSources) {
  const withoutIdiom = String(text ?? '').replace(NEVER_MIND_IDIOM, ' ')
  return verbSources.some((verbSource) => new RegExp(`\\b${NEGATION_TRIGGER_SOURCE}\\b[\\s\\S]{0,60}?(?:${verbSource})`, 'i').test(withoutIdiom))
}

const KEEP_GOING_VERB_SOURCES = ['keep\\s+going', 'overnight']
const ASSESS_VERB_SOURCES = ['needs?\\s+(?:serious\\s+)?work', 'get\\s+.+?\\s+up', 'upgrade', 'assess']
// Red-team review finding (final pass): EXTERNAL_WORK_HOLD was the one
// remaining action-creating intent in this file with no negation
// awareness -- "Don't leave niners-war-room alone, keep working on it",
// "Don't hold off on niners-war-room", and "niners-war-room is NOT being
// handled by another AI" all wrongly created a real, durable
// createProjectExecutionHold record (via applyExternalWorkHold) for the
// exact opposite of what the owner said.
const EXTERNAL_HOLD_VERB_SOURCES = [
  '(?:is\\s+)?being\\s+handled\\s+by\\s+(?:another|a\\s+different)\\s+(?:ai|agent|process)',
  'leave\\s+(?:it|that|this|\\S+)\\s+alone',
  'hold\\s+off'
]

// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1, Batch 2): "Don't adopt NWR; adopt EasyLife."
// used to have BOTH clauses classify as the plain ADOPT_CANDIDATE_REPORT
// (the bare-word pattern below has no negation awareness of its own), so
// classifyMultiActionEntries' own gate (server/command-multi-action-
// bridge.mjs -- requires >=2 DISTINGUISHING intents, not just >=2 targets)
// never fired, and the WHOLE message fell through to the single-message-
// level classifyAdoptionCommandIntent check instead -- which correctly
// finds the negation, but has no concept of multiple targets/clauses, so
// it refused the ENTIRE message, wrongly suppressing EasyLife's completely
// separate, legitimate adoption request too. ADOPT_CANDIDATE_DECLINED is a
// real, distinct intent (not a duplicate label) precisely so the outer
// gate sees 2 genuinely different actions and routes through this
// module's own per-clause decomposition -- server/command-multi-action-
// bridge.mjs's executeAdoptionCandidate already independently re-derives
// NOT_ADOPTION vs EXECUTE_ADOPTION from each clause's own raw text via
// classifyAdoptionCommandIntent, so both ids are handled by the exact same
// safe, already-correct execution function; this only fixes the GATE that
// decides whether that per-clause logic ever runs.
export const MULTI_ACTION_INTENTS = Object.freeze([
  'EXTERNAL_WORK_HOLD',
  'ADOPT_CANDIDATE_REPORT',
  'ADOPT_CANDIDATE_DECLINED',
  'START_KEEP_GOING',
  'ASSESS_AND_UPGRADE',
  // A single shared id for a negated START_KEEP_GOING/ASSESS_AND_UPGRADE
  // clause (see the negation-awareness comment above) -- deliberately NOT
  // a per-action *_DECLINED variant like adoption's own: neither of these
  // two real actions has adoption's own independent, real-state-grounded
  // re-derivation function to route a declined variant through, so this
  // is routed to a single, generic, safe "no action taken" report instead
  // (server/command-multi-action-bridge.mjs's handleEntry).
  'MULTI_ACTION_DECLINED',
  'STATUS_QUERY',
  'GENERAL'
])

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Adversarial-review finding (Batch 2, 2nd pass): the original comma/"but"
// clause boundary reproduced the EXACT bug this batch fixed, via other
// realistic phrasing, in two distinct ways:
//
// (1) "Don't adopt A and adopt B." never split on "and" at all, so BOTH
// projects shared the identical clause text -- the negated verb applying
// to A bled into B's own classification too (both got ADOPT_CANDIDATE_
// DECLINED). Fixed by ALSO splitting on "and" -- but only when "and" is
// immediately followed by a known action verb (a lookahead, not a bare
// \band\b): "adopt A and B ready" / "adopt that run and keep going
// overnight" are genuine single-clause compounds (one verb, a shared
// object list, or two actions for the SAME already-established target) and
// must NOT split, or a legitimate shared/compound instruction loses one of
// its targets/intents entirely (this exact shape is the file's own literal
// mission-example fixture). "and adopt B" / "and keep going" (a NEW verb
// opening what reads as an independent clause) SHOULD split. The verb list
// below is this file's own known action vocabulary -- not general English.
//
// (2) "Do not, under any circumstances, adopt A, but adopt B." used to
// comma-split "Do not" away from "adopt A" into two separate clauses
// before either was attributed to a target -- "Do not" alone names no
// project, so it never even reached A's own accumulated segment text, and
// A's segment ("adopt niners-war-room" alone) read as unnegated. Fixed by
// no longer treating a bare comma as its own clause boundary at all --
// negatesAdoptionVerb's own bounded-character-gap design (domain/
// command-adoption-execution.mjs) already tolerates comma-punctuated
// negation WITHIN one clause; the bug was this module fragmenting the
// clause before that check ever ran, not the check itself. Every existing
// fixture's real target attribution is unaffected: every comma this file's
// own tests exercise separates two clauses about the SAME already-current
// target, never two DIFFERENT targets' own mentions.
// Golden-path-eval finding (Batch 4) + adversarial-review finding (Batch 3,
// 2nd pass): "and please adopt EasyLifeHQ" didn't split -- the lookahead
// required the verb IMMEDIATELY after "and", but a polite filler word
// ("please") commonly sits between them; the first fix tolerated exactly
// one filler word with a literal following space, still missing "and
// please, adopt X" (comma right after "please") and "and please just adopt
// X" (two filler words). Tolerates a bounded (0-2) repetition of known
// filler words, each followed by whitespace-or-comma-or-both -- still not
// arbitrary text, so "and X Y" (a shared object list, no filler, no known
// verb) still correctly does not split.
const AND_SPLIT_FILLER = '(?:(?:please|just|simply)[,\\s]+){0,2}'
const AND_SPLIT_VERB_LOOKAHEAD = `${AND_SPLIT_FILLER}(?:adopt|accept|approve|reject|fix|pause|hold|research|keep|assess|upgrade)\\w*\\b`
function splitClauses(message) {
  return String(message)
    .replace(/--|—/g, '.')
    .split(new RegExp(`[.!?\\n;]+|\\bbut\\b|\\band(?=\\s+${AND_SPLIT_VERB_LOOKAHEAD})`, 'i'))
    .map((c) => c.trim())
    .filter(Boolean)
}

// Finds every project (id, displayName, or a registered alias) named
// literally in this one clause -- exact/alias only, never fuzzy (mirrors
// this codebase's own "only a confident, exact signal is ever trusted to
// target something" convention). A clause can genuinely name more than one
// project ("get NWR and WorldForge ready").
function projectMentionsInClause(clause, projects, aliases) {
  const lower = clause.toLowerCase()
  const found = new Set()
  for (const project of projects) {
    const idPattern = new RegExp(`\\b${escapeRegExp(project.id.toLowerCase())}\\b`)
    const namePattern = new RegExp(`\\b${escapeRegExp(project.displayName.toLowerCase())}\\b`)
    if (idPattern.test(lower) || namePattern.test(lower)) {
      found.add(project.id)
      continue
    }
    const aliasHit = Object.entries(aliases).some(
      ([alias, canonicalId]) => canonicalId === project.id && new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(lower)
    )
    if (aliasHit) {
      found.add(project.id)
    }
  }
  return [...found]
}

// Groups the message's own clauses by which project they're really about --
// a clause naming no project inherits whichever project(s) the most recent
// clause that DID name one was about (ordinary prose doesn't repeat a
// project's name in every sentence: "Nytheria looks good, adopt that run
// and keep going overnight" -- the second clause has no project name at
// all). A clause naming a NEW, different project starts fresh; a clause
// re-naming the SAME current project just extends it (so "EasyLife needs
// work" + "get EasyWorkouts up" -- both resolving to the same real project
// via project-aliases.mjs -- combine into one segment, not two).
function segmentByProject(message, projects, aliases) {
  const order = []
  const textByProject = new Map()
  let currentTargets = []
  for (const clause of splitClauses(message)) {
    const mentioned = projectMentionsInClause(clause, projects, aliases)
    if (mentioned.length > 0) {
      currentTargets = mentioned
    }
    for (const projectId of currentTargets) {
      if (!textByProject.has(projectId)) {
        textByProject.set(projectId, [])
        order.push(projectId)
      }
      const clauses = textByProject.get(projectId)
      if (clauses.at(-1) !== clause) {
        clauses.push(clause)
      }
    }
  }
  return order.map((projectId) => ({ projectId, text: textByProject.get(projectId).join('. ') }))
}

// Ordered so a segment carrying more than one real action always reports
// them in a stable, sensible sequence (hold before anything else would
// never co-occur with a hold in practice, but ADOPT before START_KEEP_GOING
// matches the mission's own "adopt that run and keep going overnight"
// phrasing order).
const INTENT_PATTERNS = [
  {
    id: 'EXTERNAL_WORK_HOLD',
    test: (t) =>
      (/\b(is\s+)?being\s+handled\s+by\s+(another|a\s+different)\s+(ai|agent|process)\b/i.test(t) ||
        /\bleave\s+(it|that|this|\S+)\s+alone\b/i.test(t) ||
        /\bhold\s+off\b/i.test(t)) &&
      !isVerbNegated(t, EXTERNAL_HOLD_VERB_SOURCES)
  },
  // Split by negation (see the module-header comment above) -- reuses the
  // exact same hardened negation check AND the exact same verb vocabulary
  // (hasAdoptionVerb -- adopt/accept/approve, not just bare "adopt") the
  // single-message adoption classifier uses, so the two never drift apart
  // on what counts as an adoption verb or a negated one.
  { id: 'ADOPT_CANDIDATE_REPORT', test: (t) => hasAdoptionVerb(t) && !negatesAdoptionVerb(t) },
  { id: 'ADOPT_CANDIDATE_DECLINED', test: (t) => hasAdoptionVerb(t) && negatesAdoptionVerb(t) },
  {
    id: 'START_KEEP_GOING',
    test: (t) => (/\bkeep\s+going\b/i.test(t) || /\bovernight\b/i.test(t)) && !isVerbNegated(t, KEEP_GOING_VERB_SOURCES)
  },
  {
    id: 'ASSESS_AND_UPGRADE',
    test: (t) =>
      (/\bneeds?\s+(serious\s+)?work\b/i.test(t) || /\bget\s+.+?\s+up\b/i.test(t) || /\bupgrade\b/i.test(t) || /\bassess\b/i.test(t)) &&
      !isVerbNegated(t, ASSESS_VERB_SOURCES)
  },
  {
    id: 'MULTI_ACTION_DECLINED',
    test: (t) => {
      const hasKeepGoing = /\bkeep\s+going\b/i.test(t) || /\bovernight\b/i.test(t)
      const hasAssess = /\bneeds?\s+(serious\s+)?work\b/i.test(t) || /\bget\s+.+?\s+up\b/i.test(t) || /\bupgrade\b/i.test(t) || /\bassess\b/i.test(t)
      const hasHold =
        /\b(is\s+)?being\s+handled\s+by\s+(another|a\s+different)\s+(ai|agent|process)\b/i.test(t) ||
        /\bleave\s+(it|that|this|\S+)\s+alone\b/i.test(t) ||
        /\bhold\s+off\b/i.test(t)
      return (
        (hasKeepGoing && isVerbNegated(t, KEEP_GOING_VERB_SOURCES)) ||
        (hasAssess && isVerbNegated(t, ASSESS_VERB_SOURCES)) ||
        (hasHold && isVerbNegated(t, EXTERNAL_HOLD_VERB_SOURCES))
      )
    }
  },
  { id: 'STATUS_QUERY', test: (t) => /\bstatus\b/i.test(t) || /\bwhat'?s\s+(going\s+on|happening)\b/i.test(t) || /\bhow'?s\s+it\s+going\b/i.test(t) }
]

// One segment's combined text can genuinely carry more than one distinct
// action ("adopt that run and keep going overnight" = ADOPT_CANDIDATE_REPORT
// + START_KEEP_GOING) -- every pattern that matches contributes its own
// entry, never just the first. A segment matching none of the specific
// patterns still gets a real GENERAL entry (never silently dropped) so a
// resolved project is never left with zero record of what was said about it.
function intentsForSegmentText(text) {
  const matched = INTENT_PATTERNS.filter((p) => p.test(text)).map((p) => p.id)
  return matched.length > 0 ? matched : ['GENERAL']
}

// Real, tested entry point. `aliases` defaults to the real, durable alias
// table (project-aliases.mjs) -- a caller (test, or a future referent-
// resolution integration) can supply its own. Returns
// { target: projectId, intent, rawClause }[] in first-mention order;
// clauses naming no project at all (no target resolvable) are honestly
// dropped rather than emitting a fabricated null-target action.
export function decomposeMultiAction(message, projects, aliases = loadProjectAliases()) {
  const segments = segmentByProject(message, projects, aliases)
  const entries = []
  for (const segment of segments) {
    for (const intent of intentsForSegmentText(segment.text)) {
      entries.push({ target: segment.projectId, intent, rawClause: segment.text })
    }
  }
  return entries
}
