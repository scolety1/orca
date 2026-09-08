// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A2:
// resolves a natural-language referring phrase ("the stalled one", "the UI
// one", "those two", "the WorldForge one", "leave the NWR one alone")
// against the PRIOR turn's real, structured resultItems (AttentionItem[],
// or command-http-routes.mjs's own trimAttentionItem projection of it --
// see fleet-attention-status.mjs). Pure, read-only, domain-only (no server/
// store import) -- this module never fabricates a match: a phrase that
// doesn't clearly land on exactly the right subset of items is reported as
// ambiguous or not-found, never guessed, mirroring command-followup-
// context.mjs's own "which one do you mean?" honesty (that module just
// never had structured items to resolve against; this one does).
import { loadProjectAliases } from './project-aliases.mjs'

// Same convention as project-name-resolver.mjs's own tokenize -- splits on
// any non-alphanumeric run, so "TSF_ORCA"/"Worldforge-Sablewake-..." tokenize
// into their real distinguishing words instead of one opaque underscore/
// hyphen-joined blob a plain \b regex would treat as a single non-boundary
// token.
function tokenize(s) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// A referring phrase always needs SOMETHING to resolve against -- with no
// prior items at all, every phrase below is a real "nothing to resolve"
// case, not a false ambiguous/not-found.
function noPriorItems() {
  return { resolved: false, reason: 'NO_PRIOR_ITEMS' }
}

const BOTH_PATTERN = /\b(those two|both of those|both of them|\bboth\b)\b/i
const EXCLUDE_INTENT_PATTERN = /\b(leave|skip|except for|excluding|don'?t touch|do not touch)\b/i
const ALONE_MARKER_PATTERN = /\balone\b|\bout\b/i

// "the <descriptive phrase> one(s)" -- the descriptive phrase is what gets
// matched against each item's category/label/project.displayName below.
// Deliberately requires the literal word "one"/"ones" as the anchor (never
// a bare "the stalled" with no "one") -- narrow on purpose, matching this
// codebase's own "never guess broadly" convention (project-name-resolver.mjs).
const THE_X_ONE_PATTERN = /\bthe\s+(.+?)\s+one(s)?\b/i
const THE_N_X_ONES_PATTERN = /\bthe\s+(two|three|four|five|\d+)\s+(.+?)\s+ones\b/i

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5 }

function matchesStalled(item) {
  return (
    item.category === 'FAILED_REQUIRES_ATTENTION' ||
    /stall/i.test(item.reason ?? '') ||
    /stall/i.test(item.label ?? '')
  )
}

function matchesReadyForAdoption(item) {
  return item.category === 'READY_FOR_ADOPTION'
}

function matchesNeedsOwner(item) {
  return item.category === 'NEEDS_OWNER'
}

// Generic keyword match: the label, the project's displayName, or the
// project's id has the keyword as one of its real tokens -- covers "the UI
// one" (label "TSF UI Capability Check"), "the WorldForge one" (project
// displayName "Worldforge-Sablewake-Live-Runtime-Repair-V3"), and "the NWR
// one" (label "NWR") against the real, disclosed fixture shape this
// mission's own Part A2 names.
// A multi-word keyword phrase ("TSF UI") requires every one of its own
// words to appear among the haystack's tokens (AND, not substring) -- a
// single-word keyword ("UI", "WorldForge", "NWR") is just the length-1 case
// of the same rule.
function matchesKeyword(item, keyword) {
  const keywordTokens = tokenize(keyword)
  if (keywordTokens.length === 0) {
    return false
  }
  const haystackTokens = new Set([
    ...tokenize(item.label),
    ...tokenize(item.project?.displayName),
    ...tokenize(item.project?.id)
  ])
  return keywordTokens.every((t) => haystackTokens.has(t))
}

// A keyword may also be a known project alias ("nwr", "nytheria") whose
// canonical id doesn't literally appear in the item's own label/displayName
// text -- resolved the same way project-name-resolver.mjs resolves aliases
// for direct dispatch, just against the bounded item list instead of the
// live catalog.
function matchesAlias(item, keyword, aliases) {
  const canonicalId = aliases[keyword.toLowerCase().trim()]
  return !!canonicalId && item.project?.id === canonicalId
}

function itemsMatchingKeyword(items, keyword, aliases) {
  const byKeyword = items.filter((item) => matchesKeyword(item, keyword))
  if (byKeyword.length > 0) {
    return byKeyword
  }
  return items.filter((item) => matchesAlias(item, keyword, aliases))
}

// A leading "stalled" keyword takes the dedicated semantic matcher (more
// reliable than a literal substring: a stalled item's label rarely
// literally contains the word "stalled"); "ready"/"ready for adoption" and
// "needs you"/"needs owner" get the same treatment for the same reason.
// Anything else falls to the generic label/displayName/alias keyword match.
function resolveByDescriptivePhrase(items, phrase, aliases) {
  const normalized = phrase.trim().toLowerCase()
  if (/stall/.test(normalized)) {
    return items.filter(matchesStalled)
  }
  if (/ready( for adoption)?/.test(normalized)) {
    return items.filter(matchesReadyForAdoption)
  }
  if (/needs? (you|owner|me)/.test(normalized)) {
    return items.filter(matchesNeedsOwner)
  }
  // Strip a leading determiner a caller's captured phrase occasionally
  // still carries (e.g. "the two" already consumed by THE_N_X_ONES_PATTERN
  // leaves a clean keyword, but a plain "the X one" capture can still start
  // with a stray "the").
  const keyword = normalized.replace(/^the\s+/, '').trim()
  return itemsMatchingKeyword(items, keyword, aliases)
}

function hasExcludeIntent(message) {
  return EXCLUDE_INTENT_PATTERN.test(message) && ALONE_MARKER_PATTERN.test(message)
}

// The one entry point. `resultItems` is the prior turn's real, structured
// item list (AttentionItem[] or the trimmed projection -- see
// fleet-attention-status.mjs's trimAttentionItem). Returns:
//   { resolved: true, items, matchedPhrase, exclude }        -- confident
//   { resolved: false, reason: 'NO_REFERRING_PHRASE' }        -- caller falls through, message never used a referring phrase at all
//   { resolved: false, reason: 'NO_PRIOR_ITEMS' }              -- a referring phrase was used but there is nothing to resolve against
//   { resolved: false, ambiguous: true, text, candidates }     -- a real referring phrase, genuinely unclear which subset it means
//   { resolved: false, reason: 'NO_MATCH', text }               -- a real referring phrase that matches nothing in the prior turn
export function resolveCommandReferent({ message, resultItems = [], aliases = loadProjectAliases() }) {
  const text = String(message ?? '')

  const numbered = THE_N_X_ONES_PATTERN.exec(text)
  if (numbered) {
    if (resultItems.length === 0) {
      return noPriorItems()
    }
    const expectedCount = NUMBER_WORDS[numbered[1].toLowerCase()] ?? Number(numbered[1])
    const matched = resolveByDescriptivePhrase(resultItems, numbered[2], aliases)
    if (matched.length === 0) {
      return { resolved: false, reason: 'NO_MATCH', text: `I don't see any items matching "${numbered[2]}" in what I just told you.` }
    }
    if (matched.length !== expectedCount) {
      return {
        resolved: false,
        ambiguous: true,
        text: `You said "the ${numbered[1]} ${numbered[2]} ones" but I count ${matched.length} matching -- which ones do you mean?`,
        candidates: matched
      }
    }
    return { resolved: true, items: matched, matchedPhrase: numbered[0], exclude: hasExcludeIntent(text) }
  }

  if (BOTH_PATTERN.test(text)) {
    if (resultItems.length === 0) {
      return noPriorItems()
    }
    if (resultItems.length === 2) {
      return { resolved: true, items: [...resultItems], matchedPhrase: 'both', exclude: hasExcludeIntent(text) }
    }
    return {
      resolved: false,
      ambiguous: true,
      text: `I have ${resultItems.length} items from the last answer, not two -- which two do you mean?`,
      candidates: resultItems
    }
  }

  const theXOne = THE_X_ONE_PATTERN.exec(text)
  if (theXOne) {
    if (resultItems.length === 0) {
      return noPriorItems()
    }
    const matched = resolveByDescriptivePhrase(resultItems, theXOne[1], aliases)
    if (matched.length === 0) {
      return { resolved: false, reason: 'NO_MATCH', text: `I don't see anything matching "${theXOne[1]}" in what I just told you.` }
    }
    if (matched.length > 1) {
      return {
        resolved: false,
        ambiguous: true,
        text: `More than one item matches "${theXOne[1]}" -- which one do you mean?`,
        candidates: matched
      }
    }
    return { resolved: true, items: matched, matchedPhrase: theXOne[0], exclude: hasExcludeIntent(text) }
  }

  return { resolved: false, reason: 'NO_REFERRING_PHRASE' }
}
