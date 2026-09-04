// Resolves which real project(s) a free-text Command message refers to,
// against the actual project catalog -- never a fabricated/guessed list.
// Used when /api/chat is called with projectId: null (Command's global
// scope) to compute which project(s), if any, a message targets.
import { loadProjectAliases } from '../domain/project-aliases.mjs'

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Bounded, hand-rolled token-overlap scoring -- no new dependency, matching
// this codebase's own stated convention (see migration-context-attachments.ts's
// header) of not pulling in a library without explicit justification.
const FUZZY_CONFIDENCE_FLOOR = 0.6

// Command Authority repair: a project mention inside a clause the operator
// is explicitly EXCLUDING ("not tsf-orca", "don't touch NWR", "except
// niners-war-room") must never resolve as a target, however strongly it
// would otherwise match -- real requirement: authorization/targeting for one
// project must never leak to another the operator explicitly ruled out in
// the same message. Deliberately narrower than chat-responder.mjs's own
// PROHIBITION_MARKERS (which flags ANY negation word anywhere in a
// directive clause): a real regression caught here in this repair's own
// test suite is that a bare cue-anywhere-in-clause check misreads "why
// isn't tsf-orca working?" as excluding tsf-orca, when "isn't" describes
// STATE, not an instruction to leave it out. Exclusion is only real when the
// cue sits immediately before the project's own matched phrase.
//
// Adversarial-review finding: "never"/"won't"/"without" were missing (a real
// vocabulary gap vs. PROHIBITION_MARKERS) and are added here -- but
// "isn't"/"aren't"/"can't"/"couldn't"/"shouldn't"/"wouldn't" are
// deliberately NOT added, even proximity-anchored: "isn't tsf-orca" is
// exactly as adjacent in a genuine state question ("why isn't tsf-orca
// working?") as in a real exclusion ("this isn't tsf-orca, it's NWR"), so
// adding them back would reintroduce the exact false-positive this file's
// own regression suite already pins against. A disclosed, deliberate gap,
// not an oversight -- this codebase's own convention (see
// domain/self-repair-authority.mjs) is to leave an ambiguous case honestly
// unhandled rather than guess.
//
// Disclosed limit: this is a single-negation cue, not a parser -- a genuine
// double negative ("don't skip tsf-orca", meaning include it) reads as an
// exclusion instead. Erring toward excluding when the operator's own words
// are in tension is the deliberate, safe-default choice for an
// authorization surface (see the everExcluded handling below), not an
// attempt to correctly resolve arbitrary double negatives.
const EXCLUSION_PREFIX =
  "(?:not|never|won['’]t|without|except(?:\\s+for)?|excluding|other than|skip|leave out|don['’]t touch|do not touch|don['’]t include|do not include)"

function isExcludedNear(clause, literalText) {
  const pattern = new RegExp(
    `\\b${EXCLUSION_PREFIX}\\s+(?:the\\s+)?${escapeRegExp(literalText.toLowerCase())}\\b`,
    'i'
  )
  return pattern.test(clause.toLowerCase())
}

// Fuzzy matches have no single literal phrase to anchor an exclusion check
// near (they're a token-overlap score, not one matched substring), so this
// stays a broader whole-clause check -- acceptable here since a fuzzy match
// is already never trusted enough to dispatch on (command-responder.mjs
// gates real dispatch to exact/alias matches only); this only affects
// informational answers. Built directly from EXCLUSION_PREFIX rather than a
// second, separately-maintained word list -- adversarial-review finding:
// an earlier version of this list omitted "don't touch"/"do not touch"/
// "don't include"/"do not include" (present in EXCLUSION_PREFIX above), so
// "don't touch tsf-orca" excluded tsf-orca from an exact match only to have
// it silently reappear as fuzzy noise from the very same clause -- the
// identical drift-between-two-lists failure mode already found once in this
// repair (chat-responder.mjs's PROHIBITION_MARKERS vs. this file's own
// exclusion vocabulary); a single source here closes it for these two.
//
// Adversarial-review finding (2nd pass): "without" has no proximity anchor
// here (unlike isExcludedNear's phrase-based check), so a hyphenated
// compound like "without-fail" -- \b matches on the hyphen boundary even
// though it has nothing to do with excluding anything -- wiped an entire
// clause's fuzzy tokens. Excluded from this whole-clause-only check
// specifically (it stays in EXCLUSION_PREFIX, where "without touching X" is
// safely proximity-anchored to X). A disclosed, narrower residual: any bare
// cue word here could in principle collide with a hyphenated compound the
// same way; "without" is the one demonstrated in practice.
const FUZZY_EXCLUSION_CUES = new RegExp(`\\b${EXCLUSION_PREFIX.replace('without|', '')}\\b`, 'i')

// Judged per-clause (comma/"but"/em-dash/sentence-boundary separated) rather
// than whole-message, for the same reason chat-responder.mjs's own directive
// negation is clause-scoped: "no rush, but fix niners-war-room, not
// tsf-orca" must not let an earlier, unrelated hedge suppress a real later
// target, and must let a later negation exclude only the project it
// actually names. Em-dash/double-hyphen normalization and a word-bounded
// "but" (adversarial-review finding: a literal " but " substring, and no
// em-dash handling at all, both diverged from chat-responder.mjs's own
// proven clause splitting for no real reason) match that file's convention.
function splitClauses(message) {
  return String(message)
    .replace(/--|—/g, '.')
    .split(/[.!?\n;]+|,|\bbut\b/i)
    .map((c) => c.trim())
    .filter(Boolean)
}

// Command Authority repair: generic infra/tooling phrasing that names "TSF"
// and "Orca" together as the SYSTEM being used ("use TSF/Orca to check
// status") token-overlaps the tsf-orca project's own displayName and used to
// fuzzy-match it as a real target. Narrow, explicitly-reproduced pattern
// (this file's own stated convention is never to guess broadly) -- it only
// ever suppresses tsf-orca's FUZZY path; a literal id/displayName mention of
// tsf-orca still resolves normally. Keyed off a small, explicit set rather
// than a single hardcoded id check (adversarial-review finding: the next
// project whose name collides with a common infra/tool term would otherwise
// need another copy-pasted special case) -- extend this set, not the
// matching logic, when a new collision is found.
const INFRA_MENTION_PATTERN =
  /\b(?:use|using|via|through|with|run(?:ning)?(?: it| this)?(?: in| on| through)?)\s+(?:the\s+)?tsf\W{0,3}(?:and\s+|\+\s*)?orca\b/i
const INFRA_SENSITIVE_PROJECT_IDS = new Set(['tsf-orca'])

// Command target-resolution blocker (live hands-on finding): "whats the
// current state of nytheria/worldforge" fuzzy-matched a real, unrelated
// project literally named "whats-the-func" -- two of that project's three
// name tokens ("whats", "the") are generic conversational scaffolding, not
// an actual mention of it, and cleared FUZZY_CONFIDENCE_FLOOR (2/3 = 0.667)
// purely because the operator's own QUESTION happened to contain those
// common words. These tokens must never be allowed to CONTRIBUTE to any
// project's fuzzy overlap score, on the message side -- stripped here, not
// from a project's own real nameTokens (a project's own name is never
// scaffolding, whatever words it happens to contain). A curated, disclosed
// list rather than real NLP/stopword-library dependency (this file's own
// stated convention, see FUZZY_CONFIDENCE_FLOOR's comment) -- deliberately
// broader than the minimum named set (what/whats/current/state/status/
// running/going/project/run/use/using/with/of/the) to cover the same class
// of conversational-question scaffolding word this bug's own phrasing used
// ("is"/"are"/"this"/"it"/etc.) without claiming to be exhaustive; extend
// this set, not the scoring logic, when a new generic-word collision is
// found. 's' alone is a tokenizer artifact of stripping the apostrophe from
// a contraction ("what's" -> "what","s") -- never a real distinguishing
// word on its own.
const CONVERSATIONAL_STOPWORDS = new Set([
  'what',
  'whats',
  's',
  'current',
  'state',
  'status',
  'running',
  'going',
  'project',
  'run',
  'use',
  'using',
  'with',
  'of',
  'the',
  'is',
  'are',
  'was',
  'were',
  'it',
  'this',
  'that',
  'right',
  'now',
  'please',
  'can',
  'could',
  'you',
  'tell',
  'me',
  'about',
  'doing',
  'done',
  'up',
  'on',
  'at',
  'to',
  'a',
  'an',
  'and',
  'or',
  'for'
])

export function resolveProjectsFromText(message, projects, options = {}) {
  const aliases = options.aliases ?? loadProjectAliases()
  const clauses = splitClauses(message)

  const exact = []
  const fuzzy = []

  for (const project of projects) {
    const idPattern = new RegExp(`\\b${escapeRegExp(project.id.toLowerCase())}\\b`)
    const namePattern = new RegExp(`\\b${escapeRegExp(project.displayName.toLowerCase())}\\b`)
    const nameTokens = tokenize(project.displayName)
    const aliasEntries = Object.entries(aliases)
      .filter(([, id]) => id === project.id)
      .map(([alias]) => ({ alias, pattern: new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i') }))
    const infraSensitive = INFRA_SENSITIVE_PROJECT_IDS.has(project.id)

    // Exact/alias: judged per-clause so an exclusion cue only ever anchors
    // to the specific clause that actually names the project (the proximity
    // anchor above), never a different, unrelated clause naming it too --
    // but adversarial-review finding (2nd pass): a match found in an
    // EARLIER, non-excluded clause must not survive a LATER clause
    // explicitly excluding the same project ("tsf-orca needs it done, but
    // actually don't touch tsf-orca, fix niners-war-room instead" still
    // targeted tsf-orca, since the excluded clause was simply skipped
    // rather than retracting the earlier match). Any real exclusion,
    // wherever it appears, wins over any match, wherever it appears --
    // the safe default for an authorization surface: when the operator's
    // words are genuinely in tension, err toward NOT targeting, never
    // toward targeting something they said to leave out.
    let best = null
    let everExcluded = false
    for (const clause of clauses) {
      const lowerClause = clause.toLowerCase()
      let clauseMatch = null
      let excluded = false

      if (idPattern.test(lowerClause)) {
        clauseMatch = { matchedOn: 'id', confidence: 1, matchedPhrase: project.id }
        excluded = isExcludedNear(clause, project.id)
      } else if (namePattern.test(lowerClause)) {
        clauseMatch = {
          matchedOn: 'displayName',
          confidence: 0.95,
          matchedPhrase: project.displayName
        }
        excluded = isExcludedNear(clause, project.displayName)
      } else {
        const aliasHit = aliasEntries.find((a) => a.pattern.test(clause))
        if (aliasHit) {
          clauseMatch = { matchedOn: 'alias', confidence: 1, matchedPhrase: aliasHit.alias }
          excluded = isExcludedNear(clause, aliasHit.alias)
        }
      }

      if (!clauseMatch) {
        continue
      }
      if (excluded) {
        everExcluded = true
        continue
      }
      if (!best || clauseMatch.confidence > best.confidence) {
        best = clauseMatch
      }
    }

    if (everExcluded) {
      continue
    }
    if (best) {
      exact.push({ project, ...best })
      continue
    }

    if (nameTokens.length === 0) {
      continue
    }

    // Fuzzy: token overlap unioned across every clause that isn't negated or
    // (for an infra-sensitive project) a pure infra-tooling mention --
    // adversarial-review finding: scoring this per-clause-only (matching
    // the exact/alias loop above) regressed real matches whose words are
    // naturally scattered across a comma-joined sentence, since each
    // clause's own ratio could fall below the floor even though the old
    // whole-message ratio cleared it. Restores that whole-message behavior
    // for the common (no negation) case while still letting a wholly
    // negated or pure-infra-phrasing clause contribute nothing -- and
    // (adversarial-review finding) the infra-mention check is now itself
    // per-clause, so an infra-tooling mention in one clause can no longer
    // suppress a genuine, unrelated mention of the same project in another.
    const contributingTokens = new Set()
    for (const clause of clauses) {
      if (FUZZY_EXCLUSION_CUES.test(clause)) {
        continue
      }
      if (infraSensitive && INFRA_MENTION_PATTERN.test(clause)) {
        continue
      }
      for (const token of tokenize(clause)) {
        // Generic conversational/status scaffolding (see
        // CONVERSATIONAL_STOPWORDS above) never counts toward ANY project's
        // fuzzy overlap -- only tokens that actually distinguish one
        // project's real name from ordinary question phrasing can.
        if (CONVERSATIONAL_STOPWORDS.has(token)) {
          continue
        }
        contributingTokens.add(token)
      }
    }
    const overlappingTokens = nameTokens.filter((t) => contributingTokens.has(t))
    const ratio = overlappingTokens.length / nameTokens.length
    if (overlappingTokens.length > 0 && ratio >= FUZZY_CONFIDENCE_FLOOR) {
      fuzzy.push({
        project,
        matchedOn: 'fuzzy',
        confidence: ratio,
        matchedPhrase: overlappingTokens.join(' ')
      })
    }
  }

  // Resolution contract: exact/alias always outranks fuzzy. Ambiguous only
  // when there's no exact signal at all and more than one fuzzy candidate.
  const ambiguous = exact.length === 0 && fuzzy.length > 1

  // Command target-resolution blocker fix: previously ANY fuzzy match rode
  // along in `matches` alongside a confident exact/alias match (only the
  // `ambiguous` flag above ever treated exact as authoritative) -- an
  // informational Command reply then reported status for the unrelated
  // fuzzy project too (the reproduced "whats-the-func" leak), and a caller
  // building `resolvedProjectIds` from the raw match list rendered it as a
  // real "Targeting" chip. Once ANY exact/alias signal exists anywhere in
  // the message, fuzzy is dropped entirely from what's returned as a real
  // match -- "only a tightly bounded fallback," never an unverified add-on
  // alongside a confident target. Preserved for diagnostics rather than
  // silently discarded, so a mis-resolution stays provable in tests/dev
  // tooling without cluttering the operator-facing response.
  const droppedFuzzy = exact.length > 0 ? fuzzy : []
  const matches = exact.length > 0 ? exact : [...exact, ...fuzzy]

  return {
    matches,
    ambiguous,
    candidateAlternatives: droppedFuzzy.map((m) => ({
      projectId: m.project.id,
      matchedOn: m.matchedOn,
      confidence: m.confidence,
      matchedPhrase: m.matchedPhrase
    }))
  }
}
