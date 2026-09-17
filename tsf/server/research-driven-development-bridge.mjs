// TSF Research-Driven Development V1: the bridge's I/O half. Pure spec-
// construction lives in domain/research-driven-development.mjs; this
// module is the only place that touches real state -- reading a completed
// ResearchMission's provenance, driving a disposable CHALLENGE run, then
// starting the real BUILD run. Deliberately NOT a new dispatch engine:
// both the CHALLENGE run and the BUILD run are ordinary Keep Going runs,
// created via the SAME createOvernightRun and advanced via the SAME
// tickKeepGoingRun every other real caller (HTTP routes, the fleet
// driver, settled-run-reconciler.mjs) already uses -- so the resource
// governor, execution-hold gate, capacity check, retry budget, stall
// detection, and zero-relay worker-ask escalation all apply to both,
// unmodified, for free. This module only sequences two Keep Going runs
// and reads one file the CHALLENGE worker is asked to write.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { readResearchMissionArtifacts, readResearchMissionStatus } from './research-mission-driver.mjs'
import { withKeepGoingRun, readKeepGoingRun } from './keep-going-run-store.mjs'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import { driveOneCycle } from './keep-going-fleet-driver.mjs'
import { buildResearchDrivenMissionSpec } from '../domain/research-driven-development.mjs'

const RUN_TERMINAL_STATES = new Set(['COMPLETE', 'STALLED', 'NEEDS_YOU', 'BLOCKED'])

// Real adversarial-review finding: a dispatch refused before any real
// wave ever went in flight (resource pressure, an execution hold, a
// claim race, or a real task-create/worker-start failure) previously
// left `run.inFlightWave` falsy, which tickUntilWaveSettled's own
// "no wave in flight" check read as an already-SETTLED (i.e. successful)
// CHALLENGE -- silently starting the real BUILD run with an empty,
// unreviewed finding set and no visible signal CHALLENGE never actually
// ran at all.
const DISPATCH_NEVER_STARTED_ACTIONS = new Set([
  'DISPATCH_WAITING_FOR_RESOURCES',
  'DISPATCH_BLOCKED_BY_HOLD',
  'DISPATCH_FAILED',
  'DISPATCH_CLAIM_FAILED',
  'DISPATCH_SKIPPED_LOW_CAPACITY'
])

// Real caller reads the exact file name a CHALLENGE worker's task spec
// (below) instructs it to write -- both sides of this contract live in
// this one module so they cannot silently drift apart.
export const CHALLENGE_FINDINGS_FILENAME = 'challenge-findings.json'

// The sandbox-escalation guidance a real worker's own worker_done self-
// report needs (see keep-going-dispatch-loop.mjs's own SANDBOX_ESCALATION_NOTE
// for the full story) is now appended ONCE, centrally, to every real
// dispatched task's spec by dispatchStep itself -- not duplicated here.
function challengeTaskSpec(draftAcceptanceCriteria) {
  return [
    'CHALLENGE step, TSF Research-Driven Development V1: you are reviewing a',
    'PROPOSED spec for an upcoming build, BEFORE any code is written. Do not',
    'write or edit any project source files. Your only job is to adversarially',
    'challenge the proposed acceptance criteria below -- find gaps, false',
    'groundings, missing edge cases, or criteria that contradict each other or',
    'existing project capability.',
    '',
    'Proposed acceptance criteria (each cites the real research finding or',
    'earlier challenge finding it came from):',
    ...draftAcceptanceCriteria.map((c) => `- ${c}`),
    '',
    `Write your findings as JSON to a file named ${CHALLENGE_FINDINGS_FILENAME} in`,
    'your working directory: a JSON array, each entry',
    '{"id": string, "severity": "MUST_FIX" | "ADVISORY", "summary": string}.',
    'An empty array is an honest, acceptable result if you find nothing real to',
    'challenge -- never fabricate a finding to have something to report.'
  ].join('\n')
}

// CHALLENGE is a one-shot review task, not a run this codebase's own
// acceptance-criteria/verification machinery needs to judge -- "the wave
// settled" (the worker's task reached a terminal status) is ALL this
// waits for, deliberately short of full run COMPLETE (which would drag
// in settled-run-reconciler.mjs's real git-evidence verification, built
// for judging actual code changes against acceptance criteria, not a
// findings-file review). Dispatches ONCE via tickKeepGoingRun (the real
// first-wave dispatch, matching every real caller's own convention), then
// repeatedly ticks with an EMPTY candidateWorkItems -- the exact settle-
// only convention keep-going-fleet-driver.mjs's own advanceOneProject
// uses ("candidateWorkItems is irrelevant on the settle path"). No new
// polling primitive: this is a bounded caller loop around the SAME
// tickKeepGoingRun every real caller already uses, bounded because this
// caller is not a persistent service and must eventually give up
// honestly rather than hang forever.
export async function tickUntilWaveSettled(
  projectId,
  candidateWorkItems,
  clock,
  { maxTicks = 60, pollIntervalMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  let last = await tickKeepGoingRun(projectId, candidateWorkItems, clock)
  for (let i = 0; i < maxTicks; i++) {
    const run = readKeepGoingRun(projectId)
    if (!run || !run.inFlightWave) {
      return { run, lastTickResult: last }
    }
    await sleep(pollIntervalMs)
    last = await tickKeepGoingRun(projectId, [], clock)
  }
  return { run: readKeepGoingRun(projectId), lastTickResult: last, timedOut: true }
}

// The REAL BUILD run's convergence loop: dispatches the first wave (the
// one real judgment call this codebase leaves to Command/chat at Start
// time -- matches keep-going-fleet-driver.mjs's own disclosed scope
// boundary exactly), then repeatedly calls driveOneCycle -- the SAME
// function the real persistent fleet driver calls on its own 30s
// interval -- which settles waves, dispatches real independent
// verification against the worktree's own real evidence, and only then
// completes the run or raises Needs You. Zero new dispatch/verification
// code: this is a bounded caller loop around the real driver's own
// single-cycle primitive.
export async function driveUntilTerminal(
  projectId,
  firstWaveCandidateWorkItems,
  clock,
  { maxCycles = 60, pollIntervalMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), driverDeps = {} } = {}
) {
  await tickKeepGoingRun(projectId, firstWaveCandidateWorkItems, clock)
  for (let i = 0; i < maxCycles; i++) {
    const run = readKeepGoingRun(projectId)
    if (!run || RUN_TERMINAL_STATES.has(run.state)) {
      return { run }
    }
    await driveOneCycle([projectId], clock, driverDeps)
    await sleep(pollIntervalMs)
  }
  return { run: readKeepGoingRun(projectId), timedOut: true }
}

// Fail-closed judgment of whether the CHALLENGE dispatch genuinely,
// really ran to a real COMPLETED task outcome -- never inferred merely
// from "no wave is in flight right now" (true for "never dispatched at
// all" and "dispatched, then FAILED" alike, not just for "ran and
// succeeded"). Returns a real, typed reason for every way this can be
// honestly false; a caller must never proceed to BUILD without checking
// this first.
function assessChallengeCompletion(challengeRunFinal, lastTickResult, timedOut, workItemId) {
  if (timedOut) {
    return { ok: false, reason: 'CHALLENGE_TIMED_OUT' }
  }
  if (lastTickResult && DISPATCH_NEVER_STARTED_ACTIONS.has(lastTickResult.action)) {
    return { ok: false, reason: 'CHALLENGE_NOT_DISPATCHED', detail: lastTickResult }
  }
  const outcome = challengeRunFinal?.waves
    ?.flatMap((w) => w.waveResult?.outcomes ?? [])
    .find((o) => o.workItemId === workItemId)
  if (!outcome) {
    return { ok: false, reason: 'CHALLENGE_NEVER_DISPATCHED', detail: lastTickResult }
  }
  if (outcome.outcome !== 'COMPLETED') {
    return { ok: false, reason: 'CHALLENGE_TASK_FAILED', detail: outcome }
  }
  return { ok: true }
}

// Honest, never-fabricated read: a missing/malformed findings file is
// reported as an empty array plus a real warning, never silently treated
// as "the worker found nothing" (a different, stronger claim than "we
// could not read what it wrote").
export function readChallengeFindings(worktree) {
  const findingsPath = path.join(worktree, CHALLENGE_FINDINGS_FILENAME)
  if (!existsSync(findingsPath)) {
    return { findings: [], warning: `no ${CHALLENGE_FINDINGS_FILENAME} found at ${findingsPath}` }
  }
  try {
    const parsed = JSON.parse(readFileSync(findingsPath, 'utf8'))
    if (!Array.isArray(parsed)) {
      return { findings: [], warning: `${findingsPath} did not contain a JSON array` }
    }
    return { findings: parsed, warning: null }
  } catch (error) {
    return { findings: [], warning: `${findingsPath} could not be parsed: ${error.message}` }
  }
}

// The one real entry point. Reads a COMPLETE, integrity-checked
// ResearchMission's own provenance package, runs a disposable CHALLENGE
// run against the draft spec it grounds, then starts the real BUILD run
// with the challenge-resolved final spec. Every failure mode here is
// reported honestly (a typed reason), never a fabricated run.
export async function startResearchDrivenRun(
  projectId,
  researchMissionId,
  {
    clock,
    challengeWorktree,
    challengeWorkItemId = 'research-driven-challenge',
    buildRunId,
    originalGoalSummary,
    tickOptions = {}
  } = {}
) {
  // Real adversarial-review finding: readResearchMissionArtifacts
  // integrity-checks individual CanonicalFacts but never checks the
  // MISSION's own state -- an ACTIVE, still-in-progress mission that
  // happens to already have one real, valid CanonicalFact could
  // otherwise start a real BUILD run grounded in research that has not
  // actually finished. "One real fact exists" is not the same claim as
  // "this research is done."
  const status = readResearchMissionStatus(researchMissionId)
  if (!status) {
    return { ok: false, reason: 'RESEARCH_MISSION_NOT_FOUND', detail: researchMissionId }
  }
  if (status.state !== 'COMPLETE') {
    return { ok: false, reason: 'RESEARCH_MISSION_NOT_COMPLETE', detail: status.state }
  }
  const artifacts = readResearchMissionArtifacts(researchMissionId, clock)
  if (!artifacts) {
    return { ok: false, reason: 'RESEARCH_MISSION_NOT_FOUND', detail: researchMissionId }
  }
  const { packageBody } = artifacts
  let draftSpec
  try {
    draftSpec = buildResearchDrivenMissionSpec({
      researchMissionId,
      projectId,
      researchPackageBody: packageBody,
      resolvedChallengeFindings: [],
      originalGoalSummary,
      createdAt: clock ? clock().toISOString() : undefined
    })
  } catch (error) {
    return { ok: false, reason: 'RESEARCH_NOT_GROUNDED', detail: error.message }
  }

  // CHALLENGE: a disposable Keep Going run on the SAME project, ahead of
  // the real build run -- reuses createOvernightRun/tickKeepGoingRun
  // unmodified. The real build run below is created for the same
  // projectId immediately after this one reaches a terminal state, which
  // durably replaces it (one Keep Going run per project, by design) --
  // never left as a stray "run" a caller could mistake for real project
  // work in progress.
  if (!challengeWorktree) {
    return { ok: false, reason: 'INVALID_ARGS', detail: 'challengeWorktree is required for the CHALLENGE dispatch' }
  }
  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      {
        id: `research-driven-challenge-${researchMissionId}`,
        projectId,
        originalGoal:
          'CHALLENGE step: adversarially review the proposed research-grounded spec before build begins. Do not edit source files.',
        acceptanceCriteria: [`Write ${CHALLENGE_FINDINGS_FILENAME} with real, evidenced findings (or an honest empty array).`],
        usageMode: 'BALANCED'
      },
      clock
    )
  )
  const challengeWorkItem = [
    {
      id: challengeWorkItemId,
      scope: [CHALLENGE_FINDINGS_FILENAME],
      worktree: challengeWorktree,
      // Real field dispatchStep already reads (keep-going-dispatch-loop.mjs:554,
      // `spec: item.spec ?? item.id`) -- not an invented parameter.
      spec: challengeTaskSpec(draftSpec.acceptanceCriteria)
    }
  ]
  const { run: challengeRunFinal, lastTickResult: challengeLastTickResult, timedOut: challengeTimedOut } =
    await tickUntilWaveSettled(projectId, challengeWorkItem, clock, tickOptions)

  const completion = assessChallengeCompletion(challengeRunFinal, challengeLastTickResult, challengeTimedOut, challengeWorkItemId)
  if (!completion.ok) {
    return { ok: false, reason: completion.reason, detail: completion.detail }
  }
  const { findings: rawFindings, warning: findingsWarning } = readChallengeFindings(challengeWorktree)
  if (findingsWarning) {
    // The task genuinely completed, but its one required output either
    // never showed up or was unreadable -- proceeding with a silently
    // empty finding set here would let the real BUILD run's own spec
    // falsely claim "no findings" for a CHALLENGE that may have found
    // real issues nobody can now see. Fail closed instead.
    return { ok: false, reason: 'CHALLENGE_FINDINGS_UNREADABLE', detail: findingsWarning }
  }

  let finalSpec
  try {
    finalSpec = buildResearchDrivenMissionSpec({
      researchMissionId,
      projectId,
      researchPackageBody: packageBody,
      resolvedChallengeFindings: rawFindings,
      originalGoalSummary,
      createdAt: clock ? clock().toISOString() : undefined
    })
  } catch (error) {
    return { ok: false, reason: 'RESEARCH_NOT_GROUNDED', detail: error.message }
  }

  const buildRun = await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      {
        id: buildRunId ?? `research-driven-build-${researchMissionId}`,
        projectId,
        originalGoal: originalGoalSummary ?? `Research-driven build for research mission ${researchMissionId}`,
        acceptanceCriteria: finalSpec.acceptanceCriteria,
        usageMode: 'BALANCED',
        missionSpec: finalSpec
      },
      clock
    )
  )

  return {
    ok: true,
    run: buildRun,
    missionSpec: finalSpec,
    challenge: {
      run: challengeRunFinal,
      timedOut: Boolean(challengeTimedOut),
      findings: rawFindings,
      warning: findingsWarning
    }
  }
}
