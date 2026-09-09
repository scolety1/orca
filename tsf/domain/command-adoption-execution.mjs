// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: the
// first real, first-ever adoption-EXECUTION primitive triggered from chat,
// for genuine project work (never the fixture-only tsf/domain/adoption.mjs
// path, never self-improvement). Pure, real revalidation logic -- every
// check below is a composable, independently-reasoned refusal with a real,
// specific reason, never a vague "not eligible". All I/O (run lookup, hold
// lookup, git worktree/ancestry checks) is gathered by the server layer
// (server/command-adoption-execution.mjs) and passed in here as plain facts
// -- this module makes no filesystem/process call of its own.
//
// HARD BOUNDARY, structurally enforced (not just documented): this module
// NEVER imports, reads, or references TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION
// or OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1 in any way, and its
// eligibility check below refuses outright (WRONG_CANDIDATE_KIND) any
// candidateKind other than 'KEEP_GOING_RUN'. This new capability
// (EXPLICIT_OWNER_COMMAND_ADOPTION) and the existing, disabled-by-design
// AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION gate remain completely separate code
// paths with zero shared execution trigger.
export const COMMAND_ADOPTION_CANDIDATE_KINDS = Object.freeze(['KEEP_GOING_RUN'])

// Every ancestry classification the server layer's real
// `git merge-base --is-ancestor` check can honestly produce.
export const CANDIDATE_ANCESTRY_STATES = Object.freeze([
  'ALREADY_INCLUDED', // candidate SHA is an ancestor of (or equal to) canonical base HEAD -- honest no-op-but-record-a-receipt
  'FAST_FORWARD_AVAILABLE', // canonical base HEAD is an ancestor of candidate SHA -- a real merge is possible
  'DIVERGED', // neither is an ancestor of the other -- real refusal, never forced
  'UNKNOWN' // the real git probe itself failed -- honest refusal, never assumed safe
])

// Pure projection over run.waves (same real data Flight Recorder/
// resultCapsulesFromRun already read -- never a second, independently-
// drifting store). Part A's own dispatch-loop change threads `worktree`
// through each dispatch record into the settled wave's outcomes; this reads
// the MOST RECENT wave's outcomes and returns the single worktree every
// COMPLETED outcome in it agrees on, or null if the run has no waves, no
// COMPLETED outcomes, or the outcomes disagree (a genuinely ambiguous case
// -- honestly refused by the caller via worktreeResolved: false, never
// guessed).
export function resolveCandidateWorktreeFromRun(run) {
  if (!run || !Array.isArray(run.waves) || run.waves.length === 0) {
    return null
  }
  const lastWave = run.waves.at(-1)
  const outcomes = lastWave.waveResult?.outcomes
  if (!Array.isArray(outcomes)) {
    return null
  }
  const completedIds = new Set(
    outcomes.filter((o) => o.outcome === 'COMPLETED').map((o) => o.workItemId)
  )
  if (completedIds.size === 0) {
    return null
  }
  const outcomeWorktrees = new Set(
    outcomes.filter((o) => o.outcome === 'COMPLETED' && o.worktree).map((o) => o.worktree)
  )
  if (outcomeWorktrees.size > 0) {
    // A genuine disagreement among the newer, worktree-carrying outcomes
    // themselves is real ambiguity -- refused outright, never falls
    // through to the plan below to try to resolve it a different way.
    return outcomeWorktrees.size === 1 ? [...outcomeWorktrees][0] : null
  }
  // Real, disclosed gap: a run whose dispatch record predates this
  // program's own worktree-in-outcome tracking (e.g. a real Landing Page
  // run completed 2026-08-27, before that fix existed) never carries
  // `worktree` on its outcomes at all -- but the wave's own PLAN already
  // recorded, before dispatch, which worktree each work item was placed
  // in -- real, durable data written at plan time, not a guess made now.
  // Only trusted for work items already confirmed COMPLETED above (never
  // an item the plan merely intended but never actually finished), and
  // still refused on any disagreement.
  const planItems = (lastWave.wavePlan?.batches ?? []).flat()
  const planWorktrees = new Set(
    planItems.filter((item) => completedIds.has(item.id) && item.worktree).map((item) => item.worktree)
  )
  return planWorktrees.size === 1 ? [...planWorktrees][0] : null
}

// Revalidates a resolved adoption candidate against the project's CURRENT
// durable state (per-CLAUSE, real-time -- never a cached/stale snapshot).
// Returns { eligible: true, alreadyIncluded } or { eligible: false, reason, detail }.
export function revalidateCommandAdoptionCandidate({
  candidateKind,
  runExists,
  runState,
  candidateProjectId,
  targetProjectId,
  holdActive = false,
  holdDetail = null,
  worktreeResolved,
  worktreeClean,
  ancestry
}) {
  if (candidateKind !== 'KEEP_GOING_RUN') {
    return {
      eligible: false,
      reason: 'WRONG_CANDIDATE_KIND',
      detail: `this engine only ever adopts a real project-level Keep Going run candidate reaching READY_FOR_ADOPTION -- "${candidateKind}" is refused outright, never silently routed here (see the self-improvement adoption boundary this module structurally never crosses)`
    }
  }
  if (!runExists) {
    return {
      eligible: false,
      reason: 'CANDIDATE_NOT_FOUND',
      detail: 'no Keep Going run exists for this project any more -- the candidate this referred to is gone from current durable state'
    }
  }
  if (runState !== 'COMPLETE') {
    return {
      eligible: false,
      reason: 'NOT_READY_FOR_ADOPTION',
      detail: `the Keep Going run is not independently verified as ready (state: ${runState}, requires COMPLETE) -- refusing to adopt an unverified candidate`
    }
  }
  if (candidateProjectId !== targetProjectId) {
    return {
      eligible: false,
      reason: 'CROSS_PROJECT_CANDIDATE',
      detail: `the resolved candidate belongs to project "${candidateProjectId}", not the target project "${targetProjectId}" -- refusing to adopt across projects`
    }
  }
  if (holdActive) {
    return {
      eligible: false,
      reason: 'PROJECT_EXECUTION_HOLD_ACTIVE',
      detail: holdDetail ?? 'this project is under an active execution hold -- release it before adopting'
    }
  }
  if (!worktreeResolved) {
    return {
      eligible: false,
      reason: 'CANDIDATE_WORKTREE_UNRESOLVED',
      detail: 'no real worktree could be recovered for this run\'s settled work -- refusing to adopt without a real, inspectable candidate branch'
    }
  }
  if (!worktreeClean) {
    return {
      eligible: false,
      reason: 'CANDIDATE_WORKTREE_NOT_CLEAN',
      detail: 'the candidate worktree is not clean -- refusing to adopt uncommitted or unexpected state'
    }
  }
  if (ancestry === 'UNKNOWN') {
    return {
      eligible: false,
      reason: 'CANDIDATE_ANCESTRY_UNKNOWN',
      detail: 'the real ancestry check between the candidate and the canonical base could not be completed -- refusing to guess'
    }
  }
  if (ancestry === 'DIVERGED') {
    return {
      eligible: false,
      reason: 'CANDIDATE_DIVERGED_FROM_CANONICAL_BASE',
      detail: 'the candidate branch has diverged from the canonical base -- a fast-forward-only adoption is not possible; this is never forced or rebased'
    }
  }
  return { eligible: true, alreadyIncluded: ancestry === 'ALREADY_INCLUDED' }
}

// Narrow classifier for "does this message ask chat to actually EXECUTE an
// adoption, or just report/discuss one". Deliberately conservative -- fails
// closed to AMBIGUOUS/NOT_ADOPTION whenever genuinely unclear, per the
// mission's own required examples:
//   sufficient:     "adopt the Nytheria run", "accept that verified candidate",
//                    "the WorldForge one looks good, adopt it", "adopt both of those"
//   NOT sufficient:  "looks good", "continue", "what's ready?", "probably fine"
const ADOPTION_VERB_PATTERN = /\b(adopt(ed|ing|s)?|accept(ed|ing|s)?|approve[sd]?)\b/i
// Independent red-team finding (real, live-confirmed P0, this mission):
// "accept"/"approve" are common general-purpose English verbs -- "I accept
// your apology.", "approve the vacation request", "Please approve the PR
// for EasyLifeHQ." (a real, exact-matched project named alongside a
// completely unrelated "approve") all classified EXECUTE_ADOPTION, and the
// last one is confirmed reachable end-to-end to a real ffOnlyMerge whenever
// the named project happens to have a real, ready candidate. Bare "adopt"
// is NOT narrowed here -- it is a far more specific, deliberate word with
// negligible false-positive risk in practice, and every one of this file's
// own required sufficient examples that use "accept" ("accept that
// verified candidate", and the golden-path eval's own "accept EasyLifeHQ")
// still work unchanged.
//
// Independent adversarial-review finding (BLOCKING, same mission, caught
// before adoption): the first version of this fix used ONLY a curated
// denylist of known-bad objects (apology/request/offer/...) -- a denylist
// can never enumerate all of ordinary English, so "approve the budget for
// WorldForge", "accept the invoice for WorldForge", "approve the timeline
// for WorldForge" (a real, exact-matched project named alongside an
// UNLISTED unrelated noun) all still classified EXECUTE_ADOPTION and were
// confirmed to still reach a real ffOnlyMerge. Redesigned as an ALLOWLIST
// instead: accept/approve's own object must be either an explicit
// candidate-referring noun (candidate/run/mission/adoption, within a
// bounded word gap) OR a REAL, KNOWN project's own id/displayName as its
// immediate direct object (at most one intervening article) -- whenever
// the caller supplies real project context (both real production call
// sites now do: shouldRouteToAdoptionCommandBridge and
// respondAdoptionCommand). "approve the budget for WorldForge" is
// correctly excluded even though "WorldForge" appears in the message,
// because "WorldForge" is not the verb's own direct object ("the budget"
// is) -- the same distinction a human reads instantly but a denylist can
// never encode. When no project context is supplied at all (`projects`
// left `undefined` -- pure, project-agnostic classification calls, e.g.
// this file's own unit tests), falls back to the original curated-
// denylist check as the best available signal without knowing which
// tokens are real project names.
const ACCEPT_APPROVE_VERB_PATTERN = /\b(accept(ed|ing|s)?|approve[sd]?)\b/i
const NON_ADOPTION_ACCEPT_APPROVE_OBJECT =
  /\b(?:accept(?:ed|ing|s)?|approve[sd]?)\b(?:\s+(?:the|a|an|my|your|his|her|our|their|its))?(?:\s+\S+){0,2}?\s+(?:apolog(?:y|ies)|request|offer|invitation|proposal|terms|feedback|blame|responsibility|pr\b|pull request|resignation|application|excuse)/i
const ADOPTION_CANDIDATE_NOUN_SOURCE = 'candidate|run|mission|adoption'
const ARTICLE_SOURCE = 'the|a|an|my|your|his|her|our|their|its'

function escapeRegExpToken(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Object-recognition check for the allowlist redesign above. Operates on
// each real occurrence of accept/approve independently (a message can
// have more than one), checking only the text immediately following that
// occurrence -- never the whole message -- so "approve the budget for
// WorldForge" is judged on "the budget for WorldForge" (no direct-object
// match) even though "WorldForge" appears later in that same span.
function acceptApproveObjectIsRecognized(text, projects) {
  const verbMatches = [...text.matchAll(/\b(?:accept(?:ed|ing|s)?|approve[sd]?)\b/gi)]
  for (const vm of verbMatches) {
    const after = text.slice(vm.index + vm[0].length, vm.index + vm[0].length + 80)
    // Bounded word gap (0-2 filler words) before a candidate-referring
    // noun -- these are narrow, self-evident TSF vocabulary words, much
    // less likely to appear incidentally than an arbitrary project name
    // might, so a slightly looser gap here is safe.
    if (new RegExp(`^(?:\\s+(?:${ARTICLE_SOURCE}))?(?:\\s+\\S+){0,2}?\\s+(?:${ADOPTION_CANDIDATE_NOUN_SOURCE})\\b`, 'i').test(after)) {
      return true
    }
    if (!Array.isArray(projects)) {
      continue
    }
    // Strict direct-object adjacency (at most one intervening article) --
    // project names/ids are arbitrary proper nouns that could appear
    // anywhere in a longer sentence, so this stays tight specifically to
    // avoid the "for WorldForge" false-positive shape.
    for (const project of projects) {
      if (!project) {
        continue
      }
      for (const name of [project.id, project.displayName]) {
        if (typeof name === 'string' && name.trim() && new RegExp(`^(?:\\s+(?:${ARTICLE_SOURCE}))?\\s+${escapeRegExpToken(name.trim())}\\b`, 'i').test(after)) {
          return true
        }
      }
    }
  }
  return false
}
const HEDGE_PATTERN = /\b(maybe|perhaps|not sure|unsure|should i|should we|might|could we|possibly|i think|i guess|wonder(ing)?|what if)\b/i
const TRAILING_QUESTION_PATTERN = /\?\s*$/

// Golden-path-eval finding (Batch 4 combinatorial matrix -- Full
// Conversational Control Plane Exhaustive Gauntlet V1): domain/command-
// multi-action-decomposition.mjs's own ADOPT_CANDIDATE_REPORT pattern used
// a narrower, independently-drifted verb match (bare "adopt" only, missing
// "accept"/"approve") than THIS module's own ADOPTION_VERB_PATTERN --
// "accept EasyLifeHQ" fell through to GENERAL in the decomposer, so a
// message like "Don't adopt NWR; accept EasyLifeHQ." never cleared the
// multi-action gate and reproduced the exact negation-leak bug Batch 2
// fixed, just via "accept" instead of "adopt". Exported so that module
// reuses this exact vocabulary instead of a second, narrower one.
export function hasAdoptionVerb(text, projects) {
  const s = String(text ?? '')
  if (!ADOPTION_VERB_PATTERN.test(s)) {
    return false
  }
  // A bare "adopt" anywhere already qualifies regardless of accept/approve's
  // own object check below (they are independent signals, not one combined
  // gate) -- only accept/approve needs the narrower object check.
  if (/\badopt(ed|ing|s)?\b/i.test(s)) {
    return true
  }
  if (!ACCEPT_APPROVE_VERB_PATTERN.test(s) || NON_ADOPTION_ACCEPT_APPROVE_OBJECT.test(s)) {
    return false
  }
  if (projects === undefined) {
    // No real project context supplied -- the curated-denylist check just
    // above is the best available signal without knowing which tokens in
    // the message are real project names.
    return true
  }
  return acceptApproveObjectIsRecognized(s, projects)
}
// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1): "Do not adopt this candidate." used to classify
// EXECUTE_ADOPTION -- the negation word and the adoption verb both matched,
// but nothing checked whether the verb was actually NEGATED. This is the
// gate that triggers REAL adoption execution (executeCommandAdoption), so a
// false positive here is a real destructive-action risk, not a cosmetic
// wording bug. "never mind" is an idiom ("disregard that"), not a negation
// of whatever verb follows minutes later -- excluded the same way
// chat-responder.mjs's own IDIOMATIC_NON_NEGATION excludes "or not"/"no
// matter" from ITS negation check, so it can't itself become a false
// NOT_ADOPTION on a genuine "never mind, adopt it anyway" reversal.
// Independent red-team finding (Full Conversational Control Plane
// Exhaustive Gauntlet V1, one-hour continuation, RT-04): common hedge
// idioms using "no"/"not" false-positived to NOT_ADOPTION, silently
// blocking a legitimate request rather than executing it -- fails safe
// (under-acts, never wrongly adopts), but a real, confirmed usability gap.
// "no reason not to X" is a genuine double negative (meaning "you SHOULD
// X") -- not an attempt at general double-negative parsing, just one more
// named idiom alongside "never mind", matching this file's own established
// convention (extend the idiom list, not the negation-detection shape,
// when another such idiom is found).
const IDIOMATIC_NON_NEGATION = /\bnever\s+mind\b|\bno\s+rush\b|\bnot\s+gonna\s+lie\b|\bno\s+worries\b|\bno\s+reason\s+not\s+to\b/gi
// Adversarial-review finding (2nd pass): the first version of this pattern
// only recognized a hand-picked set of two-word negators within a tight
// 0-4 word gap of the verb -- real, live-reproducible refusals it missed
// entirely: bare "not" ("not ready to adopt yet", "we're not adopting
// this one"), "hold off on"/"pass on" (no negator word at all), and gaps
// wider than 4 words ("do not, under any circumstances right now, adopt
// this candidate"). Bare "not"/"no" is deliberately included here even
// though it's broad -- chat-responder.mjs's own PROHIBITION_MARKERS
// (hardened across 3 independent-verification rounds, BUG-08 in
// bug-ledger.json) already proves this exact tradeoff is the right one in
// this codebase for a consequential-action gate: broad-but-safe (refusing
// to execute) beats narrow-but-dangerous (a false EXECUTE_ADOPTION). The
// `(?!\s+sure\b)` exclusion keeps "not sure whether to adopt" correctly
// falling through to HEDGE_PATTERN's own AMBIGUOUS classification (an
// uncertainty marker, not a refusal) instead of being swallowed here --
// the one real collision between the broadened word list and this
// function's existing, already-tested HEDGE_PATTERN vocabulary.
// Character-bounded gap (not word-count-bounded): a word-count gap
// (`(?:\s+\S+){0,N}`) requires a literal space before every gap token,
// which breaks the moment punctuation sits directly against the negation
// word ("do not, under any circumstances... adopt" -- the comma right
// after "not" has no leading space). A plain bounded character span
// tolerates commas/extra whitespace/newlines the same way real typed
// English does.
//
// Fuzzing finding (Full Conversational Control Plane Exhaustive Gauntlet
// V1, Batch 5, MOST SEVERE finding this mission -- real, live-confirmed:
// classifyAdoptionCommandIntent(...) returned EXECUTE_ADOPTION, feeding
// executeCommandAdoption, a real branch-advancing operation): the negator
// list only spelled out don't/isn't/aren't/shouldn't/wouldn't/couldn't by
// hand and never generalized the "-n't" contraction family, so the equally
// common doesn't/didn't/hasn't/haven't/hadn't/wasn't/weren't/mustn't/
// mightn't/needn't/ain't forms were invisible to this pattern -- "I didn't
// want to adopt this candidate.", "We haven't decided to adopt this one.",
// "This project doesn't need to adopt that run.", and "She hasn't approved
// adopting this candidate." all wrongly classified EXECUTE_ADOPTION. Fixed
// by generalizing to every standard AUX+"n't" contraction instead of a
// hand-picked subset (can't/cannot stay listed separately -- "can" takes a
// single "n" before "'t", not the doubled "-n" every other auxiliary in
// this family takes, so it doesn't fit the shared pattern).
// Adversarial-review finding (BLOCKING, real, verified): the straight-quote-
// only "n'?t" reopened this exact P0 class for the most common real-world
// apostrophe of all -- the curly/"smart" quote (U+2019) every macOS/iOS/Word
// default autocorrect produces -- even for the ALREADY-covered base "don't"
// ("I don’t want to adopt this candidate." wrongly returned
// EXECUTE_ADOPTION). server/chat-responder.mjs's own PROHIBITION_MARKERS
// already tolerated both quote styles; this file and domain/command-multi-
// action-decomposition.mjs's copy did not, an asymmetry this batch's own
// stated goal ("one vocabulary" across all three checks) had missed. Also
// adds the archaic/dialectal "-n't" forms found in the same review pass
// (shan't = "sha"+"n't", not "shall"+"n't"; oughtn't; daren't; amn't).
const NOT_CONTRACTION_SOURCE =
  "(?:do|does|did|is|are|was|were|has|have|had|would|should|could|must|might|need|ai|sha|ought|dare|am)n['’]?t"
const ADOPTION_NEGATION_PATTERN = new RegExp(
  `\\b(?:do not|${NOT_CONTRACTION_SOURCE}|never|won['’]?t|refuse(?:d|s)?\\s+to|avoid|reject(?:ed|ing|s)?|rather not|hold off(?:\\s+on)?|pass on|not(?!\\s+sure\\b)|no|can['’]?t|cannot)\\b[\\s\\S]{0,60}?\\b(?:adopt|accept|approve)\\w*\\b`,
  'i'
)

// Exported so domain/command-multi-action-decomposition.mjs's own
// ADOPT_CANDIDATE_REPORT clause pattern can reuse this exact, hardened
// negation check rather than reinventing a second, independently-drifting
// one -- see that module's own header for why: a message like "Don't adopt
// NWR; adopt EasyLife" needs each CLAUSE judged on its own (this function
// is already clause-safe -- it operates on whatever text it's given, never
// assumes it's the whole message), not this module's own single-message-
// level classifyAdoptionCommandIntent (which has no concept of multiple
// targets/clauses at all and would wrongly negate the whole message).
export function negatesAdoptionVerb(text) {
  const withoutIdioms = String(text ?? '').replace(IDIOMATIC_NON_NEGATION, ' ')
  return ADOPTION_NEGATION_PATTERN.test(withoutIdioms)
}

export function classifyAdoptionCommandIntent(message, projects) {
  const text = String(message ?? '')
  if (!hasAdoptionVerb(text, projects)) {
    // No adoption verb at all -- "looks good"/"continue"/"what's ready?"/
    // "probably fine" all land here, honestly not this engine's concern.
    // Also lands here for accept/approve used in a confirmed-unrelated
    // sense (see hasAdoptionVerb's own NON_ADOPTION_ACCEPT_APPROVE_OBJECT
    // check) -- "I accept your apology." is not adoption language.
    return 'NOT_ADOPTION'
  }
  if (negatesAdoptionVerb(text)) {
    // A clearly negated adoption verb is not "ambiguous" -- the owner is
    // being perfectly clear that they do NOT want adoption executed.
    // Report-only, same as no adoption verb being present at all.
    return 'NOT_ADOPTION'
  }
  if (HEDGE_PATTERN.test(text) || TRAILING_QUESTION_PATTERN.test(text)) {
    return 'AMBIGUOUS'
  }
  return 'EXECUTE_ADOPTION'
}
