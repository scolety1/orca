// Native Self-Improvement Controlled Live Pilot V1, Phase 8 (Operator
// Experience): Command <-> self-improvement finding-store bridge. Same
// layer/reasoning as command-research-bridge.mjs and command-dogfood-
// bridge.mjs (checked early in command-responder.mjs, ahead of project-
// fleet intent classification, since "what did TSF find?" is never about a
// registered fleet project) -- this file is pure message-classification +
// read-only reporting glue over the real, durable
// self-improvement-finding-store.mjs. It never mutates a finding and never
// enables the loop -- answering these questions requires no authority this
// bridge doesn't already have as a plain reader.
import { readAllFindings } from './self-improvement-finding-store.mjs'
import { buildFleetAttentionItems, trimAttentionItem } from '../domain/fleet-attention-status.mjs'
import { gatherRealFleetAttentionInputs } from './attention-status-reconciler.mjs'

// Order matters (most specific first), same convention as
// command-research-bridge.mjs's RESEARCH_INTENT_PATTERNS: "why wasn't X
// auto-fixed" and "what failed verification" are both narrower shapes of
// the broad "what did TSF find" vocabulary and must be checked first so
// the catch-all never swallows them.
const INTENT_PATTERNS = [
  // Broadened for "Why didn't TSF fix this?" -- anchored to "tsf fix"
  // plus a pronoun, so it never loosens into a generic "why wasn't X done"
  // catch-all.
  {
    id: 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED',
    test: (msg) =>
      /\bwhy\s+(wasn'?t|was\s+not|isn'?t|is\s+not)\s+(this|that|it)\s+auto[- ]?fixed\b/i.test(msg) ||
      /\bwhy\s+didn'?t\s+tsf\s+fix\s+(this|that|it)\b/i.test(msg)
  },
  { id: 'SELF_IMPROVEMENT_FAILED_VERIFICATION', test: (msg) => /\bwhat\s+failed\s+verification\b/i.test(msg) },
  // Broadened for "What needs approval?" -- distinct anchor from
  // command-scope-classifier.mjs's NEEDS_YOU_QUERY ("what needs me") and
  // command-fleet-attention-bridge.mjs's intents, so this never shadows or
  // collides with either.
  {
    id: 'SELF_IMPROVEMENT_READY_FOR_ADOPTION',
    test: (msg) => /\bwhat'?s?\s+(is\s+)?ready\s+for\s+adoption\b|\bready\s+to\s+adopt\b|\bwhat\s+needs\s+approval\b/i.test(msg)
  },
  // Broadened for "What did TSF fix by itself?" -- anchored to "tsf fix"
  // plus one of these completions, so it never matches an unrelated
  // "what did TSF find"/"what did you fix" message.
  {
    id: 'SELF_IMPROVEMENT_RESOLVED',
    test: (msg) =>
      /\bwhat\s+fixed\s+itself(\s+successfully)?\b|\bself[- ]?fixed\b/i.test(msg) ||
      /\bwhat\s+did\s+tsf\s+fix\s+(by\s+itself|on\s+its\s+own|itself)\b/i.test(msg)
  },
  { id: 'SELF_IMPROVEMENT_IN_PROGRESS', test: (msg) => /\bwhat\s+(is\s+it|are\s+you)\s+fixing\b|\bwhat'?s?\s+it\s+fixing\b/i.test(msg) },
  { id: 'SELF_IMPROVEMENT_ALL_FINDINGS', test: (msg) => /\bwhat\s+did\s+tsf\s+find\b|\bself[- ]?improvement\s+findings?\b|\btsf\s+findings?\b/i.test(msg) }
]

export function classifySelfImprovementIntent(message) {
  for (const { id, test } of INTENT_PATTERNS) {
    if (test(message)) { return id }
  }
  return null
}

export function shouldRouteToSelfImprovementBridge(message) {
  return classifySelfImprovementIntent(message) !== null
}

function findingSummaryLine(finding) {
  return `- **${finding.severity}** [${finding.sourceDetector}] ${finding.affectedSurface}: ${finding.candidateFixScope?.description ?? finding.reproduction?.description ?? finding.findingId} (${finding.status})`
}

function listOrNone(findings, noneText) {
  if (findings.length === 0) { return noneText }
  return findings.map(findingSummaryLine).join('\n')
}

// resultItems (Part A2): honestly [] unless the branch actually built its
// answer from buildFleetAttentionItems (AttentionItem[]) -- never fabricated
// for a branch that only ever read raw finding records.
const RESPOND = ({ intent, text, resultItems }) => ({
  intent,
  decisionClass: 'RECOMMEND_AND_PROCEED',
  text,
  plannerRole: 'PLANNER_DEEP',
  providerLabel: 'PLANNER_DEEP · real read from the durable self-improvement finding store, no mutation',
  live: true,
  resolvedProjectIds: [],
  scope: 'SELF_IMPROVEMENT',
  resultItems: resultItems ?? []
})

// deps.readAllFindings lets tests inject a fixed store snapshot -- same
// convention as respondDogfoodCommand's deps.collectHostMemoryEvidence.
export async function respondSelfImprovementCommand({ message, deps = {} }) {
  const intent = classifySelfImprovementIntent(message)
  if (!intent) { return null }

  const read = deps.readAllFindings ?? readAllFindings
  const rawStore = read()
  const all = Object.values(rawStore)

  if (intent === 'SELF_IMPROVEMENT_ALL_FINDINGS') {
    if (all.length === 0) {
      return RESPOND({ intent, text: 'No self-improvement findings recorded yet -- a real detector sweep has not surfaced anything.' })
    }
    const bySeverity = all.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {})
    // Part A2: reuses buildFleetAttentionItems' own selfImprovementItems
    // projection (never a second, hand-rolled finding->AttentionItem
    // mapping) so this answer's resultItems carry real project attribution
    // and a real category, exactly like the READY_FOR_ADOPTION branch below.
    const needsRealFleetReadForAll = deps.projects === undefined || deps.keepGoingRuns === undefined
    const realInputsForAll = needsRealFleetReadForAll ? gatherRealFleetAttentionInputs() : null
    const allResultItems = buildFleetAttentionItems({
      projects: deps.projects ?? realInputsForAll.projects,
      keepGoingRuns: deps.keepGoingRuns ?? realInputsForAll.keepGoingRuns,
      researchMissions: deps.researchMissions ?? realInputsForAll?.researchMissions ?? {},
      plannerMissionRecords: deps.plannerMissionRecords ?? realInputsForAll?.plannerMissionRecords ?? {},
      selfImprovementFindings: rawStore,
      resourcePressureState: null
    }).filter((i) => i.source.kind === 'SELF_IMPROVEMENT_FINDING')
    return RESPOND({
      intent,
      text: [`${all.length} self-improvement finding(s) on record:`, ...all.map(findingSummaryLine), `By severity: ${JSON.stringify(bySeverity)}`].join('\n'),
      resultItems: allResultItems.map(trimAttentionItem)
    })
  }

  if (intent === 'SELF_IMPROVEMENT_IN_PROGRESS') {
    const inProgress = all.filter((f) => f.status === 'FIX_MISSION_CREATED' || f.status === 'FIX_IN_PROGRESS')
    return RESPOND({ intent, text: `In-progress repair(s):\n${listOrNone(inProgress, 'Nothing is currently being repaired.')}` })
  }

  if (intent === 'SELF_IMPROVEMENT_RESOLVED') {
    const resolved = all.filter((f) => f.status === 'RESOLVED')
    return RESPOND({ intent, text: `Self-fixed successfully:\n${listOrNone(resolved, 'Nothing has been resolved yet.')}` })
  }

  if (intent === 'SELF_IMPROVEMENT_READY_FOR_ADOPTION') {
    // Operator Attention V1, Wave 2: swapped from this bridge's own narrow
    // readAllFindings-only filter to buildFleetAttentionItems filtered to
    // READY_FOR_ADOPTION -- a strict superset (self-improvement findings are
    // already one input to that bucket, functionally equivalent to the old
    // path, PLUS project-level Keep Going adoption candidates the old path
    // never saw). Replaced outright rather than merged with the old path,
    // per the locked design -- simpler, same real data underneath. `rawStore`
    // (not `all`) is threaded through so an empty real store is never
    // confused with "no override supplied" and silently swapped for a real
    // read. deps.projects/keepGoingRuns/etc. (mirroring deps.readAllFindings's
    // own convention) let tests inject a fixed fleet snapshot; production
    // falls back to gatherRealFleetAttentionInputs. resourcePressureState is
    // never needed here (READY_FOR_ADOPTION can never contain the resource-
    // pressure item), so it's passed null rather than reading real host
    // memory for a query that structurally can't use it.
    const needsRealFleetRead = deps.projects === undefined || deps.keepGoingRuns === undefined
    const realInputs = needsRealFleetRead ? gatherRealFleetAttentionInputs() : null
    const readyItems = buildFleetAttentionItems({
      projects: deps.projects ?? realInputs.projects,
      keepGoingRuns: deps.keepGoingRuns ?? realInputs.keepGoingRuns,
      researchMissions: deps.researchMissions ?? realInputs?.researchMissions ?? {},
      plannerMissionRecords: deps.plannerMissionRecords ?? realInputs?.plannerMissionRecords ?? {},
      selfImprovementFindings: rawStore,
      resourcePressureState: null
    }).filter((i) => i.category === 'READY_FOR_ADOPTION')
    const lines = readyItems.map((i) => `- **${i.severity}** ${i.label}: ${i.reason}`)
    return RESPOND({
      intent,
      // Coordinator adoption-review fix: this now also lists project-level
      // Keep Going adoption candidates, which are never subject to the
      // self-improvement adoption gate (a separate, unrelated authority) --
      // the old caption claimed a blanket "adoption gate is closed" for
      // every item here, which overclaimed for those. Kept the reassurance
      // (nothing was auto-merged) without misattributing why.
      text: `Ready for adoption (nothing here has been auto-merged -- self-improvement fixes stay behind their own owner-authorization gate; project candidates await your normal review):\n${lines.length ? lines.join('\n') : 'Nothing is ready for adoption right now.'}`,
      resultItems: readyItems.map(trimAttentionItem)
    })
  }

  if (intent === 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED') {
    // Eligibility-level NEEDS_OWNER: the last transition was the
    // eligibility classifier's own verdict (self-improvement-autofix-
    // eligibility.mjs), not a retry-budget escalation (see
    // SELF_IMPROVEMENT_FAILED_VERIFICATION below for that other path) --
    // authorityRequired carries the real classifier reason, never guessed.
    const needsOwner = all.filter((f) => {
      const last = f.transitions.at(-1)
      return f.status === 'NEEDS_OWNER' && last?.reason === 'AUTOFIX_ELIGIBILITY_CLASSIFIED'
    })
    if (needsOwner.length === 0) {
      return RESPOND({ intent, text: 'No finding is currently withheld from autofix on eligibility grounds.' })
    }
    const lines = needsOwner.map((f) => `- ${f.affectedSurface} (${f.findingId}): ${f.authorityRequired ?? 'UNSPECIFIED'}`)
    return RESPOND({ intent, text: `Not auto-fixed -- eligibility withheld it:\n${lines.join('\n')}` })
  }

  if (intent === 'SELF_IMPROVEMENT_FAILED_VERIFICATION') {
    // Retry-budget-exhausted NEEDS_OWNER: repair-cycle.mjs's own real
    // escalation path once VERIFIED_FAIL recurs past the retry budget --
    // distinct from an eligibility rejection above, which never dispatched
    // a repair worker at all.
    const failedVerification = all.filter((f) => {
      const last = f.transitions.at(-1)
      return f.status === 'NEEDS_OWNER' && last?.reason === 'REPAIR_RETRY_BUDGET_EXCEEDED'
    })
    return RESPOND({
      intent,
      text: `Failed verification (retry budget exhausted, escalated to you):\n${listOrNone(failedVerification, 'Nothing has failed verification.')}`
    })
  }

  return null
}
