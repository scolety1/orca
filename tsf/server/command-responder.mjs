// Command's global-scope (no fixed project) chat answers. Resolves target
// project(s) from free text against the real catalog and either answers
// from the real fleet-wide status aggregator (fleet-work-status.mjs -- the
// same module GET /api/work and GET /api/fleet/status read, so a status
// panel and a chat sentence can never disagree) or fans a dispatch-worthy
// request out across every EXACTLY-resolved project via chat-dispatch-
// bridge.mjs's planAndDispatchFromCommand -- reused, real capability calls
// only, never a new execution engine. A message resolving to exactly ONE
// EXACT-matched project (no other candidates at all) is not handled here --
// http-server.mjs's chat route treats that identically to the operator
// having picked that project directly, reusing every existing
// single-project branch unchanged.
//
// Adversarial-review finding, fixed here: a real dispatch must never act on
// a merely-fuzzy or ambiguous project guess. Only project-name-resolver.mjs's
// EXACT (id/displayName) matches are ever eligible for a real dispatch --
// a fuzzy-only or ambiguous resolution asks for clarification instead of
// guessing which project(s) to act on. Status/question answers (read-only,
// no action taken) may still use fuzzy matches informationally.
import { classifyIntent, classifyDecision } from './chat-responder.mjs'
import { resolveProjectsFromText } from './project-name-resolver.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'
import { planAndDispatchFromCommand } from './chat-dispatch-bridge.mjs'
import { classifyResearchIntent, respondResearchCommand } from './command-research-bridge.mjs'

const STATUS_LIKE_INTENTS = new Set(['STATUS', 'NEXT_ACTION', 'FINISHED', 'HEALTH'])
export const DISPATCH_WORTHY_INTENTS = new Set(['DISPATCH_REQUEST', 'FIX_REQUEST'])

// Bounded follow-up conversational context (Phase 2): deliberately narrow --
// only these explicit back-reference shapes, only for READ-ONLY questions
// (this file's own DISPATCH_WORTHY_INTENTS branch never reaches this; a
// real dispatch still requires naming the project again, matching the
// existing "only an EXACT match is ever trusted enough to act on"
// philosophy this file's own header already documents). A bare "it"/"that"
// is deliberately excluded -- too common a word in ordinary prose to trust
// as a real back-reference on its own; every included phrase is
// project-shaped, not a generic pronoun.
const BACK_REFERENCE_PATTERN = /\b(that project|this project|that one|the same (project|one))\b/i

// Reads ONLY resolvedProjectIds this file itself persisted on a prior turn
// (http-server.mjs's chat-save, threaded straight from this file's own
// return value) -- never re-derived by guessing from old message text, and
// never a match against a project id/name that has since stopped existing
// in the real catalog (a project removed since the last turn is not
// silently re-resolved).
function lastReferencedProjectId(opState, projects) {
  const thread = opState.chatThreads?.__command__ ?? []
  const known = new Set(projects.map((p) => p.id))
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const entry = thread[i]
    if (entry.role === 'assistant' && entry.resolvedProjectIds?.length === 1) {
      const id = entry.resolvedProjectIds[0]
      if (known.has(id)) return id
    }
  }
  return null
}

export function formatFleetStatusText(statuses) {
  if (statuses.length === 0) {
    return 'No known projects yet -- add one from the Projects page.'
  }
  const lines = statuses.map((s) =>
    s.hasRun
      ? `- **${s.displayName}** — ${s.feed.state} (run \`${s.runId}\`) — ${s.feed.reason}.`
      : `- **${s.displayName}** — no Keep Going run.`
  )
  return `Here's what's really running right now:\n${lines.join('\n')}`
}

function respondNoProjectResolved(intent, projects, keepGoingRuns, clock) {
  if (STATUS_LIKE_INTENTS.has(intent)) {
    return formatFleetStatusText(fleetWorkStatus(projects, keepGoingRuns, clock))
  }
  return 'I couldn\'t tell which project this is about -- name a project (by id or display name), or ask "what\'s running right now?" for a fleet-wide status.'
}

function respondTimRequiredMultiScope() {
  return "That's a **consequential decision** (money, credentials, push/merge/deploy/publish, or adoption authority) -- I won't act on it automatically across any project. Tell me explicitly to proceed and name exactly which project(s)."
}

function respondNoConfidentMatch(candidates) {
  if (candidates.length === 0) {
    return "I couldn't tell which project this is about -- name a project (by id or display name) before I act on anything."
  }
  const names = candidates.map((p) => p.displayName).join(' or ')
  return `I'm not confident which project you mean -- did you mean ${names}? Name it exactly (by id or display name) before I dispatch anything.`
}

export async function respondCommand({
  message,
  projects,
  opState,
  clock = () => new Date(),
  deps = {},
  // Adversarial-review finding: without this, a Command-scope /api/chat
  // request that isn't a single confident match re-reads+re-parses
  // TSF_PROJECT_ALIASES_JSON a second time here, after http-server.mjs's
  // own resolveProjectsFromText call already did it once for the same
  // request -- purely redundant per-request cost with a latent risk the
  // two independently-loaded tables could ever disagree. Optional so every
  // existing caller (tests included) is unaffected; project-name-resolver.mjs
  // still loads its own real defaults when omitted.
  aliases
}) {
  // Phase 3: Dataset Research bridge -- checked FIRST, ahead of every
  // project-fleet intent/decision classification below, since a research
  // message is never about a registered TSF project (see
  // command-research-bridge.mjs's own header for why this layer is
  // correct). classifyResearchIntent returning null means "not a research
  // message at all" -- falls straight through to the unchanged logic
  // below, so no existing fleet-chat behavior is affected.
  if (classifyResearchIntent(message)) {
    const researchResult = await respondResearchCommand({ message, opState, clock })
    if (researchResult) return researchResult
  }
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  const resolution = resolveProjectsFromText(message, projects, { aliases })
  const resolvedProjectIds = resolution.matches.map((m) => m.project.id)
  const exactMatches = resolution.matches.filter((m) => m.matchedOn !== 'fuzzy')
  // A function, not a value computed once: adversarial-review finding --
  // the dispatch branch below narrows resolvedProjectIds down to only the
  // projects actually dispatched to (excluding fuzzy co-matches), and a
  // scope computed once up front against the WIDER (exact+fuzzy) set went
  // stale, returning e.g. scope: 'MULTI_PROJECT' alongside a single-entry
  // resolvedProjectIds. Recomputed fresh from whatever ids each response
  // actually reports.
  const scopeFor = (ids) =>
    ids.length === 0 ? 'FLEET' : ids.length === 1 ? 'PROJECT' : 'MULTI_PROJECT'

  if (decisionClass === 'TIM_REQUIRED') {
    return {
      intent,
      decisionClass,
      text: respondTimRequiredMultiScope(),
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · policy refusal -- consequential action, no live call made',
      live: false,
      resolvedProjectIds,
      scope: scopeFor(resolvedProjectIds)
    }
  }

  if (!DISPATCH_WORTHY_INTENTS.has(intent)) {
    // Read-only: every resolved match (exact or fuzzy) is safe to use for
    // an informational answer -- no action is ever taken here.
    if (resolution.matches.length === 0 && BACK_REFERENCE_PATTERN.test(message)) {
      const backReferenceId = lastReferencedProjectId(opState, projects)
      const backReferenceProject = backReferenceId ? projects.find((p) => p.id === backReferenceId) : null
      if (backReferenceProject) {
        return {
          intent,
          decisionClass,
          text: formatFleetStatusText(fleetWorkStatus([backReferenceProject], opState.keepGoingRuns, clock)),
          plannerRole: 'PLANNER_DEEP',
          providerLabel: 'PLANNER_DEEP · grounded in real state (resolved from the prior turn), no live call made',
          live: false,
          resolvedProjectIds: [backReferenceProject.id],
          scope: 'PROJECT'
        }
      }
    }
    return {
      intent,
      decisionClass,
      text:
        resolution.matches.length === 0
          ? respondNoProjectResolved(intent, projects, opState.keepGoingRuns, clock)
          : formatFleetStatusText(
              fleetWorkStatus(
                resolution.matches.map((m) => m.project),
                opState.keepGoingRuns,
                clock
              )
            ),
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · grounded in real state, no live call made',
      live: false,
      resolvedProjectIds,
      scope: scopeFor(resolvedProjectIds)
    }
  }

  // Dispatch-worthy from here -- a real action is about to be taken.
  // Adversarial-review finding: only an EXACT match is ever trusted enough
  // to act on. Zero exact matches (whether nothing resolved, only a fuzzy
  // guess, or an ambiguous multi-fuzzy match) asks for clarification
  // instead of guessing.
  if (exactMatches.length === 0) {
    return {
      intent,
      decisionClass,
      text: respondNoConfidentMatch(resolution.matches.map((m) => m.project)),
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · dispatch withheld -- no confidently-identified project',
      live: false,
      resolvedProjectIds,
      scope: scopeFor(resolvedProjectIds)
    }
  }

  // Self-repair is never authorized inside a multi-project batch -- it is
  // a single, deliberate, high-stakes action on TSF's own project only
  // (domain/self-repair-authority.mjs), never something that happens
  // incidentally alongside other projects in one dispatch fan-out. The
  // single-project path (http-server.mjs, exactly one total match, exact)
  // is the only place self-repair is ever evaluated.
  const targetProjects = exactMatches.map((m) => m.project)
  const dispatch = await planAndDispatchFromCommand({
    projects: targetProjects,
    message,
    clock,
    deps
  })
  // BUG-06 (bug-ledger.json): r.detail already states the real outcome
  // (e.g. "new mission started, task X dispatched" vs. "added to running
  // mission: WAVE_DISPATCHED") -- a "dispatched:" prefix here read as a
  // redundant double statement ("dispatched: new mission started...").
  const lines = dispatch.results.map((r) =>
    r.ok
      ? `- **${r.project.displayName}** — ${r.detail}.`
      : `- **${r.project.displayName}** — skipped: ${r.reason}${r.detail ? ` (${r.detail})` : ''}.`
  )
  return {
    intent,
    decisionClass,
    text: `Multi-project dispatch:\n${lines.join('\n')}`,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · real dispatch via Keep Going, looped across resolved projects',
    live: dispatch.results.some((r) => r.ok),
    // Adversarial-review finding: this was the outer resolvedProjectIds
    // (exact + fuzzy noise) -- a fuzzy co-match that was never actually
    // dispatched to would render as a "Targeting" chip in the UI as if it
    // had been acted on. Only the projects a real dispatch was actually
    // attempted against are reported here.
    resolvedProjectIds: targetProjects.map((p) => p.id),
    scope: scopeFor(targetProjects.map((p) => p.id)),
    dispatchResults: dispatch.results.map((r) => ({
      projectId: r.project.id,
      ok: r.ok,
      reason: r.reason ?? null,
      detail: r.detail ?? null
    }))
  }
}

// Exported so http-server.mjs's single-resolved-project branch can compute
// self-repair authorization with the exact match info the resolver already
// produced, without re-resolving.
export { isAuthorizedSelfRepair, resolveProjectsFromText }
