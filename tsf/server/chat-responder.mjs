// Planner Chat backend. Deterministic and project-state-grounded on purpose:
// no paid provider call is wired in without Tim's explicit authorization
// (money/paid API is a TIM_REQUIRED class per the decision model), so this
// answers from real recorded project state instead of inventing an LLM
// persona. The interface (classify + respond) is what a real PLANNER_DEEP
// route would sit behind later — the UI never hard-codes a vendor.
import { projectLiveWorkFeedState } from '../domain/live-work-feed.mjs'

const TIM_REQUIRED_PATTERNS = [
  /\b(push|merge|deploy|publish|release to prod|production)\b/i,
  /\b(pay|payment|paid api|credit card|subscription|billing)\b/i,
  /\b(credential|secret|api key|password|token)\b/i,
  /\bdelete (the )?(repo|repository|branch|production)\b/i,
  /\b(adopt|approve).*(candidate|this)\b/i
]

const INTENTS = [
  {
    id: 'STATUS',
    // "what is it doing?" is Tim's own exact north-star follow-up phrasing
    // (M3 requirements) -- must be recognized, not fall through to GENERAL.
    pattern:
      /\b(what'?s going on|status|where are we|update me|catch me up|what (is|'s) it doing)\b/i
  },
  { id: 'FINISHED', pattern: /\b(is (this|it) (actually )?(done|finished|ready)|are we done)\b/i },
  // M3: the affirmative "go do real work" phrasings Tim's own north star
  // names ("go ahead," "build that," "do the recommended next step") --
  // deliberately a SEPARATE intent from FIX_REQUEST (which stays scoped to
  // "something is wrong, correct it") rather than folded into it, since the
  // two read differently even though both currently route to the same
  // RECOMMEND_AND_PROCEED dispatch path below. Checked BEFORE NEXT_ACTION:
  // "do the recommended next step" is an imperative dispatch request, not
  // the question "what's the next step?" that NEXT_ACTION's own pattern
  // means to catch -- ordering (first match wins) is what keeps these two
  // correctly distinguished rather than the "next step" substring colliding.
  {
    id: 'DISPATCH_REQUEST',
    pattern:
      /\b(go ahead|go for it|please proceed|proceed with (it|that|this)|build (that|this|it)|do (the recommended( next)? step|it|that)|sounds good,? (go ahead|do it))\b/i
  },
  { id: 'NEXT_ACTION', pattern: /\b(what should we do next|next step|what'?s next|what now)\b/i },
  { id: 'RATIONALE', pattern: /\b(why (did you|was)|what'?s the reasoning|why choose)\b/i },
  {
    id: 'CRITIQUE',
    pattern: /\b(looks like (shit|garbage|crap)|don'?t like|ugly|ugh|ew|hate this|sucks)\b/i
  },
  { id: 'FIX_REQUEST', pattern: /\b(fix (this|it)|change (this|it)|redo|make it)\b/i },
  { id: 'RESEARCH', pattern: /\b(research|look into|compare|investigate|explore options)\b/i },
  { id: 'HEALTH', pattern: /\b(health|is it healthy|any (issues|problems|blockers))\b/i },
  { id: 'ADOPTION', pattern: /\b(adopt|ready for adoption|candidate)\b/i }
]

export function classifyIntent(message) {
  for (const { id, pattern } of INTENTS) {
    if (pattern.test(message)) {
      return id
    }
  }
  return 'GENERAL'
}

export function classifyDecision(message, intent) {
  if (TIM_REQUIRED_PATTERNS.some((p) => p.test(message))) {
    return 'TIM_REQUIRED'
  }
  if (['FIX_REQUEST', 'DISPATCH_REQUEST', 'RESEARCH', 'CRITIQUE'].includes(intent)) {
    return 'RECOMMEND_AND_PROCEED'
  }
  return 'AUTO_DECIDE'
}

function fmtTests(testsRun) {
  if (!testsRun?.length) {
    return 'no recorded test run'
  }
  return testsRun
    .map((t) =>
      t.command
        ? `${t.command}: ${t.passed ?? '?'}/${(t.passed ?? 0) + (t.failed ?? 0)}`
        : JSON.stringify(t)
    )
    .join('; ')
}

// M3: "what is it doing?" (STATUS/NEXT_ACTION) must answer from the real,
// live Keep Going run once one exists for this project -- the old mission/
// candidate/release model below predates M2 entirely and has no
// relationship to a project's actual dispatch state. `gap` is optional
// (compareStateToGoal's own output, or null) -- see
// projectLiveWorkFeedState's own honesty guarantee for what happens
// without it.
// Only STATUS/NEXT_ACTION/FINISHED are ever answered from the live run,
// and only while it is genuinely still the primary story -- a
// COMPLETE/BLOCKED run stays that way forever with nothing to clear it
// (an independent review finding: an earlier version let ANY run --
// including one long finished and since forgotten -- permanently shadow
// every future question about this project, even when the old, richer
// mission/candidate/release model held separately-relevant, more current
// information). Exported so http-server.mjs can decide whether to skip
// the live conversational planner call using the exact same rule
// respond() itself applies, rather than two independently-drifting checks.
const LIVE_RUN_INTENTS = new Set(['STATUS', 'NEXT_ACTION', 'FINISHED'])
const LIVE_RUN_TERMINAL_STATES = new Set(['COMPLETE', 'BLOCKED'])
export function isLiveRunRelevantFor(intent, run) {
  return !!run && LIVE_RUN_INTENTS.has(intent) && !LIVE_RUN_TERMINAL_STATES.has(run.state)
}

function respondStatusOrNextActionFromRun(intent, project, run, gap) {
  const feed = projectLiveWorkFeedState(run, gap)
  const base = `**${project.displayName}** — Keep Going run \`${run.id}\` is **${feed.state}**: ${feed.reason}.`
  if (intent === 'FINISHED') {
    return `No, not yet — ${base}`
  }
  if (intent === 'STATUS') {
    return base
  }
  // NEXT_ACTION: point at the real, existing affordance for each state --
  // never a fictional one (an independent review finding elsewhere in M3
  // caught exactly this failure mode in a different message).
  if (feed.state === 'NEEDS_YOU') {
    const openQuestion = run.needsYou.find((entry) => !entry.resolvedAt)
    return openQuestion
      ? `${base} Open question: ${openQuestion.question}`
      : `${base} Check the Keep Going panel for the open question.`
  }
  if (feed.state === 'STALLED') {
    return `${base} Use the "Abandon stalled wave" action to recover it.`
  }
  if (feed.state === 'PAUSED' || feed.state === 'WAITING') {
    return `${base} Click Resume to continue it.`
  }
  if (feed.state === 'READY_FOR_ADOPTION') {
    return `${base} Review it on the Adoption surface and decide Adopt / Request Revision / Reject.`
  }
  return `${base} No action needed from you right now.`
}

function respondStatus(project) {
  const m = project.mission
  const r = project.release
  const reason = m.blockedReason?.replace(/\.+$/, '')
  return `**${project.displayName}** — mission \`${m.id ?? 'none'}\` is **${m.state}**. Health: **${project.health.status}**${reason ? ` — ${reason}.` : '.'} Stable at \`${(r.stable.head ?? 'unknown').slice(0, 10)}\`, Testing: ${r.testing}, Adoption: ${r.adoption}.`
}

function respondFinished(project) {
  const adopted = project.release.adoption?.startsWith('ADOPTED')
  if (adopted) {
    return `Yes — this candidate is **ADOPTED**. Verifier verdict GREEN, tests: ${fmtTests(project.candidate?.testsRun)}. Stable is at \`${(project.release.stable.head ?? '').slice(0, 10)}\`.`
  }
  if (
    project.mission.state === 'BLOCKED' ||
    project.mission.state === 'BLOCKED_ARCHITECTURAL_CONFLICT'
  ) {
    return `No — it's **blocked**: ${project.mission.blockedReason ?? project.health.findings?.[0]?.summary ?? 'see Health for details'}. Not safe to resume without a decision from you.`
  }
  if (project.candidate?.state === 'READY_FOR_ADOPTION') {
    return `The candidate is verifier-GREEN and **ready for your adoption decision** — it isn't adopted yet.`
  }
  return `Not yet — current mission state is **${project.mission.state}**.`
}

function respondNextAction(project) {
  switch (project.mission.state) {
    case 'BLOCKED':
    case 'BLOCKED_ARCHITECTURAL_CONFLICT':
      return `This needs a decision from you: ${project.mission.blockedReason ?? 'an architectural conflict is blocking safe progress'}. I won't guess past that boundary.`
    case 'ADOPTED':
      return `Nothing pending — Stable is settled at the adopted candidate. Next mission would need a new objective from you or the planner.`
    default:
      if (project.candidate?.state === 'READY_FOR_ADOPTION') {
        return `Review the candidate on the Adoption surface and decide Adopt / Request Revision / Reject.`
      }
      return `No active work item recorded for this project right now.`
  }
}

function respondRationale(project) {
  const sm = project.evidence?.selectedMission
  if (sm?.rationale) {
    return `**${sm.title ?? 'Selected mission'}** — ${sm.rationale}`
  }
  const summary = project.evidence?.resultCapsules?.at(-1)?.implementationSummary
  if (summary) {
    return summary
  }
  return `No recorded rationale for this project yet.`
}

function respondCritiqueOrFix(project, intent) {
  const verb = intent === 'CRITIQUE' ? 'Noted' : 'Got it'
  return `${verb}. I can't dispatch a live Orca worker from this chat yet — that path (Wave 5 Run/task/dispatch integration) is still pending. I've logged this as feedback on **${project.displayName}**; the concrete next step is to turn it into a bounded mission the planner can hand to a worker. Want me to draft that mission?`
}

function respondResearch(project) {
  return `Research routing isn't wired into chat yet — today this only reads recorded project state. For real research, route through the planner's normal research/mission flow outside this UI for now. I can still summarize what's already known about **${project.displayName}** if that helps.`
}

function respondHealth(project) {
  if (!project.health.findings?.length) {
    return `**${project.displayName}** is healthy — no findings.`
  }
  const findings = project.health.findings.map((f) => `${f.code}: ${f.summary}`).join(' ')
  return `**${project.displayName}** health: ${project.health.status}. ${findings}`
}

function respondAdoption(project) {
  if (!project.candidate) {
    return `No candidate recorded for ${project.displayName}.`
  }
  return `Candidate \`${(project.candidate.head ?? '').slice(0, 10)}\` is **${project.candidate.state}**. ${project.candidate.implementationSummary ?? ''}`.trim()
}

function respondGeneral(project) {
  return `I have recorded state for **${project.displayName}** (mission ${project.mission.state}, health ${project.health.status}) but that phrasing didn't match a specific question I can ground an answer in. Try asking about status, whether it's finished, what's next, why a choice was made, or its health.`
}

// M3's real dispatch bridge (chat-dispatch-bridge.mjs, still being built)
// intercepts DISPATCH_REQUEST before it ever reaches this fallback --
// this stays as the honest degraded answer for when that bridge itself is
// unavailable or hasn't decided to act, matching respondCritiqueOrFix's own
// "not wired yet" honesty rather than fabricating a dispatch that didn't
// happen.
function respondDispatchRequest(project) {
  return `Got it — I can't dispatch a live Orca worker from this reply path yet (the chat-dispatch bridge is still being built). I've logged this as a request on **${project.displayName}**; once wired, this exact phrasing will be enough to create a bounded plan and a real dispatch without you opening a terminal.`
}

const RESPONDERS = {
  STATUS: respondStatus,
  FINISHED: respondFinished,
  NEXT_ACTION: respondNextAction,
  RATIONALE: respondRationale,
  CRITIQUE: (p) => respondCritiqueOrFix(p, 'CRITIQUE'),
  FIX_REQUEST: (p) => respondCritiqueOrFix(p, 'FIX_REQUEST'),
  DISPATCH_REQUEST: respondDispatchRequest,
  RESEARCH: respondResearch,
  HEALTH: respondHealth,
  ADOPTION: respondAdoption,
  GENERAL: respondGeneral
}

function respondTimRequired(project) {
  return `That's a **consequential decision** (money, credentials, push/merge/deploy/publish, or adoption authority) — I won't act on it automatically. Tell me explicitly to proceed and I'll surface exactly what would change on **${project?.displayName ?? 'this project'}** before anything happens.`
}

// `run` (a real Keep Going domain run, or null) and `gap` (compareStateToGoal's
// output, or null) are both optional -- callers with no live run for this
// project (or that haven't wired the lookup) get the exact prior
// behavior, unchanged.
export function respond(project, message, run = null, gap = null) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  const text = !project
    ? `No project selected — pick one first.`
    : decisionClass === 'TIM_REQUIRED'
      ? respondTimRequired(project)
      : isLiveRunRelevantFor(intent, run)
        ? respondStatusOrNextActionFromRun(intent, project, run, gap)
        : RESPONDERS[intent](project)
  return {
    intent,
    decisionClass,
    text,
    plannerRole: 'PLANNER_DEEP',
    providerLabel:
      'No live provider configured — rule-based fallback grounded in recorded project state'
  }
}
