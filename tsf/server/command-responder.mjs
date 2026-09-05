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
import { findAliasForAbsentProject, resolveAllProjectsQuantifier, resolveProjectsFromText } from './project-name-resolver.mjs'
import { fleetNeedsYouStatus, fleetResearchStatus, fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'
import { planAndDispatchFromCommand } from './chat-dispatch-bridge.mjs'
import { classifyResearchIntent, respondResearchCommand } from './command-research-bridge.mjs'
import { advisorySafeProjects, buildGlobalAdvisoryText, classifyGlobalScope } from './command-scope-classifier.mjs'
import { classifyContinueAction, classifyRunActionVerb, pauseProjectRun, resumeProjectRun } from './command-run-action-bridge.mjs'
import { explainPriorAnswer } from './command-followup-context.mjs'

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

// researchStatuses (optional): fleetResearchStatus's own output --
// domain/fleet-work-status.mjs's real "is any research currently active"
// computation. "Command, Work/Home/global indicator and Research status
// must agree" (hands-on pilot Finding 3) -- a mission in the EXECUTING or
// WAITING_NEEDS_INPUT phase now appears in fleet-wide status exactly like
// a Keep Going run does, never silently absent from "what's running right
// now" just because it isn't project-scoped coding work.
// Hands-on pilot round 3, UX polish: the original version listed every
// idle project individually every time -- correct, but noisy, exactly the
// complaint. Active/waiting/Needs-You work is now what leads; idle
// projects collapse to a count when nothing needs attention there. Full
// per-project detail is never actually lost -- naming any project or
// research mission by name still gets its own real, ungrouped answer
// through the normal per-project/per-mission path; this function only
// changes the FLEET-WIDE summary's shape, never what real detail is
// available on request.
// Idle projects are still named individually up to this many -- collapsing
// even a single- or few-project answer to a bare count (the regression
// this threshold fixes: "what about that project?" resolves to exactly
// ONE project and must still say its name) defeats the point for the
// common small-fleet/single-project case this function is also used for.
// Noise is a many-idle-projects problem, not a one-or-two problem.
const IDLE_NAME_THRESHOLD = 3

export function formatFleetStatusText(statuses, researchStatuses = []) {
  if (statuses.length === 0 && researchStatuses.length === 0) {
    return 'No known projects yet -- add one from the Projects page.'
  }
  const activeProjectLines = statuses
    .filter((s) => s.hasRun)
    .map((s) => `- **${s.displayName}** — ${s.feed.state} (run \`${s.runId}\`) — ${s.feed.reason}.`)
  const idleProjects = statuses.filter((s) => !s.hasRun)
  const researchLines = researchStatuses.map(
    (r) => `- **Research ${r.missionId}** — ${r.phase}${r.phase === 'WAITING_NEEDS_INPUT' ? ' (needs a decision)' : ''}.`
  )
  const idleLines = idleProjects.map((s) => `- **${s.displayName}** — no Keep Going run.`)

  if (activeProjectLines.length === 0 && researchLines.length === 0) {
    if (idleProjects.length === 0) {
      return 'No known projects yet -- add one from the Projects page.'
    }
    if (idleProjects.length <= IDLE_NAME_THRESHOLD) {
      return `Nothing is running right now:\n${idleLines.join('\n')}`
    }
    return `Nothing is running right now. ${idleProjects.length} project(s) are idle. Ask me about any one by name for detail.`
  }

  const sections = []
  if (activeProjectLines.length > 0 || researchLines.length > 0) {
    sections.push([...activeProjectLines, ...researchLines].join('\n'))
  }
  if (idleProjects.length > 0) {
    sections.push(
      idleProjects.length <= IDLE_NAME_THRESHOLD
        ? idleLines.join('\n')
        : `${idleProjects.length} other project(s) idle, nothing to report -- ask me about any one by name for detail.`
    )
  }
  return `Here's what's really running right now:\n${sections.join('\n')}`
}

function respondNoProjectResolved(message, intent, projects, keepGoingRuns, researchMissions, clock, aliases) {
  const aliasHint = findAliasForAbsentProject(message, projects, aliases)
  if (aliasHint) {
    return `"${aliasHint.alias}" resolves to \`${aliasHint.canonicalProjectId}\`, but that project isn't available in this catalog.`
  }
  if (STATUS_LIKE_INTENTS.has(intent)) {
    return formatFleetStatusText(fleetWorkStatus(projects, keepGoingRuns, clock), fleetResearchStatus(researchMissions))
  }
  return 'I couldn\'t tell which project this is about -- name a project (by id or display name), or ask "what\'s running right now?" for a fleet-wide status.'
}

function respondTimRequiredMultiScope() {
  return "That's a **consequential decision** (money, credentials, push/merge/deploy/publish, or adoption authority) -- I won't act on it automatically across any project. Tell me explicitly to proceed and name exactly which project(s)."
}

// aliasHint (hands-on pilot Finding 4): { alias, canonicalProjectId } from
// findAliasForAbsentProject -- a known alias really did match, its target
// just isn't in THIS catalog. A distinct, honest answer, never the same
// generic "couldn't tell" a genuinely unrecognized name gets.
function respondNoConfidentMatch(candidates, aliasHint = null) {
  if (candidates.length === 0) {
    if (aliasHint) {
      return `"${aliasHint.alias}" resolves to \`${aliasHint.canonicalProjectId}\`, but that project isn't available in this catalog -- nothing to act on here.`
    }
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

  // Extracted so the same real dispatch + result-shaping is reachable both
  // from the normal exact-match path below AND from an actionable follow-
  // up's resolved back-reference ("run it") -- one real dispatch pipeline,
  // never two independently-maintained copies of how a dispatch result is
  // reported.
  async function dispatchAndRespond(targetProjects) {
    const dispatch = await planAndDispatchFromCommand({ projects: targetProjects, message, clock, deps })
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

  // Actionable follow-up context, round 3 (Command architecture): PAUSE/
  // RESUME had NO Command-facing recognition at all before this --
  // chat-responder.mjs's shared intent taxonomy has no pause/resume
  // intent, so "pause NWR" previously fell through to a read-only answer
  // that paused nothing. Checked independently of DISPATCH_WORTHY_INTENTS,
  // for BOTH a named exact match and a back-referenced one -- context
  // resolves WHICH project only; the mutation itself is the exact same
  // durable keep-going-controller.mjs call a directly-named project gets,
  // with no separate/weaker authorization path for the referenced case.
  const runActionVerb = classifyRunActionVerb(message)
  if (runActionVerb) {
    const namedExact = exactMatches.length === 1 ? exactMatches[0].project : null
    const backReferenceProjectId =
      !namedExact && resolution.matches.length === 0 ? lastReferencedProjectId(opState, projects) : null
    const backReferenceProject = backReferenceProjectId
      ? projects.find((p) => p.id === backReferenceProjectId)
      : null
    const targetProject = namedExact ?? backReferenceProject
    if (targetProject) {
      const resolvedVia = namedExact ? 'named' : 'resolved from the prior turn'
      if (runActionVerb === 'PAUSE') {
        try {
          await pauseProjectRun(targetProject.id, 'OPERATOR_CHAT_PAUSE', clock)
          return {
            intent: 'PROJECT_ACTION',
            decisionClass,
            text: `Paused **${targetProject.displayName}** (${resolvedVia}).`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · real pause via Keep Going',
            live: true,
            resolvedProjectIds: [targetProject.id],
            scope: 'PROJECT'
          }
        } catch (error) {
          return {
            intent: 'PROJECT_ACTION',
            decisionClass,
            text: `Couldn't pause **${targetProject.displayName}**: ${error.message}.`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · action refused',
            live: false,
            resolvedProjectIds: [targetProject.id],
            scope: 'PROJECT'
          }
        }
      }
      // RESUME/"continue" -- genuinely ambiguous in isolation
      // (classifyContinueAction decides using the REAL current run state,
      // never guessed from the verb alone): a PAUSED run resumes; anything
      // else (no run yet, or an already-ACTIVE run with nothing durable to
      // resume from) means the same thing "run it" does.
      const action = classifyContinueAction(targetProject.id)
      if (action === 'RESUME') {
        try {
          await resumeProjectRun(targetProject.id, clock)
          return {
            intent: 'PROJECT_ACTION',
            decisionClass,
            text: `Resumed **${targetProject.displayName}** (${resolvedVia}).`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · real resume via Keep Going',
            live: true,
            resolvedProjectIds: [targetProject.id],
            scope: 'PROJECT'
          }
        } catch (error) {
          return {
            intent: 'PROJECT_ACTION',
            decisionClass,
            text: `Couldn't resume **${targetProject.displayName}**: ${error.message}.`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · action refused',
            live: false,
            resolvedProjectIds: [targetProject.id],
            scope: 'PROJECT'
          }
        }
      }
      return dispatchAndRespond([targetProject])
    }
    // No target resolved (no name, no usable back-reference) -- falls
    // through to the normal read-only/dispatch-worthy branches below,
    // which report the same honest "couldn't tell" this file already
    // gives a directly-named, unresolvable project.
  }

  if (!DISPATCH_WORTHY_INTENTS.has(intent)) {
    // Gap 1, final conversational-context pass: explanatory follow-ups
    // ("what does that mean?", "why?", "why that one?", "why is it stuck?",
    // "what's blocking it?", "explain that", "is that bad?"). Checked
    // BEFORE the plain back-reference fallback below -- some of these
    // phrasings (e.g. "why that one?") also match BACK_REFERENCE_PATTERN,
    // and a "why" question is more specific than a bare status
    // back-reference: asking why deserves an explanation, not a status
    // repeat. Also checked before the live-planner scope classifier
    // further down -- a deterministic pattern match against a real,
    // bounded prior-answer summary is more specific and certain than a
    // live classification call, and explainPriorAnswer is read-only by
    // construction (see its own header: context establishes referent
    // only, never authority).
    if (resolution.matches.length === 0) {
      const explanation = explainPriorAnswer({ message, opState, projects, clock })
      if (explanation) {
        return {
          intent: 'FOLLOW_UP_EXPLANATION',
          decisionClass,
          text: explanation.text,
          plannerRole: 'PLANNER_DEEP',
          providerLabel: 'PLANNER_DEEP · fresh explanation from current canonical state, no live call made',
          live: false,
          resolvedProjectIds: explanation.resolvedProjectIds,
          researchMissionId: explanation.researchMissionId,
          scope: explanation.scope
        }
      }
    }
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
    // Command architecture fix (hands-on pilot round 2, Finding 1): a
    // message that matched none of chat-responder.mjs's own deterministic
    // patterns (GENERAL, its catch-all) AND named no project at all is no
    // longer assumed to be a failed project lookup -- it might genuinely
    // need no project (GLOBAL_STATUS/GLOBAL_ADVISORY/RESEARCH_REQUEST).
    // Deliberately scoped to intent === 'GENERAL' only: every OTHER
    // read-only intent (STATUS/HEALTH/etc.) already has its own real,
    // tested, deterministic pattern and fast fleet-wide fallback below --
    // this never adds live-planner latency to an already-working path.
    if (intent === 'GENERAL' && resolution.matches.length === 0) {
      const classification = await classifyGlobalScope({ message })
      if (classification.scope === 'GLOBAL_STATUS') {
        return {
          intent: 'GLOBAL_STATUS',
          decisionClass,
          text: formatFleetStatusText(fleetWorkStatus(projects, opState.keepGoingRuns, clock), fleetResearchStatus(opState.researchMissions)),
          plannerRole: 'PLANNER_DEEP',
          providerLabel:
            classification.source === 'LIVE_PLANNER'
              ? 'PLANNER_DEEP · real scope classification, grounded fleet-wide answer, no dispatch'
              : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded fleet-wide answer',
          live: false,
          resolvedProjectIds: [],
          scope: 'FLEET'
        }
      }
      if (classification.scope === 'GLOBAL_ADVISORY') {
        // Dogfood sequence C ("safe-project advisory -> run that"): an
        // advisory that names exactly ONE real candidate is remembered as
        // a back-reference target -- a genuinely ambiguous multi-project
        // list is not (resolvedProjectIds stays empty, exactly as before,
        // so a later "run that" still honestly asks which one).
        const safe = advisorySafeProjects(projects)
        const singleCandidateId = safe.length === 1 ? safe[0].id : null
        return {
          intent: 'GLOBAL_ADVISORY',
          decisionClass,
          text: buildGlobalAdvisoryText(projects),
          plannerRole: 'PLANNER_DEEP',
          providerLabel:
            classification.source === 'LIVE_PLANNER'
              ? 'PLANNER_DEEP · real scope classification, grounded in the real catalog, no dispatch, no action taken'
              : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded in the real catalog',
          live: false,
          resolvedProjectIds: singleCandidateId ? [singleCandidateId] : [],
          scope: singleCandidateId ? 'PROJECT' : 'FLEET'
        }
      }
      if (classification.scope === 'NEEDS_YOU_QUERY') {
        const items = fleetNeedsYouStatus(projects, opState.keepGoingRuns, opState.researchMissions)
        const text =
          items.length === 0
            ? 'Nothing needs you right now -- no open decisions across any project or research mission.'
            : `${items.length} thing(s) need you:\n${items.map((i) => `- **${i.label}** -- ${i.question}`).join('\n')}`
        return {
          intent: 'NEEDS_YOU_QUERY',
          decisionClass,
          text,
          plannerRole: 'PLANNER_DEEP',
          providerLabel:
            classification.source === 'LIVE_PLANNER'
              ? 'PLANNER_DEEP · real scope classification, grounded in real outstanding Needs You state, no dispatch'
              : 'PLANNER_DEEP · deterministic fallback scope classification (live planner unavailable), grounded in real outstanding Needs You state',
          live: false,
          resolvedProjectIds: [],
          scope: 'FLEET'
        }
      }
      if (classification.scope === 'RESEARCH_REQUEST') {
        // Delegates to the SAME research bridge entry point
        // command-research-bridge.mjs's own deterministic patterns use --
        // never a second, parallel mission-creation path. Its own patterns
        // already catch the common "research X"/"build a dataset" phrasing
        // directly (checked above, before this classifier ever runs); this
        // is the belt-and-suspenders path for a genuine research ask
        // phrased without those exact words.
        const researchResult = await respondResearchCommand({ message, opState, clock })
        if (researchResult) return researchResult
      }
      // PROJECT_REQUIRED / UNCLEAR / a RESEARCH_REQUEST the bridge itself
      // still couldn't make a real topic out of -- falls through to the
      // existing, honest "couldn't tell" fallback below rather than
      // guessing further.
    }
    return {
      intent,
      decisionClass,
      text:
        resolution.matches.length === 0
          ? respondNoProjectResolved(message, intent, projects, opState.keepGoingRuns, opState.researchMissions, clock, aliases)
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
    // Actionable follow-up context: "run it"/"fix it" already classify as
    // DISPATCH_REQUEST/FIX_REQUEST through chat-responder.mjs's own
    // existing patterns -- the only thing missing was WHICH project "it"
    // means. Tried only when nothing was named at all (never overrides an
    // ambiguous/ fuzzy-only named guess, which still asks for
    // clarification exactly as before).
    if (resolution.matches.length === 0) {
      // Multi-project actions round 3: "run everything safe except TSF" --
      // checked before back-reference (a quantifier is a stronger, more
      // explicit signal than conversational history) and only when nothing
      // was individually named at all. Never reaches self-repair -- this
      // always goes through the same multi-project dispatchAndRespond path
      // exact-match multi-project dispatch already uses, which never
      // evaluates self-repair (that stays the single-project http-server.mjs
      // branch's job alone, unaffected by anything here).
      const allProjects = resolveAllProjectsQuantifier(message, projects, aliases)
      if (allProjects) {
        return allProjects.length > 0
          ? dispatchAndRespond(allProjects)
          : {
              intent,
              decisionClass,
              text: 'Every project is excluded -- nothing left to act on.',
              plannerRole: 'PLANNER_DEEP',
              providerLabel: 'PLANNER_DEEP · dispatch withheld -- exclusions covered the entire catalog',
              live: false,
              resolvedProjectIds: [],
              scope: 'FLEET'
            }
      }
      const backReferenceProjectId = lastReferencedProjectId(opState, projects)
      const backReferenceProject = backReferenceProjectId
        ? projects.find((p) => p.id === backReferenceProjectId)
        : null
      if (backReferenceProject) {
        return dispatchAndRespond([backReferenceProject])
      }
    }
    return {
      intent,
      decisionClass,
      text: respondNoConfidentMatch(
        resolution.matches.map((m) => m.project),
        resolution.matches.length === 0 ? findAliasForAbsentProject(message, projects, aliases) : null
      ),
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
  return dispatchAndRespond(exactMatches.map((m) => m.project))
}

// Exported so http-server.mjs's single-resolved-project branch can compute
// self-repair authorization with the exact match info the resolver already
// produced, without re-resolving.
export { isAuthorizedSelfRepair, resolveProjectsFromText }
