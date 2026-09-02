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
const EXCLUSION_PREFIX =
  "(?:not|except(?:\\s+for)?|excluding|other than|skip|leave out|don['’]t touch|do not touch|don['’]t include|do not include)"

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
// informational answers.
const FUZZY_EXCLUSION_CUES = /\b(?:not|except|excluding|other than|skip|leave out)\b/i

// Judged per-clause (comma/"but"/sentence-boundary separated) rather than
// whole-message, for the same reason chat-responder.mjs's own directive
// negation is clause-scoped: "no rush, but fix niners-war-room, not
// tsf-orca" must not let an earlier, unrelated hedge suppress a real later
// target, and must let a later negation exclude only the project it
// actually names.
function splitClauses(message) {
  return String(message)
    .split(/[.!?\n;]+|,| but /i)
    .map((c) => c.trim())
    .filter(Boolean)
}

// Command Authority repair: generic infra/tooling phrasing that names "TSF"
// and "Orca" together as the SYSTEM being used ("use TSF/Orca to check
// status") token-overlaps the tsf-orca project's own displayName and used to
// fuzzy-match it as a real target. Narrow, explicitly-reproduced pattern
// (this file's own stated convention is never to guess broadly) -- it only
// ever suppresses tsf-orca's FUZZY path; a literal id/displayName mention of
// tsf-orca still resolves normally.
const INFRA_MENTION_PATTERN =
  /\b(?:use|using|via|through|with|run(?:ning)?(?: it| this)?(?: in| on| through)?)\s+(?:the\s+)?tsf\W{0,3}(?:and\s+|\+\s*)?orca\b/i

export function resolveProjectsFromText(message, projects, options = {}) {
  const aliases = options.aliases ?? loadProjectAliases()
  const clauses = splitClauses(message)
  const infraMentionOnly = INFRA_MENTION_PATTERN.test(message)

  const exact = []
  const fuzzy = []

  for (const project of projects) {
    const idPattern = new RegExp(`\\b${escapeRegExp(project.id.toLowerCase())}\\b`)
    const namePattern = new RegExp(`\\b${escapeRegExp(project.displayName.toLowerCase())}\\b`)
    const nameTokens = tokenize(project.displayName)
    const aliasEntries = Object.entries(aliases)
      .filter(([, id]) => id === project.id)
      .map(([alias]) => ({ alias, pattern: new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i') }))

    let best = null
    for (const clause of clauses) {
      const lowerClause = clause.toLowerCase()
      let clauseMatch = null
      let excluded = false

      if (idPattern.test(lowerClause)) {
        clauseMatch = { matchedOn: 'id', confidence: 1 }
        excluded = isExcludedNear(clause, project.id)
      } else if (namePattern.test(lowerClause)) {
        clauseMatch = { matchedOn: 'displayName', confidence: 0.95 }
        excluded = isExcludedNear(clause, project.displayName)
      } else {
        const aliasHit = aliasEntries.find((a) => a.pattern.test(clause))
        if (aliasHit) {
          clauseMatch = { matchedOn: 'alias', confidence: 1 }
          excluded = isExcludedNear(clause, aliasHit.alias)
        } else if (nameTokens.length > 0 && !(project.id === 'tsf-orca' && infraMentionOnly)) {
          const clauseTokens = new Set(tokenize(clause))
          const overlap = nameTokens.filter((t) => clauseTokens.has(t)).length
          const ratio = overlap / nameTokens.length
          if (overlap > 0 && ratio >= FUZZY_CONFIDENCE_FLOOR) {
            clauseMatch = { matchedOn: 'fuzzy', confidence: ratio }
            excluded = FUZZY_EXCLUSION_CUES.test(clause)
          }
        }
      }

      if (!clauseMatch || excluded) {
        continue
      }
      if (!best || clauseMatch.confidence > best.confidence) {
        best = clauseMatch
      }
    }

    if (best) {
      ;(best.matchedOn === 'fuzzy' ? fuzzy : exact).push({ project, ...best })
    }
  }

  // Ambiguous only when there's no exact signal at all and more than one
  // fuzzy candidate -- an exact id/displayName/alias match is always
  // trusted, however much unrelated fuzzy noise exists alongside it.
  const ambiguous = exact.length === 0 && fuzzy.length > 1

  return { matches: [...exact, ...fuzzy], ambiguous }
}
