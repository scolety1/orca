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

export const MULTI_ACTION_INTENTS = Object.freeze([
  'EXTERNAL_WORK_HOLD',
  'ADOPT_CANDIDATE_REPORT',
  'START_KEEP_GOING',
  'ASSESS_AND_UPGRADE',
  'STATUS_QUERY',
  'GENERAL'
])

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Deliberately simpler than project-name-resolver.mjs's own splitClauses:
// no exclusion-cue awareness is needed here (an exclusion IS a real intent
// in this module's taxonomy -- EXTERNAL_WORK_HOLD -- never a silent drop),
// so this only needs the same sentence/comma/"but" boundaries for natural
// per-action clause scoping.
function splitClauses(message) {
  return String(message)
    .replace(/--|—/g, '.')
    .split(/[.!?\n;]+|,|\bbut\b/i)
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
    test: (t) => /\b(is\s+)?being\s+handled\s+by\s+(another|a\s+different)\s+(ai|agent|process)\b/i.test(t) || /\bleave\s+(it|that|this|\S+)\s+alone\b/i.test(t) || /\bhold\s+off\b/i.test(t)
  },
  { id: 'ADOPT_CANDIDATE_REPORT', test: (t) => /\badopt(ed|ing)?\b/i.test(t) },
  { id: 'START_KEEP_GOING', test: (t) => /\bkeep\s+going\b/i.test(t) || /\bovernight\b/i.test(t) },
  {
    id: 'ASSESS_AND_UPGRADE',
    test: (t) => /\bneeds?\s+(serious\s+)?work\b/i.test(t) || /\bget\s+.+?\s+up\b/i.test(t) || /\bupgrade\b/i.test(t) || /\bassess\b/i.test(t)
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
