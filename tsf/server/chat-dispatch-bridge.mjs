// M3: the ONLY new code path that turns a Planner Chat message into a real
// Orca dispatch. Everything downstream of this module is unmodified M2
// (tickKeepGoingRun / startKeepGoingRun / the orchestration bridge) -- this
// module never invents a second worker loop, never fabricates a plan, and
// never bypasses the existing authority gate (chat-responder.mjs's
// classifyDecision must already have cleared TIM_REQUIRED before this is
// ever called). See docs/tsf/M3_CHAT_DISPATCH_LIVE_WORK_FEED_V1.md.
import chatWorkPlanRequestSchema from '../contracts/chat-work-plan-request.schema.v1.json' with { type: 'json' }
import {
  buildPlanCapsule,
  planCapsuleToCandidateWorkItem
} from '../domain/plan-capsule-mapping.mjs'
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'
import { startKeepGoingRun } from './keep-going-controller.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'
import { createOrcaWorktree, findRegisteredOrcaRepo } from '../adapters/orca-cli-bridge.mjs'
import { resolveRepositoryIdentity } from './repository-identity.mjs'

const WORK_PLAN_SYSTEM_PROMPT = [
  'You are the TSF (Thousand Sunny Fleet) Planner producing a BOUNDED, SAFE',
  'implementation plan from a chat request. Respond only with the requested',
  'JSON shape -- no prose, no markdown fences.',
  '',
  'Hard rules:',
  '- allowedScope must list only files/paths genuinely relevant to the request.',
  '- Never include adoption, push, merge, deploy, publish, credentials, money/',
  '  paid services, destructive operations, or major product-direction changes',
  '  as something this plan will do -- those require a human decision outside',
  '  this plan entirely, not a work item.',
  '- acceptanceCriteria and stopConditions must each have at least one entry.',
  '- If the request is too vague to bound safely, say so honestly in objective',
  '  and keep allowedScope/acceptanceCriteria minimal and conservative rather',
  '  than guessing at scope you were not given.'
].join('\n')

function buildWorkPlanPrompt({ project, message }) {
  return [
    `Project: ${project.displayName} (${project.id})`,
    `Tim's request: "${message}"`,
    '',
    'Produce a bounded work-plan-request JSON object for this request.'
  ].join('\n')
}

// Real, live-confirmed states a Keep Going run can be in where ticking it
// would either NOOP (tickKeepGoingRun itself refuses anything but ACTIVE)
// or actively be wrong to layer a brand-new plan onto (PAUSED/NEEDS_YOU/
// STALLED all need an operator decision or the existing M2 recovery path
// first, never a fresh dispatch on top). COMPLETE/BLOCKED are handled
// separately below (a new run may start once the old one is done).
const NON_DISPATCHABLE_ACTIVE_STATES = new Set(['PAUSED', 'NEEDS_YOU', 'STALLED'])

// Names only recovery affordances that genuinely exist in the product
// today -- an independent review finding was that an earlier version of
// this message named a fictional "resolve Needs You" action alongside the
// two real ones (Resume, Abandon stalled wave), neither of which exists
// as a wired UI/route today (resolveNeedsYou is domain-layer-only, see
// tsf/domain/keep-going.mjs -- a disclosed, pre-existing M2 gap, not
// something to silently claim is available from chat).
function recoveryHintFor(state) {
  if (state === 'PAUSED') {
    return 'the existing Keep Going run for this project is PAUSED -- click Resume before dispatching new work'
  }
  if (state === 'STALLED') {
    return 'the existing Keep Going run for this project is STALLED -- click Abandon stalled wave before dispatching new work'
  }
  return 'the existing Keep Going run for this project is NEEDS_YOU -- it has an open question recorded on the run (visible in the Keep Going panel); resolving it from chat is not wired up yet'
}

async function ensureActiveRun(projectId, capsule, clock, deps) {
  const readRun = deps.readKeepGoingRun ?? readKeepGoingRun
  const withRun = deps.withKeepGoingRun ?? withKeepGoingRun
  const start = deps.startKeepGoingRun ?? startKeepGoingRun

  const existing = readRun(projectId)
  if (existing) {
    return { run: existing, freshlyCreated: false }
  }

  // The unlocked read above (plus the live planner call before it) leaves
  // a real window where two concurrent chat dispatch requests for a
  // project with no run yet can both observe existing===null. The atomic
  // withRun closure below re-derives `current` from a fresh, lock-held
  // read, so startKeepGoingRun's own existing-run check still correctly
  // stops a genuine duplicate from ever being created -- an independent
  // review finding was that the LOSER of that race got an uncaught
  // TSF_RUN_ALREADY_ACTIVE instead, propagating to an ungraceful HTTP 500
  // and dropping that chat turn from history entirely (the exception
  // escaped before the route's own final chatThreads save). The correct
  // outcome for the loser isn't an error at all -- it should simply use
  // the run the winner just created, exactly like a caller that found an
  // existing run on the very first read above.
  try {
    const run = await withRun(projectId, (current) => {
      const { run: started } = start(
        { keepGoingRuns: { [projectId]: current } },
        projectId,
        {
          originalGoal: capsule.objective,
          acceptanceCriteria: capsule.acceptanceCriteria,
          constraints: capsule.constraints,
          stopConditions: capsule.stopConditions
        },
        clock
      )
      return started
    })
    return { run, freshlyCreated: true }
  } catch (error) {
    if (error.code !== 'TSF_RUN_ALREADY_ACTIVE') {
      throw error
    }
    return { run: readRun(projectId), freshlyCreated: false }
  }
}

// The one entry point: classifyDecision must already have ruled out
// TIM_REQUIRED before this is ever invoked (the caller's job, unchanged) --
// this function itself re-derives nothing about authority, it only acts.
//
// `placement` ({worktree|workerTerminal, agent}) is caller-supplied and
// required -- there is no safe default, matching every other M2 dispatch
// path. `identity` ({missionId?, repository}) supplies the real,
// already-known repository binding (root/worktree/branch/head/tree) -- a
// zero-tool LLM call has no way to discover this itself, so it is never
// asked to; fabricating a plausible-looking one here would be exactly the
// kind of thing this program refuses everywhere else.
export async function planAndDispatchFromChat({
  project,
  message,
  placement,
  identity,
  clock,
  deps = {}
}) {
  if (!placement?.worktree && !placement?.workerTerminal) {
    return {
      ok: false,
      reason: 'TSF_MISSING_PLACEMENT',
      detail: 'an explicit worktree or workerTerminal is required -- there is no safe default'
    }
  }
  if (!identity?.repository) {
    return {
      ok: false,
      reason: 'TSF_MISSING_REPOSITORY_IDENTITY',
      detail:
        'a real repository binding (root/worktree/branch/head/tree) is required -- the planner call cannot supply its own'
    }
  }

  const readRun = deps.readKeepGoingRun ?? readKeepGoingRun
  const invokeStructured = deps.invokeLiveStructuredAnalysis ?? invokeLiveStructuredAnalysis
  const tick = deps.tickKeepGoingRun ?? tickKeepGoingRun

  const existingRun = readRun(project.id)
  if (existingRun && NON_DISPATCHABLE_ACTIVE_STATES.has(existingRun.state)) {
    return {
      ok: false,
      reason: 'RUN_NOT_DISPATCHABLE',
      detail: recoveryHintFor(existingRun.state),
      run: existingRun
    }
  }

  const planResult = await invokeStructured({
    systemPrompt: WORK_PLAN_SYSTEM_PROMPT,
    prompt: buildWorkPlanPrompt({ project, message }),
    jsonSchema: chatWorkPlanRequestSchema
  })
  if (!planResult.ok) {
    return { ok: false, reason: planResult.reason, detail: planResult.detail }
  }

  let capsule
  try {
    capsule = buildPlanCapsule(planResult.data, {
      missionId: identity.missionId ?? `chat-${project.id}-${clock().getTime()}`,
      projectId: project.id,
      repository: identity.repository
    })
  } catch (error) {
    return { ok: false, reason: 'TSF_INVALID_PLAN_CAPSULE', detail: error.message }
  }

  let candidateWorkItem
  try {
    candidateWorkItem = planCapsuleToCandidateWorkItem(capsule, placement)
  } catch (error) {
    return { ok: false, reason: error.code ?? 'TSF_PLACEMENT_ERROR', detail: error.message }
  }

  const { run: activeRun } = await ensureActiveRun(project.id, capsule, clock, deps)
  if (activeRun.state !== 'ACTIVE') {
    // A COMPLETE/BLOCKED existing run cannot be ticked -- ensureActiveRun
    // only creates a NEW run when none exists at all; a finished one needs
    // its own explicit "start a new run" action, same as the UI's own rule.
    return {
      ok: false,
      reason: 'RUN_NOT_DISPATCHABLE',
      detail: `the existing Keep Going run for this project is ${activeRun.state} -- start a new run for further work`,
      run: activeRun
    }
  }

  // Adversarial-review finding: tickKeepGoingRun routes purely on whether
  // inFlightWave is already set -- calling it here with a NEW
  // candidateWorkItem while a wave is already in flight would silently
  // discard that work item (it settles the OLD wave instead) while still
  // returning ok:true, misleading the caller (and the operator-facing
  // "Started work on X" text) into believing the new item was dispatched.
  // Checked honestly, before ever calling tick, rather than after.
  if (activeRun.inFlightWave) {
    return {
      ok: false,
      reason: 'RUN_NOT_DISPATCHABLE',
      detail:
        'a wave is already in flight for this project -- wait for it to settle before dispatching new work',
      run: activeRun
    }
  }

  // tickDeps ({orchestration, store}) lets a caller stub the underlying
  // Orca bridge/store without replacing tickKeepGoingRun wholesale --
  // separate from `deps.tickKeepGoingRun` above, which replaces the tick
  // function itself for tests that don't want to exercise it at all.
  const tickResult = await tick(project.id, [candidateWorkItem], clock, deps.tickDeps ?? {})
  if (tickResult.action !== 'WAVE_DISPATCHED' && tickResult.action !== 'WAVE_DISPATCHED_PARTIAL') {
    // Defense in depth against the same class of silent-discard: even with
    // the up-front check above, a tick lost a real race (another caller
    // claimed it first) must still be reported honestly, not as ok:true.
    return {
      ok: false,
      reason: tickResult.action,
      detail: tickResult.reason ?? 'the candidate work item was not actually dispatched',
      run: tickResult.run ?? activeRun
    }
  }
  return { ok: true, planCapsule: capsule, candidateWorkItem, tickResult }
}

// Command/Planner Chat worktree auto-provisioning (M-Command): when a
// dispatch-worthy message has no caller-supplied placement, this is what
// stands in for "an operator typed a worktree path" -- looks up the
// project's already-registered Orca repo (never guesses one) and creates a
// fresh, independent worktree via the real Orca CLI (orca-cli-bridge.mjs's
// createOrcaWorktree, which itself wraps `orca worktree create` -- no
// worktree-creation logic of TSF's own). `fromBranch` is only ever passed
// by an already-authorized self-repair caller (see
// domain/self-repair-authority.mjs); every other caller gets the repo's
// own default base.
export async function ensureWorktreeForDispatch(project, deps = {}, { fromBranch } = {}) {
  const findRepo = deps.findRegisteredOrcaRepo ?? findRegisteredOrcaRepo
  const createWorktree = deps.createOrcaWorktree ?? createOrcaWorktree
  // Adversarial-review finding: both current callers already guarantee a
  // real, non-null project before reaching here -- guarded explicitly
  // anyway so a future caller gets an honest error instead of an
  // unhandled TypeError if that invariant is ever violated.
  if (!project?.root) {
    return {
      ok: false,
      reason: 'TSF_REPOSITORY_NOT_REGISTERED',
      detail: 'this project has no known repository root -- a manual worktree path is required'
    }
  }
  const registered = await findRepo(project.root)
  if (!registered.ok) {
    return { ok: false, reason: registered.reason, detail: registered.detail }
  }
  if (!registered.registered) {
    return {
      ok: false,
      reason: 'TSF_REPOSITORY_NOT_REGISTERED',
      detail:
        "this project's repository is not registered with Orca yet -- register it during onboarding, or supply a manual worktree path"
    }
  }
  const created = await createWorktree({
    repoId: registered.repo.id,
    name: `command-${project.id}-${Date.now()}`,
    fromBranch
  })
  if (!created.ok) {
    return { ok: false, reason: created.reason, detail: created.detail }
  }
  return { ok: true, worktree: created.worktreePath }
}

async function dispatchOneProject(project, message, clock, deps, selfRepairFromBranch) {
  const resolveIdentity = deps.resolveRepositoryIdentity ?? resolveRepositoryIdentity
  const worktreeResult = await ensureWorktreeForDispatch(project, deps, {
    fromBranch: selfRepairFromBranch
  })
  if (!worktreeResult.ok) {
    return { project, ok: false, reason: worktreeResult.reason, detail: worktreeResult.detail }
  }
  const resolved = await resolveIdentity(worktreeResult.worktree)
  if (!resolved.ok) {
    return { project, ok: false, reason: resolved.reason, detail: resolved.detail }
  }
  const dispatch = await planAndDispatchFromChat({
    project,
    message,
    placement: { worktree: worktreeResult.worktree },
    identity: { repository: resolved.identity },
    clock,
    deps
  })
  if (!dispatch.ok) {
    return { project, ok: false, reason: dispatch.reason, detail: dispatch.detail }
  }
  const items = dispatch.tickResult.dispatchRecords ?? []
  return {
    project,
    ok: true,
    // Adversarial-review finding: this was candidateWorkItem.id (a
    // work-item id, not a run id) -- tickResult.run.id is the real Keep
    // Going run id, same field http-chat-dispatch.test.mjs's own
    // "revision.body.tickResult.run.id" assertion already relies on.
    runId: dispatch.tickResult.run?.id ?? null,
    detail: items.length > 0 ? `task ${items[0].taskId} dispatched` : dispatch.tickResult.action
  }
}

// Runs each resolved project's dispatch chain (auto-provision worktree ->
// resolve identity -> the EXISTING planAndDispatchFromChat, unchanged --
// project-scoped chat keeps using it directly) CONCURRENTLY, not one at a
// time -- adversarial-review finding: each project's chain is already
// fully independent (its own worktree, its own repository identity, its
// own Keep Going run), so serializing them only added wall-clock latency
// with no safety benefit. One project's failure (repo not registered, not
// dispatchable, plan/dispatch error) is collected and reported, never
// aborts the others -- mirrors StartOvernightFleetDialog.tsx's own
// "continue past failures" behavior, just concurrently instead of
// sequentially. Does not build any new execution/dispatch logic of its
// own -- every real action here is planAndDispatchFromChat, unchanged.
export async function planAndDispatchFromCommand({
  projects,
  message,
  clock,
  deps = {},
  selfRepairFromBranch
}) {
  const settled = await Promise.allSettled(
    projects.map((project) =>
      dispatchOneProject(project, message, clock, deps, selfRepairFromBranch)
    )
  )
  // allSettled, not all: dispatchOneProject's own internal calls are all
  // designed to resolve with an honest {ok:false,...} rather than throw,
  // but a genuinely unexpected exception (a real bug, a thrown error deep
  // in the live-planner call) must still never take down every OTHER
  // project's already-independent result with it.
  const results = settled.map((outcome, i) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : {
          project: projects[i],
          ok: false,
          reason: 'UNEXPECTED_ERROR',
          detail: outcome.reason?.message ?? String(outcome.reason)
        }
  )
  return { results }
}
