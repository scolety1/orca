// Phase 3: Command <-> Dataset Research bridge. Command's global-scope chat
// (command-responder.mjs, the "no fixed project" surface -- see that file's
// own header on why that's the right layer: a ResearchMission is never a
// registered fleet project, so this never competes with the per-project
// chat path in chat-responder.mjs, which is untouched by this file) routes
// research-shaped messages to REAL, durable ResearchMission state through
// server/research-mission-driver.mjs -- never an ad-hoc chat answer.
//
// AUTHORITY BOUNDARY (HQ decision, recorded here since this file is where
// it's enforced): Command may create/inspect/continue/pause/report on
// ResearchMissions and run free/no-new-spend paths under normal mission
// authority. Command must NEVER itself authorize a paid provider call --
// the only two ways a paid dispatch ever becomes possible are (1) the
// owner's own chat message explicitly naming a provider and a spend
// ceiling ("use Exa up to $50" -- parsePaidGrant below, routed straight to
// domain/research-paid-approval.mjs's grantResearchPaidApprovalDurable),
// or (2) the existing, separate, global TSF_RESEARCH_LIVE_DISPATCH_ENABLED
// HTTP gate (research-http-routes.mjs, unaffected by anything in this
// file). When Command's OWN judgment is that paid research would help, it
// only ever raises a scoped Needs You request (requestResearchPaidApproval)
// -- never grants it.
import { EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'
import { PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import {
  attemptFreeResearchProgressDurable,
  cancelResearchMissionDurable,
  createResearchMissionDurable,
  grantResearchPaidApprovalDurable,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  readResearchMissionReviewItems,
  readResearchMissionStatus,
  requestResearchPaidApprovalDurable
} from './research-mission-driver.mjs'
import { synthesizeResearchSpecification } from './command-research-spec-synthesis.mjs'

const PROVIDER_NAME_TO_ID = Object.freeze({ exa: EXA_PROVIDER_ID, parallel: PARALLEL_PROVIDER_ID })

// Checked in this exact order -- most specific/structured phrasing first,
// the broad "research"/"dataset" catch-all last, so e.g. "what's the
// research doing?" is never swallowed by the bare-"research" pattern.
const RESEARCH_INTENT_PATTERNS = [
  { id: 'RESEARCH_PAID_GRANT', test: (msg) => parsePaidGrant(msg) != null },
  // Advisory-only -- "could Exa help?" (no $ amount) must never be
  // confused with RESEARCH_PAID_GRANT (which requires a real amount)
  // above; checked next so it's never swallowed by the broad
  // RESEARCH_CREATE_OR_CONTINUE catch-all just because it says "help"
  // near a provider name.
  { id: 'RESEARCH_PAID_ADVISORY', test: (msg) => /\b(could|can|would)\s+(exa|parallel)\s+help\b|\bshould (i|we) use (exa|parallel)\b/i.test(msg) },
  {
    id: 'RESEARCH_ARTIFACTS',
    test: (msg) =>
      /\b(show me the artifacts|show the artifacts|artifacts?\W*\bcsv|the csv|download (the )?(data|csv)|see the (data|artifacts)|show me the evidence|show the evidence|see the evidence)\b/i.test(
        msg
      )
  },
  // Deliberately narrower than bare /\bconflicts?\b/ -- "conflict" alone
  // is common, unrelated chat vocabulary in this codebase's own domain
  // (a real Git merge conflict on some other project) and must never
  // hijack an ordinary fleet-dispatch message away from real dispatch.
  { id: 'RESEARCH_CONFLICTS', test: (msg) => /\bwhat conflicts\b|\bresearch conflicts\b|\bconflicts?\s+(remain|left|open|outstanding)\b/i.test(msg) },
  { id: 'RESEARCH_COMPLETENESS', test: (msg) => /\bhow complete\b|\bcompleteness\b|\bhow far along\b|\bwhat'?s missing\b|\bwhat is missing\b/i.test(msg) },
  {
    id: 'RESEARCH_STATUS',
    test: (msg) =>
      /\bwhat'?s the research doing\b|\bresearch status\b|\bhow'?s the research going\b|\bstatus of (the )?research\b|\bwhat is the research doing\b/i.test(
        msg
      )
  },
  // "cancel it"/"cancel that"/"cancel the research"/"cancel this mission" --
  // narrower than a bare /\bcancel\b/ for the same reason RESEARCH_CONFLICTS
  // is narrower than bare "conflict": "cancel" alone could plausibly mean
  // something else in a future, unrelated Command feature. Checked only
  // after the research-specific artifact/status/conflict patterns above so
  // none of those get shadowed.
  { id: 'RESEARCH_CANCEL', test: (msg) => /\bcancel\s+(it|that|this|the research|this mission|the mission)\b/i.test(msg) },
  // Disclosed scope limitation, not fixed here: a bare "research" anywhere
  // in the message is loose enough to catch a message that mentions
  // research only in passing about an unrelated fleet project ("I did some
  // research, now fix WorldForge") -- this mirrors chat-responder.mjs's
  // own pre-existing, equally broad per-project RESEARCH pattern
  // (`/\b(research|look into|...)\b/i`), not a new gap this bridge
  // introduces. "Research X"/"build me a dataset of Y" are the explicitly
  // required conversational shapes; narrowing this further to reduce false
  // positives is real follow-up work, not something to guess at silently.
  {
    id: 'RESEARCH_CREATE_OR_CONTINUE',
    test: (msg) => /\bresearch\b|\bbuild (?:me )?(?:a )?dataset\b|\bdataset\s+(?:of|for)\b/i.test(msg)
  }
]

export function classifyResearchIntent(message) {
  for (const { id, test } of RESEARCH_INTENT_PATTERNS) {
    if (test(message)) return id
  }
  return null
}

function isFreeOnlyRequest(message) {
  return /\bdon'?t spend (any )?money\b|\bno (new )?spend\b|\bfree only\b|\bwithout spending\b|\bno paid\b/i.test(
    message
  )
}

function parsePaidGrant(message) {
  const providerMatch = message.match(/\b(exa|parallel)\b/i)
  const amountMatch = message.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  if (!providerMatch || !amountMatch) return null
  const maxSpendUsd = Number(amountMatch[1].replace(/,/g, ''))
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) return null
  return { providerId: PROVIDER_NAME_TO_ID[providerMatch[1].toLowerCase()], maxSpendUsd }
}

const PRONOUN_ONLY_TOPIC = /^(this|it|that|the mission|the research|deeply)$/i

// "Research X" / "Research X deeply" / "Build me a dataset of Y" -> X or Y.
// Returns null for a pronoun-only reference ("Research this deeply") --
// that is a CONTINUE on the current mission, not a new topic, handled by
// the caller falling back to the most-recently-touched mission.
function extractResearchTopic(message) {
  let m = message.match(/\bbuild (?:me )?(?:a )?dataset\s+(?:of|for)\s+(.+)/i)
  if (!m) m = message.match(/\bresearch\s+(.+)/i)
  if (!m) return null
  const topic = m[1]
    .split(/,|\bbut\b|\bdeeply\b/i)[0]
    .trim()
    .replace(/[.?!]+$/, '')
    .trim()
  if (!topic || PRONOUN_ONLY_TOPIC.test(topic)) return null
  return topic
}

function slugify(topic) {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'untitled-research'
}

// A slug already present verbatim in the message wins over "most recent" --
// an operator naming a mission explicitly is never overridden by
// conversational recency.
function explicitMissionIdIn(message, opState) {
  const known = Object.keys(opState.researchMissions ?? {})
  const lower = message.toLowerCase()
  return known.find((id) => lower.includes(id.toLowerCase())) ?? null
}

function mostRecentMissionId(opState) {
  const missions = Object.values(opState.researchMissions ?? {})
  if (missions.length === 0) return null
  return missions.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0].id
}

// Gap 2 (final conversational-context pass): "could Exa help?" and every
// other missionId-less follow-up must resolve the mission THIS
// CONVERSATION was actually about, not merely "whichever mission was
// touched most recently anywhere in the system" -- a real risk once more
// than one mission genuinely exists (a second mission progressing in the
// background, e.g. via another session, must never silently hijack "it"
// away from the one Tim is actually talking to). Reads the SAME bounded
// per-turn record command-followup-context.mjs's lastAnswerSummary reads
// (chatThreads.__command__'s persisted researchMissionId), never the raw
// answer text.
function lastReferencedMissionId(opState) {
  const thread = opState.chatThreads?.__command__ ?? []
  const known = new Set(Object.keys(opState.researchMissions ?? {}))
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const entry = thread[i]
    if (entry.role === 'assistant' && entry.researchMissionId && known.has(entry.researchMissionId)) {
      return entry.researchMissionId
    }
  }
  return null
}

// The one real resolution priority every missionId-less follow-up in this
// file should use: explicit mention > this conversation's own history >
// (only when the system genuinely has exactly one mission at all, so
// there is nothing to actually be ambiguous about) the sole existing
// mission. Returns { missionId, ambiguous } -- ambiguous:true means
// "more than one mission exists and neither an explicit name nor this
// conversation's own history picked one", the caller's cue to ask rather
// than guess (never falls back to raw recency, which is not a real
// conversational signal).
function resolveMissionContext(message, opState) {
  const explicit = explicitMissionIdIn(message, opState)
  if (explicit) return { missionId: explicit, ambiguous: false }
  const contextual = lastReferencedMissionId(opState)
  if (contextual) return { missionId: contextual, ambiguous: false }
  const known = Object.keys(opState.researchMissions ?? {})
  if (known.length === 1) return { missionId: known[0], ambiguous: false }
  if (known.length > 1) return { missionId: null, ambiguous: true }
  return { missionId: null, ambiguous: false }
}

function noMissionYetText() {
  return "There's no research mission yet to talk about -- say what to research (e.g. \"research 2019 NFL rookie WRs\" or \"build me a dataset of X\") and I'll start a real, durable one."
}

function ambiguousMissionText(opState) {
  const ids = Object.keys(opState.researchMissions ?? {})
  return `More than one research mission exists and it's not clear which one you mean (${ids.join(', ')}) -- name the one you're asking about.`
}

function result({ intent, decisionClass, text, live, researchMissionId = null }) {
  return {
    intent,
    decisionClass,
    text,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: live
      ? 'PLANNER_DEEP · real dispatch via the Dataset Research driver'
      : 'PLANNER_DEEP · grounded in real ResearchMission state, no live call made',
    live,
    resolvedProjectIds: [],
    scope: 'RESEARCH',
    researchMissionId
  }
}

export async function respondResearchCommand({ message, opState, clock = () => new Date() }) {
  const intent = classifyResearchIntent(message)
  if (!intent) return null // not a research-bridge message -- caller falls through

  if (intent === 'RESEARCH_PAID_GRANT') {
    const grant = parsePaidGrant(message)
    const missionContext = resolveMissionContext(message, opState)
    if (missionContext.ambiguous) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: ambiguousMissionText(opState), live: false })
    }
    const missionId = missionContext.missionId
    if (!missionId) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
    }
    await grantResearchPaidApprovalDurable(
      missionId,
      { providerId: grant.providerId, maxSpendUsd: grant.maxSpendUsd, scope: message, grantedBy: 'OPERATOR_CHAT' },
      clock
    )
    return result({
      intent,
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: `Approved: ${grant.providerId} may spend up to $${grant.maxSpendUsd} on **${missionId}**. This authority is scoped to this mission and this provider only -- it does not apply anywhere else and does not enable live dispatch globally.`,
      live: true,
      researchMissionId: missionId
    })
  }

  if (intent === 'RESEARCH_PAID_ADVISORY') {
    // Advisory only -- "could Exa help?" must never itself grant or
    // request anything (that's RESEARCH_PAID_GRANT's job, requiring a real
    // $ amount, and Command's own initiative during a continue cycle,
    // requestResearchPaidApprovalDurable below). This branch never
    // mutates mission state at all.
    const missionContext = resolveMissionContext(message, opState)
    if (missionContext.ambiguous) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: ambiguousMissionText(opState), live: false })
    }
    const missionId = missionContext.missionId
    if (!missionId) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
    }
    const openItems = readResearchMissionReviewItems(missionId) ?? []
    const openPaidRequest = openItems.find((n) => n.category === 'PAID_PROVIDER_APPROVAL_REQUIRED')
    const text = openPaidRequest
      ? `Possibly -- there's already an open paid-research request on **${missionId}**: "${openPaidRequest.question}". Say something like "use Exa up to $N" to approve it, scoped to this mission and this provider only. I won't spend anything without that.`
      : `**${missionId}** has no open gap I've flagged as needing paid research right now. Paid providers (Exa/Parallel) stay off by default -- if you want me to check whether one would help, ask me to continue the research and I'll raise a scoped request if a real gap remains.`
    return result({ intent, decisionClass: 'AUTO_DECIDE', text, live: false, researchMissionId: missionId })
  }

  if (intent === 'RESEARCH_CANCEL') {
    const missionContext = resolveMissionContext(message, opState)
    if (missionContext.ambiguous) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: ambiguousMissionText(opState), live: false })
    }
    const missionId = missionContext.missionId
    if (!missionId) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
    }
    try {
      await cancelResearchMissionDurable(missionId, 'OPERATOR_CHAT_CANCEL', clock)
      return result({
        intent,
        decisionClass: 'RECOMMEND_AND_PROCEED',
        text: `Cancelled **${missionId}**.`,
        live: true,
        researchMissionId: missionId
      })
    } catch (error) {
      return result({
        intent,
        decisionClass: 'AUTO_DECIDE',
        text: `Couldn't cancel **${missionId}**: ${error.message}.`,
        live: false,
        researchMissionId: missionId
      })
    }
  }

  if (intent === 'RESEARCH_ARTIFACTS' || intent === 'RESEARCH_STATUS' || intent === 'RESEARCH_COMPLETENESS' || intent === 'RESEARCH_CONFLICTS') {
    const missionContext = resolveMissionContext(message, opState)
    if (missionContext.ambiguous) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: ambiguousMissionText(opState), live: false })
    }
    const missionId = missionContext.missionId
    if (!missionId) {
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
    }
    if (intent === 'RESEARCH_STATUS') {
      const status = readResearchMissionStatus(missionId)
      if (!status) return result({ intent, decisionClass: 'AUTO_DECIDE', text: `I don't have a research mission called ${missionId}.`, live: false })
      const byStatus = Object.entries(status.nodesByStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'no nodes yet'
      return result({
        intent,
        decisionClass: 'AUTO_DECIDE',
        text: `**${missionId}** is ${status.phase} (mission state ${status.state}, revision ${status.revision}) -- ${status.nodeCount} node(s): ${byStatus}. ${status.openNeedsYouCount} open Needs You item(s).`,
        live: false,
        researchMissionId: missionId
      })
    }
    if (intent === 'RESEARCH_COMPLETENESS') {
      const completeness = readResearchMissionCompleteness(missionId, clock)
      if (!completeness) return result({ intent, decisionClass: 'AUTO_DECIDE', text: `I don't have a research mission called ${missionId}.`, live: false })
      return result({
        intent,
        decisionClass: 'AUTO_DECIDE',
        text: `Completeness for **${missionId}**:\n\`\`\`json\n${JSON.stringify(completeness, null, 2)}\n\`\`\``,
        live: false,
        researchMissionId: missionId
      })
    }
    if (intent === 'RESEARCH_CONFLICTS') {
      const items = readResearchMissionReviewItems(missionId)
      if (items == null) return result({ intent, decisionClass: 'AUTO_DECIDE', text: `I don't have a research mission called ${missionId}.`, live: false })
      const conflicts = items.filter((n) => n.category === 'UNRESOLVED_CONFLICT')
      const text =
        conflicts.length === 0
          ? `No open conflicts on **${missionId}** right now (${items.length} other open Needs You item(s), if any).`
          : `${conflicts.length} open conflict(s) on **${missionId}**:\n${conflicts.map((c) => `- ${c.question}`).join('\n')}`
      return result({ intent, decisionClass: 'AUTO_DECIDE', text, live: false, researchMissionId: missionId })
    }
    // RESEARCH_ARTIFACTS
    const artifacts = readResearchMissionArtifacts(missionId, clock)
    if (!artifacts) return result({ intent, decisionClass: 'AUTO_DECIDE', text: `I don't have a research mission called ${missionId}.`, live: false })
    return result({
      intent,
      decisionClass: 'AUTO_DECIDE',
      text: `Artifacts for **${missionId}** are ready to read via the real provenance package (GET /api/research/${missionId}/artifacts) -- ${artifacts.canonicalFacts?.length ?? 0} canonical fact(s) captured so far.`,
      live: false,
      researchMissionId: missionId
    })
  }

  // RESEARCH_CREATE_OR_CONTINUE
  const freeOnly = isFreeOnlyRequest(message)
  const topic = extractResearchTopic(message)
  const explicitId = explicitMissionIdIn(message, opState)
  // Pronoun-only continuation ("continue it"/"research this deeply"):
  // prefer THIS conversation's own history over blind system-wide
  // recency, same reasoning as resolveMissionContext above -- a second
  // mission progressing elsewhere must never silently steal "it".
  let missionId = explicitId ?? (topic ? slugify(topic) : (lastReferencedMissionId(opState) ?? mostRecentMissionId(opState)))

  if (!missionId) {
    return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
  }

  const existing = readResearchMissionStatus(missionId)
  if (!existing) {
    if (!topic) {
      // A pronoun-only continuation ("research this deeply") with nothing
      // to continue -- ask, never fabricate a topic.
      return result({ intent, decisionClass: 'AUTO_DECIDE', text: noMissionYetText(), live: false })
    }
    // Hands-on pilot Finding 2: the request itself may already carry
    // enough real scope for PLANNER_DEEP to propose a real specification
    // -- attempted FIRST, before ever falling back to an empty scaffold.
    // synthesizeResearchSpecification never fabricates domain content
    // (see its own header); it only asks a real live-planner call to
    // propose structure, independently re-validated before use.
    const synthesis = await synthesizeResearchSpecification({ message, missionId, freeOnly })

    if (synthesis.ok) {
      await createResearchMissionDurable(missionId, { projectId: 'COMMAND_CHAT', specification: synthesis.specification, expectedUniverse: synthesis.expectedUniverse, nodes: synthesis.nodes }, clock)
      // "Started" must mean something real (Finding 3): real nodes with a
      // real requested-fields shape now exist, so this mission's phase is
      // CREATED, not DRAFT -- "Created", never "Started", since no node
      // has actually been dispatched yet (see computeResearchMissionPhase).
      const strategyNote = synthesis.sourceStrategy ? ` Strategy: ${synthesis.sourceStrategy}.` : ''
      return result({
        intent,
        decisionClass: 'RECOMMEND_AND_PROCEED',
        text: `Created a real research mission **${missionId}** for "${topic}" -- ${synthesis.expectedUniverse.expectedCount} expected item(s), ${synthesis.specification.requestedFields.length} field(s) per item${freeOnly ? ', free-path only' : ''}.${strategyNote} Nothing has actually been dispatched yet -- ask me to continue it, or ask its status any time.`,
        live: true,
        researchMissionId: missionId
      })
    }

    if (synthesis.reason === 'NEEDS_INPUT') {
      // Never claims anything started -- exactly the "do not make Tim
      // restate a request he already made" contract, applied to the ONE
      // genuine case it's meant for: real information really is missing,
      // not a provider outage.
      return result({
        intent,
        decisionClass: 'AUTO_DECIDE',
        text: `Before I start a research mission for "${topic}": ${synthesis.clarification}`,
        live: false,
        researchMissionId: null
      })
    }

    // PLANNER_UNAVAILABLE -- an honest infrastructure gap, not a claim
    // about the request's own quality. Still creates real, durable,
    // explicitly-labeled DRAFT state (never an unrecorded dead end), but
    // never says "Started".
    await createResearchMissionDurable(
      missionId,
      {
        projectId: 'COMMAND_CHAT',
        specification: {
          schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
          id: `${missionId}-spec`,
          researchQuestion: `Chat request: "${message}"`,
          entityType: 'UNSPECIFIED_CHAT_TOPIC',
          requestedFields: [],
          sourcePolicy: {
            preferredSources: [],
            disallowedSources: [],
            licensingConstraints: [],
            freshnessPolicy: 'UNSPECIFIED',
            requireIndependentSources: false,
            minSourceCount: 0,
            allowCrossMissionLibraryReuse: true
          },
          temporalRequirements: { asOfDate: null, periodScope: null },
          budget: { maxCostUsd: freeOnly ? 0 : null, maxLatencyMs: null, maxToolCallsPerNode: null },
          toolPermissions: []
        },
        expectedUniverse: {
          schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
          entityType: 'UNSPECIFIED_CHAT_TOPIC',
          expectedCount: 0,
          expectedEntities: [],
          source: 'DRAFT_SCAFFOLD -- live specification synthesis was unavailable; no real oracle yet'
        }
      },
      clock
    )
    return result({
      intent,
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: `Created a draft research mission **${missionId}** for "${topic}" -- I couldn't reach the live planner to propose real scope right now (${synthesis.detail ?? synthesis.reason}), so it's a bare draft with no fields/sources yet, not started. Try again shortly, or give me the fields/sources yourself.`,
      live: true,
      researchMissionId: missionId
    })
  }

  // Existing mission -- attempt bounded free-path progress. Paid dispatch
  // is never attempted from this generic path even when an approval
  // exists and freeOnly is false: WHICH node/provider to spend on is a
  // domain-specific targeting decision this generic bridge cannot safely
  // make on its own (see the module header) -- a real mission script or a
  // future, more specific command drives that, gated by
  // dispatchResearchNodeWithApprovalDurable.
  const progress = await attemptFreeResearchProgressDurable(missionId, clock)
  const freeNote = freeOnly ? ' (free-path only, as requested)' : ''
  const remainingGap = progress.fieldsAttempted - progress.fieldsAdvanced

  // Command's OWN judgment that paid research could help -- only ever a
  // REQUEST (open Needs You), never a grant, and never raised twice for
  // the same standing gap (raiseResearchNeedsYou itself never dedupes, so
  // this bridge is responsible for not re-asking every single turn).
  let paidRequestRaised = false
  if (!freeOnly && remainingGap > 0) {
    const openItems = readResearchMissionReviewItems(missionId) ?? []
    const alreadyAsked = openItems.some((n) => n.category === 'PAID_PROVIDER_APPROVAL_REQUIRED')
    if (!alreadyAsked) {
      await requestResearchPaidApprovalDurable(
        missionId,
        {
          providerId: EXA_PROVIDER_ID,
          scope: missionId,
          estimatedSpendUsd: null,
          expectedBenefit: `${remainingGap} field(s) with no free-path (Research Library) match could likely be resolved by a bounded paid research call.`
        },
        clock
      )
      paidRequestRaised = true
    }
  }

  const gapNote =
    remainingGap > 0
      ? paidRequestRaised
        ? ` ${remainingGap} field(s) have no free-path match -- I've raised a scoped paid-research approval request (Exa) for you to review; I will not spend anything without your explicit approval.`
        : ` ${remainingGap} field(s) still have no free-path match (a paid-research approval request is already open for this mission).`
      : ''
  const text =
    progress.fieldsAttempted === 0
      ? `**${missionId}** has no ready nodes with free-path (Research Library) matches right now${freeNote}. Current state: ${existing.state}, ${existing.nodeCount} node(s).`
      : `Free-path progress on **${missionId}**${freeNote}: ${progress.fieldsAdvanced}/${progress.fieldsAttempted} field(s) advanced via Research Library reuse across ${progress.nodesConsidered} node(s).${gapNote}`
  return result({
    intent,
    decisionClass: 'RECOMMEND_AND_PROCEED',
    text,
    live: progress.fieldsAdvanced > 0 || paidRequestRaised,
    researchMissionId: missionId
  })
}
