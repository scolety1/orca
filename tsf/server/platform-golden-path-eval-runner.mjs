// Phase 13: turns each TSF_PLATFORM_GOLDEN_PATH_EVAL case into a real
// actual output by ACTUALLY driving the real production chain -- never a
// hand-inlined stand-in for what it would produce. Only two genuinely
// non-deterministic boundaries are dependency-injected: the live LLM call
// (invokeLiveStructuredAnalysis, routed through the REAL live-planner.mjs
// spawn+parse path against a local stub CLI -- never a hand-typed plan
// object) and the real Orca worker process (a tracking fake orchestration
// adapter, the same seam chat-dispatch-bridge.test.mjs already established).
// Everything else -- classifyDispatchAdmission, planAndDispatchFromChat,
// tickKeepGoingRun/settleStep, and settled-run-reconciler.mjs's real git-
// evidence-gathering + disk-verdict-reading reconciliation -- is the real,
// unmodified production code, composed here for the first time in one run.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { respondCommand } from './command-responder.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import { reconcileSettledRun, verificationVerdictPath } from './settled-run-reconciler.mjs'
import { readKeepGoingRun } from './keep-going-run-store.mjs'
import { loadState } from './data-store.mjs'

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

// A real, disposable repo -- settled-run-reconciler.mjs's own
// gatherWorktreeEvidence runs real `git rev-parse`/`log` against this path,
// so a fabricated worktree could never survive that real call. The initial
// commit is explicitly backdated an hour: git's `--since` filter
// (listCommitsSince) has only second-level granularity, and this whole
// scenario runs in well under a second -- a commit and a real checkpoint
// landing in the SAME wall-clock second is a genuine, observed flake (a
// real commit occasionally sorted as "since" a checkpoint made
// milliseconds earlier), not a logic bug in settled-run-reconciler.mjs.
function initFixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-golden-path-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'golden-path-eval@example.com'])
  git(dir, ['config', 'user.name', 'Golden Path Eval'])
  writeFileSync(path.join(dir, 'README.md'), '# golden path fixture\n')
  git(dir, ['add', '-A'])
  const backdated = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  execFileSync('git', ['commit', '-q', '-m', 'initial'], {
    cwd: dir,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: backdated, GIT_COMMITTER_DATE: backdated }
  })
  return dir
}

// Keep Going runs are durably keyed by projectId in the real, shared state
// file -- a fixed id would let a second real run of this pack in the same
// process (e.g. a baseline-then-regressed comparison) collide with the
// first call's already-COMPLETE run instead of genuinely dispatching a
// fresh one. Unique per call, matching research-golden-path-eval-runner.mjs's
// own scenario-id convention.
let scenarioCounter = 0
function nextScenarioSuffix() {
  scenarioCounter += 1
  return `${Date.now()}-${process.pid}-${scenarioCounter}`
}

function fixtureProject(id, root) {
  return {
    id,
    displayName: id,
    root,
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

// Every task id createOrchestrationTask ever returns is echoed back
// COMPLETED the very next time listOrchestrationTasks is polled --
// deterministic by construction (settleStep matches on the real dispatched
// taskId), never a scripted response queue that could drift out of sync
// with what dispatchStep actually created.
function makeTrackingOrchestration() {
  const createdTaskIds = new Set()
  return {
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({
      ok: true,
      result: { run: { id: 'golden-path-orch-run' } }
    }),
    createOrchestrationTask: async ({ taskTitle }) => {
      const id = `task-${taskTitle}`
      createdTaskIds.add(id)
      return { ok: true, result: { task: { id } } }
    },
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({
      ok: true,
      result: { tasks: [...createdTaskIds].map((id) => ({ id, status: 'completed' })) }
    })
  }
}

function memoryEvidence(freeBytes) {
  return () => ({
    totalBytes: 16 * 1024 ** 3,
    freeBytes,
    availableBytes: freeBytes,
    usedPercent: 50
  })
}

const CRITICAL_MEMORY = memoryEvidence(1 * 1024 ** 3)

function baseDeps(dir, worktreeDir, collectHostMemoryEvidence, orchestration) {
  return {
    findRegisteredOrcaRepo: async () => ({
      ok: true,
      registered: true,
      repo: { id: 'golden-path-repo' }
    }),
    createOrcaWorktree: async () => ({ ok: true, worktreePath: worktreeDir }),
    collectHostMemoryEvidence,
    tickDeps: { orchestration, resourcePressure: { collectHostMemoryEvidence } }
  }
}

// Negative control: a real CRITICAL reading, reached through respondCommand
// (not a hand-called planAndDispatchFromChat), must refuse before ANY
// downstream stage runs -- proves the Governor is a live gate in this exact
// composition, not merely forced HEALTHY throughout the pack.
async function runCriticalRefusalCase(clock) {
  const dir = initFixtureRepo()
  try {
    const projectId = `golden-path-critical-fixture-${nextScenarioSuffix()}`
    const project = fixtureProject(projectId, dir)
    let plannerCalled = false
    const deps = {
      ...baseDeps(dir, dir, CRITICAL_MEMORY, makeTrackingOrchestration()),
      invokeLiveStructuredAnalysis: async () => {
        plannerCalled = true
        return { ok: true, data: {} }
      }
    }
    const turn = await respondCommand({
      message: `run ${project.displayName} overnight`,
      projects: [project],
      opState: loadState(),
      clock,
      deps
    })
    const outcome = turn.dispatchResults?.find((r) => r.projectId === projectId)
    return {
      governorRefusedBeforePlannerCalled:
        outcome?.ok === false && outcome?.reason === 'RESOURCE_PRESSURE_REFUSED' && !plannerCalled,
      noKeepGoingRunWasCreated: readKeepGoingRun(projectId) === null
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// freeBytes is a real parameter into the real classifyDispatchAdmission
// call this scenario's dispatch turn makes -- defaults to HEALTHY.
// Overriding it to a real CRITICAL reading (see the dedicated regression
// test in platform-golden-path-eval-runner.test.mjs) models a genuine
// Resource Pressure Governor outage against this EXACT composed scenario,
// never a hand-typed fake failure.
async function runFullHappyPathCase(clock, freeBytes = 8 * 1024 ** 3) {
  const dir = initFixtureRepo()
  try {
    const projectId = `golden-path-happy-fixture-${nextScenarioSuffix()}`
    const project = fixtureProject(projectId, dir)
    const orchestration = makeTrackingOrchestration()
    const deps = baseDeps(dir, dir, memoryEvidence(freeBytes), orchestration)

    const dispatchTurn = await respondCommand({
      message: `run ${project.displayName} overnight`,
      projects: [project],
      opState: loadState(),
      clock,
      deps
    })
    const dispatchOutcome = dispatchTurn.dispatchResults?.find((r) => r.projectId === projectId)
    const runAfterDispatch = readKeepGoingRun(projectId)

    // A real Governor refusal at the top means every downstream stage is
    // structurally unreachable -- reported honestly as a fully-failed
    // scenario rather than crashing on a null run, so a real regression
    // here shows up as every assertion in this case failing, not a thrown
    // exception hiding what actually broke.
    if (!dispatchOutcome?.ok || !runAfterDispatch) {
      return {
        governorAdmittedRealDispatch: false,
        plannerWorkPlanCameFromRealLiveExecPath: false,
        implementationWaveSettledReal: false,
        reconcilerGenuinelyRequiredAVerdictBeforeCompleting: false,
        verificationWaveSettledReal: false,
        reconcilerReadRealDiskVerdictAndCompleted: false,
        missionReachedDurableCompleteState: false,
        operatorVisibleTextConfirmsCompletion: false
      }
    }
    const runId = runAfterDispatch.id
    // A real, live-provider-shaped round trip: stub-planner-cli.mjs's own
    // TSF_CHAT_WORK_PLAN_REQUEST_V1 response prefixes the objective this
    // exact way -- a hand-injected fake plan could never produce this.
    const plannerWorkPlanCameFromRealLiveExecPath =
      typeof runAfterDispatch.originalGoal?.statement === 'string' &&
      runAfterDispatch.originalGoal.statement.startsWith('stub-plan-for::')

    const settleImpl = await tickKeepGoingRun(projectId, [], clock, deps.tickDeps)

    // Real Stage F: with no verdict on disk yet, the real reconciler must
    // decide to dispatch independent verification -- never assume COMPLETE.
    const reconcileBeforeVerdict = await reconcileSettledRun(projectId, clock, {
      tickDeps: deps.tickDeps
    })
    const settleVerify = await tickKeepGoingRun(projectId, [], clock, deps.tickDeps)

    // The real disk artifact a dispatched verification worker would have
    // written -- the criterion text must match the run's own real
    // acceptanceCriteria (from the real planner response) exactly, or
    // readVerificationVerdict honestly discards it as incomplete.
    const criterion = readKeepGoingRun(projectId).originalGoal.acceptanceCriteria[0]
    const verdictPath = path.join(dir, verificationVerdictPath(runId))
    mkdirSync(path.dirname(verdictPath), { recursive: true })
    writeFileSync(
      verdictPath,
      JSON.stringify({
        schemaVersion: 'TSF_VERIFICATION_VERDICT_V1',
        runId,
        criteria: [
          { criterion, verified: true, evidence: 'golden-path eval fixture: real disk verdict artifact' }
        ],
        verifiedAt: clock().toISOString()
      })
    )

    const reconcileAfterVerdict = await reconcileSettledRun(projectId, clock, {
      tickDeps: deps.tickDeps
    })
    const finalRun = readKeepGoingRun(projectId)

    const statusTurn = await respondCommand({
      message: `what is the current state of ${project.displayName}`,
      projects: [project],
      opState: loadState(),
      clock,
      deps
    })

    return {
      governorAdmittedRealDispatch: dispatchOutcome?.ok === true,
      plannerWorkPlanCameFromRealLiveExecPath,
      implementationWaveSettledReal: settleImpl.action === 'WAVE_SETTLED',
      reconcilerGenuinelyRequiredAVerdictBeforeCompleting:
        reconcileBeforeVerdict.action === 'DISPATCH_VERIFICATION',
      verificationWaveSettledReal: settleVerify.action === 'WAVE_SETTLED',
      reconcilerReadRealDiskVerdictAndCompleted: reconcileAfterVerdict.action === 'COMPLETE',
      missionReachedDurableCompleteState: finalRun.state === 'COMPLETE',
      operatorVisibleTextConfirmsCompletion:
        /READY_FOR_ADOPTION/.test(statusTurn.text) &&
        /independently-verified acceptance criteria/.test(statusTurn.text)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function runPlatformGoldenPathEvalCase(evalCase, clock = () => new Date()) {
  const { input } = evalCase
  if (input.kind === 'CRITICAL_REFUSAL') {
    return runCriticalRefusalCase(clock)
  }
  if (input.kind === 'FULL_HAPPY_PATH') {
    return runFullHappyPathCase(clock, input.freeBytes)
  }
  throw new Error(`unknown platform golden path eval case input kind: ${input.kind}`)
}

export async function runPlatformGoldenPathEvalPack(pack, clock = () => new Date()) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = await runPlatformGoldenPathEvalCase(evalCase, clock)
  }
  return actualOutputsByCaseId
}
