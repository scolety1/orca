// POST /api/chat { projectId, message, attachments?, placement?, selfRepair? },
// GET /api/chat/:projectId (history) -- real-time chat dispatch
// orchestration: intent/decision classification, project resolution
// (exact/fuzzy/route-context fallback), Command's fleet-wide answer path,
// M3/M-Command real dispatch via Keep Going, grounded/live-planner
// responses, and the chat-thread persistence that backs all of them. See
// chat-responder.mjs (classification + grounded responses),
// chat-dispatch-bridge.mjs (real dispatch), live-planner.mjs (live calls),
// command-responder.mjs (Command's fleet-wide scope).
import { loadState } from './data-store.mjs'
import {
  respond,
  classifyIntent,
  classifyDecision,
  isLiveRunRelevantFor
} from './chat-responder.mjs'
import { invokeLivePlanner, providerLabel, fallbackLabel } from './live-planner.mjs'
import { planAndDispatchFromChat, ensureWorktreeForDispatch } from './chat-dispatch-bridge.mjs'
import { respondCommand, DISPATCH_WORTHY_INTENTS } from './command-responder.mjs'
import { respondResearchCommandForProject } from './command-research-bridge.mjs'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'
import { resolveRouteContextFallback } from './chat-route-context-fallback.mjs'
import { resolveRepositoryIdentity } from './repository-identity.mjs'
import { resolveProjectsFromText } from './project-name-resolver.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'
import { compareStateToGoal } from '../domain/keep-going.mjs'
import { attachDueCompletionNotices } from './completion-watch-reconciler.mjs'
import { attachDueAttentionNotices } from './attention-status-reconciler.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'
import { classifyRunActionVerb } from './command-run-action-bridge.mjs'
import { executeAction } from './action-executor.mjs'
import {
  shouldRouteToAdoptionCommandBridge,
  respondAdoptionCommand
} from './command-adoption-command-bridge.mjs'
import {
  classifySingleTargetHoldEntries,
  respondMultiActionCommand
} from './command-multi-action-bridge.mjs'

// Configures which real, known project id actually IS TSF's own -- self-
// repair (domain/self-repair-authority.mjs) can never be authorized for any
// project until this is set; there is no invented default to guess from.
const SELF_REPAIR_PROJECT_ID = process.env.TSF_SELF_REPAIR_PROJECT_ID || null

// M3/M-Command: turns a dispatch-worthy chat message into a real Orca
// dispatch via chat-dispatch-bridge.mjs, returning the SAME {intent,
// decisionClass, text, ...} response shape every other chat branch already
// produces. If the caller (Planner Chat's Advanced field, or a directly-
// supplied placement) gave an explicit worktree/workerTerminal, that wins
// unchanged; otherwise this auto-provisions a fresh worktree
// (ensureWorktreeForDispatch, M-Command) instead of refusing outright --
// the manual field is now a debug override, not a requirement (spec Phase
// 6). `selfRepairFromBranch` is only ever set by an already-authorized
// self-repair caller (domain/self-repair-authority.mjs); every other
// caller auto-provisions from the repo's own default base.
async function dispatchFromChat({
  project,
  message,
  placement,
  selfRepairFromBranch,
  attachments = []
}) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  // Coordinator adoption-review fix: planAndDispatchFromChat's own hold
  // check (chat-dispatch-bridge.mjs) runs too late to stop THIS function's
  // own ensureWorktreeForDispatch call below -- a held project's chat
  // dispatch would still create a real worktree before ever reaching that
  // gate. Same check, defense-in-depth, before any real side effect here.
  const hold = readProjectExecutionHold(project.id)
  if (isProjectExecutionHoldActive(hold)) {
    return {
      intent,
      decisionClass,
      text: `This project is under an execution hold (${hold.reason}${hold.note ? `: ${hold.note}` : ''}, set by ${hold.setBy}) -- release the hold before dispatching new work.`,
      providerLabel: 'PLANNER_DEEP · dispatch withheld -- PROJECT_EXECUTION_HOLD_ACTIVE',
      live: false,
      dispatched: false
    }
  }
  let effectivePlacement = placement
  if (!effectivePlacement?.worktree && !effectivePlacement?.workerTerminal) {
    const provisioned = await ensureWorktreeForDispatch(
      project,
      {},
      { fromBranch: selfRepairFromBranch }
    )
    if (!provisioned.ok) {
      return {
        intent,
        decisionClass,
        text: `I need a worktree to dispatch into. I tried to create one automatically and couldn't: ${provisioned.detail ?? provisioned.reason}. Supply a worktree path manually (Advanced) instead.`,
        providerLabel: 'PLANNER_DEEP · dispatch attempted, auto-provisioning failed',
        live: false,
        dispatched: false
      }
    }
    effectivePlacement = { worktree: provisioned.worktree }
  }
  if (!effectivePlacement.worktree) {
    return {
      intent,
      decisionClass,
      text: `I need an exact worktree path to dispatch into -- reusing an existing terminal for a chat-triggered dispatch isn't wired up yet, please supply a worktree.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, no repository binding available',
      live: false,
      dispatched: false
    }
  }
  const resolved = await resolveRepositoryIdentity(effectivePlacement.worktree)
  if (!resolved.ok) {
    const reasonText =
      resolved.reason === 'REPOSITORY_UNAVAILABLE'
        ? 'that worktree path does not exist'
        : resolved.reason === 'NOT_A_GIT_REPOSITORY'
          ? 'that path is not a git repository'
          : 'the repository could not be inspected'
    return {
      intent,
      decisionClass,
      text: `I can't dispatch this: ${reasonText} (${resolved.detail}).`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, repository resolution failed',
      live: false,
      dispatched: false
    }
  }

  const dispatch = await planAndDispatchFromChat({
    project,
    message,
    placement: effectivePlacement,
    identity: { repository: resolved.identity },
    clock: () => new Date(),
    attachments
  })

  if (!dispatch.ok) {
    const detailText = dispatch.detail ? ` (${dispatch.detail})` : ''
    return {
      intent,
      decisionClass,
      text: `I couldn't dispatch this on **${project.displayName}**: ${dispatch.reason}${detailText}.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, did not complete',
      live: false,
      dispatched: false,
      dispatchReason: dispatch.reason,
      dispatchDetail: dispatch.detail
    }
  }

  const items = dispatch.tickResult.dispatchRecords ?? []
  // BUG-06 (bug-ledger.json): the SAME chat phrasing ("go ahead" etc.)
  // silently either creates a brand new Keep Going run/mission or adds a
  // work item to whichever run is already ACTIVE for this project,
  // depending on hidden server-side state the operator cannot see --
  // freshlyCreated (now threaded through planAndDispatchFromChat, was
  // previously computed and discarded) is what actually distinguishes
  // them; said explicitly here rather than identical text either way.
  const missionPhrase = dispatch.freshlyCreated
    ? 'Started a new mission'
    : 'Added to the mission already running'
  // Recovered from a stranded uncommitted worktree: names the actual Keep
  // Going run and states the governance guarantee explicitly, layered onto
  // BUG-06's missionPhrase rather than replacing it.
  const dispatchedText =
    items.length > 0
      ? `${missionPhrase} for **${project.displayName}** in Keep Going run **${dispatch.tickResult.run?.id ?? 'unknown'}**: dispatched **${dispatch.candidateWorkItem.id}** (task ${items[0].taskId}) -- real Orca worker, no terminal opened by hand. Work remains governed and stops at Ready for Adoption.`
      : `${missionPhrase} for **${project.displayName}**: ${dispatch.tickResult.action}.`
  return {
    intent,
    decisionClass,
    text: dispatchedText,
    providerLabel: 'PLANNER_DEEP · real dispatch via Keep Going',
    live: true,
    dispatched: true,
    tickResult: dispatch.tickResult,
    candidateWorkItem: dispatch.candidateWorkItem,
    planCapsule: dispatch.planCapsule
  }
}

// POST /api/chat { projectId, message, attachments?, placement?, selfRepair? }
// projectId: null is Command's global scope (M-Command) -- generalized
// here rather than a parallel route, since this handler was already
// null-projectId-tolerant at the plumbing level. A message resolving
// to exactly ONE project, by an EXACT id/displayName match only, is
// treated identically to the operator having picked that project
// directly, reusing every branch below unchanged (including a real
// dispatch). Adversarial-review finding, fixed here: a fuzzy-only
// single match must NOT get this treatment -- it used to fall
// straight into the same dispatch-capable path as an exact pick,
// letting a 60%-confidence name guess trigger a real worktree/
// dispatch with no confirmation. Zero matches, multiple matches, or
// a fuzzy-only match are all answered by command-responder.mjs
// instead, which never dispatches on anything less than an exact
// match either.
//
// GET /api/chat/:projectId (history)
export async function handleChatRoute(
  parts,
  req,
  res,
  { map, opState, projects },
  { json, readBody, saveState }
) {
  if (parts[1] !== 'chat') {
    return false
  }

  if (req.method === 'POST') {
    const body = await readBody(req)
    // FIXED (TSF Software Mission Routing / Project Planner Hotfix V1):
    // this used to cap every incoming chat message at 4000 chars -- fine
    // for a short chat turn, but silently mutilating for a real long-form
    // software/product-engineering mission (multi-section directives run
    // tens of KB; the live NWR overnight mission that exposed this was
    // itself well past 4000 chars). Phase 4/5's "preserve the complete
    // source directive" requirement is unmet if it's truncated before
    // classification/dispatch ever sees it. 200000 is a generous real
    // ceiling (comfortably covers Test Family 5's up-to-64KB long-paste
    // cases) while still bounding pathological abuse -- not unlimited.
    const message = String(body.message ?? '').slice(0, 200000)
    if (!message.trim()) {
      json(res, 400, { ok: false, error: 'message is required' })
      return true
    }
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.slice(0, 10).map((a) => ({
          name: String(a?.name ?? 'attachment').slice(0, 200),
          type: String(a?.type ?? '').slice(0, 100),
          // Real extracted text (migration-context-attachments.ts),
          // capped again server-side defensively -- optional, so a
          // caller that only ever sent {name,type} (existing Planner
          // Chat behavior) is unaffected.
          extractedText:
            typeof a?.extractedText === 'string' ? a.extractedText.slice(0, 20000) : null
        }))
      : []

    let project = map.get(body.projectId) ?? null
    let matchedOn = project ? 'id' : null
    // Adversarial-review finding: a falsy check treated an explicit
    // empty-string projectId identically to Command's genuine null/
    // omitted scope. Precise null/undefined check instead, so an
    // empty-string projectId 404s honestly as an unknown project
    // (below) rather than silently entering Command's fleet-wide
    // resolution path.
    if (!project && body.projectId == null) {
      // Adversarial-review finding: loaded once and passed to both this
      // call and respondCommand's own internal resolution below --
      // previously each independently re-read+re-parsed
      // TSF_PROJECT_ALIASES_JSON for the same request.
      const commandAliases = loadProjectAliases()
      const resolution = resolveProjectsFromText(message, projects, {
        aliases: commandAliases
      })
      const contextFallbackProject =
        resolution.matches.length === 0
          ? await resolveRouteContextFallback({
              message,
              contextProjectId: body.contextProjectId,
              map
            })
          : null
      if (resolution.matches.length === 1 && resolution.matches[0].matchedOn !== 'fuzzy') {
        project = resolution.matches[0].project
        matchedOn = resolution.matches[0].matchedOn
      } else if (contextFallbackProject) {
        project = contextFallbackProject
        matchedOn = 'routeContext'
      } else {
        const commandResult = await respondCommand({
          message,
          projects,
          opState,
          clock: () => new Date(),
          aliases: commandAliases,
          attachments
        })
        const freshState = loadState()
        const threads = { ...freshState.chatThreads }
        threads.__command__ = [
          ...(threads.__command__ ?? []),
          { role: 'user', content: message, at: new Date().toISOString() },
          {
            role: 'assistant',
            content: commandResult.text,
            at: new Date().toISOString(),
            decisionClass: commandResult.decisionClass,
            intent: commandResult.intent,
            // Bounded semantic conversation record -- NOT the raw
            // answer text replayed later (command-followup-context.mjs
            // never reads `content` above for a follow-up; it recomputes
            // a fresh explanation from CURRENT canonical state using
            // only this bounded reference). The ONLY fields a later
            // turn's back-reference resolution ("what about it?", "run
            // it") or explanatory follow-up ("why is it stuck?", "what
            // does that mean?") is allowed to read. Persisted here (not
            // recomputed from `content` text later) so it's exactly
            // what THIS turn actually resolved to, never a re-guess
            // from prose.
            resolvedProjectIds: commandResult.resolvedProjectIds ?? [],
            researchMissionId: commandResult.researchMissionId ?? null,
            scope: commandResult.scope ?? null,
            // Multi-Project Command + Real Fleet Orchestration Overnight V1,
            // Part A2: a real, bounded, trimmed AttentionItem[] projection
            // (fleet-attention-status.mjs's own trimAttentionItem) --
            // present only when this turn's answer actually came from a
            // bridge that produced real AttentionItem[] (NEEDS_YOU_QUERY,
            // the fleet-attention/self-improvement bridges' item-producing
            // intents, the multi-action bridge); every other answer type
            // honestly persists an empty array, never a fabricated one, so
            // command-referent-resolution.mjs never resolves a referring
            // phrase against stale/invented items.
            resultItems: commandResult.resultItems ?? []
          }
        ].slice(-200)
        saveState({ ...freshState, chatThreads: threads })
        // Both reconcilers run, neither replaces the other -- completion notices first, then attention notices.
        json(
          res,
          200,
          await attachDueAttentionNotices(
            await attachDueCompletionNotices(commandResult, () => new Date()),
            () => new Date()
          )
        )
        return true
      }
    }

    const intent = classifyIntent(message)
    const decisionClass = classifyDecision(message, intent)
    let result
    let plannerSessions = opState.plannerSessions

    // M3/M-Command: a dispatch-worthy, non-TIM_REQUIRED message always
    // attempts a real dispatch now -- an explicit placement (Planner
    // Chat's Advanced field) still wins when supplied, otherwise
    // dispatchFromChat auto-provisions a worktree itself (spec Phase
    // 6: the manual field is an advanced override, not a requirement).
    const dispatchWorthy = DISPATCH_WORTHY_INTENTS.has(intent)
    const selfRepairAuthorized = isAuthorizedSelfRepair({
      toggleOn: !!body.selfRepair,
      matchedOn,
      decisionClass,
      projectId: project?.id ?? null,
      selfRepairProjectId: SELF_REPAIR_PROJECT_ID
    })
    // Adversarial-review finding: this was 'main' -- the real accepted
    // TSF branch (confirmed via `git branch -a`) is 'tsf/main', not a
    // bare 'main'. Configurable so this doesn't silently drift from
    // whatever the real accepted branch is called in a given
    // deployment, rather than hardcoding a second guess.
    const selfRepairFromBranch = selfRepairAuthorized
      ? process.env.TSF_SELF_REPAIR_BASE_BRANCH || 'tsf/main'
      : undefined

    // M3: "what is it doing?" must answer from the real, live Keep
    // Going run once one exists -- the live conversational planner
    // call below has zero awareness of Keep Going state (its own
    // project-context capsule never reads keepGoingRuns), so letting
    // a STATUS/NEXT_ACTION question through to it would risk an
    // uninformed or fabricated-sounding answer about work that is
    // actually, verifiably in progress. respond()'s own live-run path
    // (chat-responder.mjs) is grounded and deterministic instead.
    const liveRun = project ? keepGoingRunFor(opState, project.id) : null
    const liveGap = liveRun
      ? compareStateToGoal(liveRun, { verifiedSatisfied: [] }, () => new Date())
      : null
    // Uses the exact same relevance rule respond() itself applies
    // (chat-responder.mjs's isLiveRunRelevantFor) so this "should I
    // skip the live conversational call" decision can never drift
    // from what respond() actually does with the same inputs -- a
    // COMPLETE/BLOCKED run does NOT count, however long ago it
    // finished (an independent review finding: an earlier version
    // let any existing run, however stale, permanently shadow this
    // decision).
    const statusWorthy = isLiveRunRelevantFor(intent, liveRun)
    // Recovered from a stranded uncommitted worktree: a bug report or
    // critique should ground in whatever recorded project state exists
    // -- including with NO live run at all -- rather than spending a
    // live planner call on a message that isn't actually a question
    // about live progress. Kept as a separate flag (not folded into
    // statusWorthy/LIVE_RUN_INTENTS) so the providerLabel below can
    // still say "the live Keep Going run" only when that's honestly
    // true, and the more generic "recorded project state" otherwise.
    const feedbackWorthy = ['FEEDBACK_BUG', 'CRITIQUE'].includes(intent)
    // FIXED (Full Conversational Control Plane Exhaustive Gauntlet V1): a
    // bare acknowledgement/praise turn must NEVER reach the live, free-text
    // LLM fallback below -- that's the one path with no deterministic
    // guardrail against the model's own text narrating or implying a
    // consequential action (adopt/push/merge/deploy) was taken from mere
    // enthusiasm. respondAcknowledgement (chat-responder.mjs) is a real,
    // grounded, zero-LLM-call answer; routed the same way statusWorthy/
    // feedbackWorthy already are.
    const acknowledgementWorthy = intent === 'ACKNOWLEDGEMENT'
    const groundedResponseWorthy = statusWorthy || feedbackWorthy || acknowledgementWorthy

    // Project detail's "Research for this project": the SAME real
    // research bridge Command's global scope already uses, just given
    // this route's own already-resolved project id so a newly-created
    // mission is attributed to it (never 'COMMAND_CHAT') -- checked
    // before dispatch/live-planner so a research-shaped message never
    // reaches either.
    const projectResearchResult = project
      ? await respondResearchCommandForProject({
          project,
          message,
          opState,
          clock: () => new Date()
        })
      : null

    // TSF Overnight Control-Plane Burn-In V2, Lane L (live disposable
    // E2E) -- real, live-confirmed finding (not guessed): PAUSE/RESUME
    // via natural-language chat was completely UNREACHABLE from this
    // route, on BOTH the per-project Planner Chat surface AND Global
    // Command's own exact-match short-circuit (its own header comment
    // above: an exact single-project match "reuses every branch below
    // unchanged", which never included this check). Confirmed live: a
    // real HTTP POST /api/chat with message "pause <exact project id>"
    // left a real ACTIVE run untouched, silently falling through to the
    // generic grounded-fallback response instead -- classifyRunActionVerb
    // (command-run-action-bridge.mjs) is a real module, extensively
    // hardened for duplicate-delivery/race-safety/state-matrix coverage
    // this same mission, but was previously reachable ONLY from
    // command-responder.mjs's respondCommand, itself reachable only from
    // Global Command's AMBIGUOUS/fuzzy/back-referenced resolution path --
    // never the common, expected exact-name case, and never per-project
    // chat at all. Checked here, using the exact same real primitives,
    // for every project-scoped turn.
    //
    // Independent-review finding (real, live-confirmed, fixed here): the
    // FIRST version of this fix executed the real pause/resume BEFORE the
    // branch-selection chain below decided which response actually wins,
    // and ran it AHEAD of the TIM_REQUIRED gate -- so "pause X and
    // research Y" silently paused the run while returning an unrelated
    // research response, and "pause X and then deploy it to production"
    // silently paused the run with decisionClass AUTO_DECIDE instead of
    // being refused in full, contradicting respondCommand's own real
    // precedence (command-responder.mjs: research bridge -> TIM_REQUIRED
    // refusal -> adoption bridge -> runActionVerb, confirmed by reading
    // its actual code, not assumed). Fixed by gating the SIDE EFFECT
    // itself -- never just which result object wins -- on research having
    // produced nothing AND the message not being TIM_REQUIRED, exactly
    // matching respondCommand's real order.
    //
    // TSF Overnight Control-Plane Burn-In V2, Lane L continuation --
    // real, live-confirmed finding (not guessed), same architectural
    // blind spot as PAUSE/RESUME above: real adoption EXECUTION
    // (command-adoption-command-bridge.mjs's respondAdoptionCommand,
    // wired into command-responder.mjs's respondCommand) was likewise
    // reachable ONLY from Global Command's AMBIGUOUS/fuzzy path -- an
    // exact project-name adoption request ("adopt <exact project id>")
    // on EITHER the Global Command exact-match short-circuit OR
    // per-project Planner Chat fell through to chat-responder.mjs's
    // report-only respondAdoption, which never calls
    // executeCommandAdoption at all. Confirmed live: a real POST
    // /api/chat with "adopt <exact project id>" against a real
    // READY_FOR_ADOPTION candidate returned intent 'ADOPTION' (the
    // report-only shape), never 'ADOPTION_COMMAND' (the real execution
    // shape) -- paradoxically, ONLY a genuinely ambiguous "adopt it"
    // reaches real execution authority via Global Command, while the
    // clearest, most explicit phrasing does not. The UI's own
    // respondAcknowledgement hint text ("Say 'adopt it' ... when you
    // want me to move forward with it") is shown during exactly these
    // project-scoped turns, creating a real, reproducible expectation
    // mismatch. Fixed the same way as PAUSE/RESUME: `respondAdoptionCommand`
    // is called with `exactMatchProjects: [project]` -- the SAME real,
    // already safety-reviewed execution engine respondCommand uses
    // (single-exact-match-only guard, cross-project-co-naming protection
    // already fixed as a real P0 in a prior mission round), never a
    // new/parallel adoption path. Gated identically to PAUSE/RESUME:
    // after research, after TIM_REQUIRED -- exactly matching
    // respondCommand's own real precedence (research bridge ->
    // TIM_REQUIRED refusal -> adoption bridge), confirmed by reading its
    // actual code.
    //
    // Independent-review finding (real, live-confirmed, severe, fixed
    // here BEFORE this diff ever merged): the FIRST version of this fix
    // trusted `project` as the adoption target unconditionally --
    // correct for the Global Command exact-match path (there, `project`
    // IS derived from this exact message's own text, earlier in this
    // same function), but WRONG for per-project Planner Chat, where
    // `project` comes from `body.projectId` -- the conversation's fixed
    // scope, with NO relationship to what THIS message's own text
    // names. Live-reproduced: chatting in Project A's own thread
    // (`projectId: 'proj-a'`) and typing "adopt proj-b" (a real,
    // different, ready-for-adoption project) genuinely merged Project
    // A, never touching Project B -- exactly backwards from what the
    // message said. Fixed by independently re-deriving the message's
    // OWN project mentions (the same resolveProjectsFromText this file
    // already uses for the Global Command short-circuit above) and
    // refusing -- never guessing which one was meant -- whenever a
    // mention names a DIFFERENT project than the one this request is
    // actually scoped to. A message naming no project at all ("adopt
    // it") or the SAME project the request is already scoped to is
    // unaffected.
    //
    // Second independent-review finding (real, live-confirmed, fixed
    // here BEFORE merge): the first version of this guard only counted
    // a NON-fuzzy mention as conflicting, so a fuzzy-but-real mention of
    // a different project (FUZZY_CONFIDENCE_FLOOR is 0.6 -- a message
    // naming most, not all, of another real project's own display-name
    // tokens, clearly legible to a human) silently bypassed it and
    // reproduced the identical wrong-project merge. Live-reproduced:
    // scoped to Project A, "adopt the trail overhaul" fuzzy-matched
    // (0.667 confidence) a real, differently-named Project B ("Redwood
    // Trail Overhaul") and silently merged A anyway. This guard exists
    // specifically to refuse rather than guess on ANY real signal the
    // message may mean a different project -- fuzzy or exact -- so it
    // no longer excludes fuzzy matches. This is deliberately more
    // conservative than the Global Command exact-match short-circuit's
    // own "only exact is trusted enough to ACT on" convention: that
    // convention governs what's trusted enough to positively identify a
    // target, never what's trusted enough to justify a REFUSAL, and a
    // false-positive refusal here (an unrelated project's name
    // incidentally overlapping) is far cheaper than a real, irreversible
    // wrong-project merge.
    let adoptionCommandResult = null
    if (
      project &&
      !projectResearchResult &&
      decisionClass !== 'TIM_REQUIRED' &&
      shouldRouteToAdoptionCommandBridge(message, projects)
    ) {
      const messageNamedProjects = resolveProjectsFromText(message, projects, {
        aliases: loadProjectAliases()
      })
      const conflictingMention = messageNamedProjects.matches.find(
        (m) => m.project.id !== project.id
      )
      if (conflictingMention) {
        adoptionCommandResult = {
          intent: 'ADOPTION_COMMAND',
          decisionClass: 'NEEDS_OWNER',
          text: `This is scoped to **${project.displayName}**, but the message names **${conflictingMention.project.displayName}** -- I won't guess which one you mean. Say "adopt it" to adopt **${project.displayName}**, or switch to **${conflictingMention.project.displayName}**'s own chat to adopt that one.`,
          plannerRole: 'PLANNER_DEEP',
          providerLabel:
            'PLANNER_DEEP · adoption target conflicts with the current scope, no action taken',
          live: false,
          resolvedProjectIds: [],
          scope: 'ADOPTION_COMMAND'
        }
      } else {
        adoptionCommandResult = await respondAdoptionCommand({
          message,
          exactMatchProjects: [project],
          projects,
          clock: () => new Date()
        })
      }
    }

    let runActionResult = null
    if (
      project &&
      !projectResearchResult &&
      decisionClass !== 'TIM_REQUIRED' &&
      !adoptionCommandResult
    ) {
      const runActionVerb = classifyRunActionVerb(message)
      if (runActionVerb === 'PAUSE') {
        const actionResult = await executeAction({
          type: 'PAUSE',
          target: project.id,
          parameters: { reason: 'OPERATOR_CHAT_PAUSE' },
          clock: () => new Date()
        })
        runActionResult = actionResult.ok
          ? {
              intent: 'PROJECT_ACTION',
              decisionClass: 'AUTO_DECIDE',
              text: `Paused **${project.displayName}**.`,
              plannerRole: 'PLANNER_DEEP',
              providerLabel: 'PLANNER_DEEP · real pause via Keep Going',
              live: true,
              resolvedProjectIds: [project.id],
              scope: 'PROJECT'
            }
          : {
              intent: 'PROJECT_ACTION',
              decisionClass: 'AUTO_DECIDE',
              text: `Couldn't pause **${project.displayName}**: ${actionResult.detail}.`,
              plannerRole: 'PLANNER_DEEP',
              providerLabel: 'PLANNER_DEEP · action refused',
              live: false,
              resolvedProjectIds: [project.id],
              scope: 'PROJECT'
            }
      } else if (runActionVerb === 'RESUME') {
        // "RESUME" classified but the run is NOT actually paused (nothing
        // durable to resume) is deliberately left unhandled here -- it
        // falls through unchanged to this route's existing dispatch-
        // worthy logic below (a real, separate, narrower, disclosed gap:
        // classifyIntent doesn't yet recognize "continue X" as dispatch-
        // worthy on THIS route either; tracked, not fixed tonight).
        // executeAction folds the classifyContinueAction read into the same
        // typed call, so a corrupted-state-file/transient-I/O failure on
        // that read is caught exactly like a failed resume already is.
        const actionResult = await executeAction({
          type: 'RESUME',
          target: project.id,
          clock: () => new Date()
        })
        if (actionResult.ok && actionResult.action === 'RESUME') {
          runActionResult = {
            intent: 'PROJECT_ACTION',
            decisionClass: 'AUTO_DECIDE',
            text: `Resumed **${project.displayName}**.`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · real resume via Keep Going',
            live: true,
            resolvedProjectIds: [project.id],
            scope: 'PROJECT'
          }
        } else if (!actionResult.ok) {
          runActionResult = {
            intent: 'PROJECT_ACTION',
            decisionClass: 'AUTO_DECIDE',
            text: `Couldn't resume **${project.displayName}**: ${actionResult.detail}.`,
            plannerRole: 'PLANNER_DEEP',
            providerLabel: 'PLANNER_DEEP · action refused',
            live: false,
            resolvedProjectIds: [project.id],
            scope: 'PROJECT'
          }
        }
      }
    }

    // TSF Overnight Control-Plane Burn-In V2, real finding (not guessed):
    // the SAME "only reachable via Global Command's ambiguous path" blind
    // spot findings #7/#8 fixed for PAUSE/RESUME/ADOPT also applied to a
    // genuinely single-target execution-hold request -- a natural message
    // like "NWR is being handled by another agent, leave it alone" never
    // set a real, durable hold on either Global Command exact-match or
    // per-project chat, live-reproduced before fixing. Same precedence
    // gate as runActionResult (loses to research/TIM_REQUIRED/adoption),
    // since a hold is a real, single-target action too -- reuses the same
    // real, proven respondMultiActionCommand execution path via
    // classifySingleTargetHoldEntries' own narrower gate (see command-
    // multi-action-bridge.mjs), never a second implementation.
    //
    // Independent-review finding (real, fixed here): this check must NOT
    // be gated on `!runActionResult` -- a message can genuinely mean BOTH
    // at once for the SAME project ("pause NWR, it's being handled by
    // another agent, leave it alone" is a completely sensible combined
    // intent: pause the run AND stop future dispatch attempts). Live-
    // reproduced before this fix: with the naive `!runActionResult` gate,
    // that exact message silently paused the run and dropped the hold
    // entirely, reporting only "Paused **X**." with no indication the
    // hold was ever recognized or refused -- a real operator would
    // reasonably believe the project was protected from further work
    // when it was not. Fixed by computing the hold check independently
    // of runActionResult, then MERGING both real outcomes into one
    // response when both fire, rather than letting one silently shadow
    // the other -- matches this route's own established rule (proven for
    // TIM_REQUIRED and research already) that a message with multiple
    // real, distinct intents for the same target must never partially
    // execute one while silently dropping another.
    let holdCommandResult = null
    if (
      project &&
      !projectResearchResult &&
      decisionClass !== 'TIM_REQUIRED' &&
      !adoptionCommandResult
    ) {
      const holdEntries = classifySingleTargetHoldEntries(message, [project], loadProjectAliases())
      if (holdEntries) {
        holdCommandResult = await respondMultiActionCommand({
          message,
          projects: [project],
          opState: {},
          clock: () => new Date(),
          entries: holdEntries
        })
      }
    }

    const combinedRunActionAndHoldResult =
      runActionResult && holdCommandResult
        ? {
            ...runActionResult,
            text: `${runActionResult.text}\n\n${holdCommandResult.text}`,
            resolvedProjectIds: [
              ...new Set([
                ...(runActionResult.resolvedProjectIds ?? []),
                ...(holdCommandResult.resolvedProjectIds ?? [])
              ])
            ],
            resultItems: [
              ...(runActionResult.resultItems ?? []),
              ...(holdCommandResult.resultItems ?? [])
            ]
          }
        : null

    if (!project) {
      result = respond(project, message)
    } else if (projectResearchResult) {
      result = projectResearchResult
    } else if (adoptionCommandResult) {
      result = adoptionCommandResult
    } else if (combinedRunActionAndHoldResult) {
      result = combinedRunActionAndHoldResult
    } else if (runActionResult) {
      result = runActionResult
    } else if (holdCommandResult) {
      result = holdCommandResult
    } else if (decisionClass === 'TIM_REQUIRED') {
      // Consequential phrasing is refused deterministically, before ever
      // spending a live call on it — not left to the model's judgment.
      // Label this distinctly from an actually-unavailable provider: one
      // may well be configured and reachable, it was just deliberately
      // not called for this message.
      result = {
        ...respond(project, message, liveRun, liveGap),
        providerLabel: 'PLANNER_DEEP · policy refusal — consequential action, no live call made',
        live: false
      }
    } else if (dispatchWorthy) {
      result = await dispatchFromChat({
        project,
        message,
        placement: body.placement,
        selfRepairFromBranch,
        attachments
      })
    } else if (groundedResponseWorthy) {
      result = {
        ...respond(project, message, liveRun, liveGap),
        providerLabel: statusWorthy
          ? 'PLANNER_DEEP · grounded in the live Keep Going run, no live call made'
          : 'PLANNER_DEEP · grounded in recorded project state, no live call made',
        live: false
      }
    } else {
      const key = body.projectId ?? project.id
      const history = (opState.chatThreads[key] ?? []).slice(-12)
      const live = await invokeLivePlanner({
        project,
        message,
        opState,
        recentHistory: history,
        attachments
      })
      if (live.ok) {
        plannerSessions = { ...plannerSessions, [project.id]: live.binding }
        result = {
          intent,
          decisionClass,
          text: live.text,
          plannerRole: 'PLANNER_DEEP',
          providerLabel: providerLabel({ agentId: live.agentId, model: live.model }),
          live: true,
          agentId: live.agentId,
          providerId: live.providerId,
          model: live.model
        }
      } else {
        result = {
          ...respond(project, message, liveRun, liveGap),
          providerLabel: fallbackLabel(live.reason),
          live: false,
          unavailableReason: live.reason,
          unavailableDetail: live.detail
        }
      }
    }

    // Re-read fresh right before saving -- `opState` was captured once
    // at the very top of this request, before this route's own work
    // (M3's dispatch path in particular) may have mutated OTHER state
    // fields through their own properly-locked writes. A blind save
    // from that stale snapshot would silently revert those -- a real,
    // live-confirmed bug: a chat-triggered dispatch's freshly-created
    // Keep Going run vanished the instant this route's own
    // chatThreads save ran, because it saved `{...opState, ...}` with
    // opState.keepGoingRuns still empty from before the dispatch.
    const freshState = loadState()
    const plannerSessionChanged =
      project && plannerSessions[project.id] !== opState.plannerSessions[project.id]
    const nextPlannerSessions = plannerSessionChanged
      ? { ...freshState.plannerSessions, [project.id]: plannerSessions[project.id] }
      : freshState.plannerSessions
    const threads = { ...freshState.chatThreads }
    const key = body.projectId ?? project?.id ?? '__none__'
    result = { ...result, resolvedProjectIds: project ? [project.id] : [] }
    const attachmentSummary = attachments.length
      ? { attachmentCount: attachments.length, attachmentNames: attachments.map((a) => a.name) }
      : {}
    threads[key] = [
      ...(threads[key] ?? []),
      { role: 'user', content: message, at: new Date().toISOString(), ...attachmentSummary },
      {
        role: 'assistant',
        content: result.text,
        at: new Date().toISOString(),
        decisionClass: result.decisionClass,
        intent: result.intent
      }
    ].slice(-200)
    saveState({ ...freshState, chatThreads: threads, plannerSessions: nextPlannerSessions })
    json(
      res,
      200,
      await attachDueAttentionNotices(
        await attachDueCompletionNotices(result, () => new Date()),
        () => new Date()
      )
    )
    return true
  }

  // GET /api/chat/:projectId (history)
  if (parts.length === 3 && req.method === 'GET') {
    json(res, 200, opState.chatThreads[parts[2]] ?? [])
    return true
  }

  return false
}
