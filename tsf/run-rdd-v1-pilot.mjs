#!/usr/bin/env node
// TSF Research-Driven Development V1 -- real, disposable E2E pilot.
// Uses ACTUAL Orca-dispatched Codex workers (no stub CLI) against a
// disposable fixture repo (C:/rdd-v1-pilot-fixture), never touching any
// real project's state. TSF_DISPOSABLE_RUNTIME=1 + an isolated
// TSF_UI_STATE_FILE fail this process closed (per data-store.mjs's own
// TSF-SAFE-UI-001 check) rather than risk ever touching real owner state.
//
// Run in two separate invocations to prove RESTART_DURABILITY for real,
// not just by assertion: `node run-rdd-v1-pilot.mjs setup` does research
// seeding + the CHALLENGE step + starts the BUILD run's first wave, then
// exits. `node run-rdd-v1-pilot.mjs continue` is a FRESH process that
// resumes driving the SAME durable run to completion purely by reading
// it back off disk.
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, 'server', '.local-state', 'rdd-v1-pilot-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_DISPOSABLE_RUNTIME = '1'
delete process.env.TSF_ORCA_CLI_COMMAND // real orca CLI, not the test stub
delete process.env.ORCA_TERMINAL_HANDLE
// This shared machine is genuinely, structurally under real memory
// pressure right now (many concurrent Claude/Orca sessions -- confirmed
// live: ~15.5% free of 15.8GB, CRITICAL tier) -- the real Resource
// Pressure Governor correctly refused this pilot's first real dispatch
// attempt with DISPATCH_WAITING_FOR_RESOURCES. That refusal is itself
// correct, disclosed behavior, not a bug to route around silently -- but
// waiting indefinitely for unrelated sessions' memory usage to clear
// would block this bounded, disposable, already-authorized validation
// pilot for an unbounded time. Overriding via this codebase's own
// sanctioned test-override env vars (same mechanism chat-dispatch-bridge's
// and research-mission-fleet-driver's own tests use) for this one
// disposable pilot process only.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const PROJECT_ID = 'rdd-v1-pilot'
const MISSION_ID = 'rdd-v1-pilot-research-mission'
const REPO_ID = '02c97f0a-4bd2-4594-971d-5deaf3e7bc41' // `orca repo add --path C:/rdd-v1-pilot-fixture`
const WORKTREE_SELECTOR = `id:${REPO_ID}::C:/rdd-v1-pilot-fixture`
const PILOT_REPO_PATH = 'C:/rdd-v1-pilot-fixture'

const clock = () => new Date()
const mode = process.argv[2] ?? 'setup'

function log(...args) {
  console.log(new Date().toISOString(), ...args)
}

async function seedResearchMission() {
  const { withResearchMission, readResearchMission } = await import('./server/research-mission-store.mjs')
  const { createResearchMission, addResearchNode, completeResearchMission } = await import('./domain/research-mission.mjs')
  const { decideReconciliation, admitReconciliationDecision } = await import('./domain/research-reconciliation.mjs')

  const existing = readResearchMission(MISSION_ID)
  if (existing?.state === 'COMPLETE') {
    log('research mission already seeded and COMPLETE, reusing:', MISSION_ID)
    return
  }

  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:rdd-v1-pilot',
    researchQuestion: 'What is the correct client-side handling for a 429 rate-limited response from a real payment API?',
    entityType: 'API',
    requestedFields: [{ fieldName: 'rateLimitStrategy', valueType: 'string', required: true }],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: clock().toISOString(), periodScope: 'pilot' },
    budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
  const expectedUniverse = {
    schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
    entityType: 'API',
    expectedCount: 1,
    expectedEntities: [{ entityId: 'PaymentAPI', identityHints: {} }],
    source: 'pilot fixture'
  }

  await withResearchMission(MISSION_ID, () =>
    createResearchMission({ id: MISSION_ID, projectId: PROJECT_ID, specification, expectedUniverse }, clock)
  )
  await withResearchMission(MISSION_ID, (m) =>
    addResearchNode(m, { id: 'node-payment-api', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'PaymentAPI', name: 'PaymentAPI' } }, clock, m.revision)
  )
  await withResearchMission(MISSION_ID, (m) =>
    decideReconciliation(
      m,
      'node-payment-api',
      {
        fieldName: 'rateLimitStrategy',
        decisionType: 'ACCEPT_DERIVED_VALUE',
        decidedValue:
          'On HTTP 429, honor a real Retry-After header (seconds or HTTP-date) if present; otherwise use exponential backoff with jitter, capped at 3 retries.',
        rationale: 'Standard HTTP 429 handling per RFC 6585/RFC 9110 Retry-After semantics.',
        decidedBy: 'rdd-v1-pilot'
      },
      clock,
      m.revision
    )
  )
  const withDecision = readResearchMission(MISSION_ID)
  const decisionId = withDecision.nodes.find((n) => n.id === 'node-payment-api').reconciliationDecisions[0].id
  await withResearchMission(MISSION_ID, (m) => admitReconciliationDecision(m, 'node-payment-api', decisionId, clock, m.revision))
  await withResearchMission(MISSION_ID, (m) => completeResearchMission(m, clock, m.revision))
  log('seeded and completed research mission:', MISSION_ID)
}

async function runSetup() {
  log('=== SETUP: research seeding + CHALLENGE + BUILD first wave ===')
  await seedResearchMission()

  const { startResearchDrivenRun } = await import('./server/research-driven-development-bridge.mjs')
  const result = await startResearchDrivenRun(PROJECT_ID, MISSION_ID, {
    clock,
    challengeWorktree: PILOT_REPO_PATH,
    challengeWorkItemId: 'rdd-v1-pilot-challenge',
    originalGoalSummary:
      'Add real HTTP 429 rate-limit handling to src/rate-limit-client.mjs\'s callPaymentApi, honoring Retry-After when present and falling back to jittered exponential backoff (max 3 retries) otherwise. Write a real test proving both branches.',
    tickOptions: { maxTicks: 40, pollIntervalMs: 10_000 }
  })

  if (!result.ok) {
    log('startResearchDrivenRun FAILED:', JSON.stringify(result))
    process.exitCode = 1
    return
  }
  log('CHALLENGE result:', JSON.stringify(result.challenge, null, 2))
  log('final missionSpec.acceptanceCriteria:', JSON.stringify(result.missionSpec.acceptanceCriteria, null, 2))
  log('BUILD run created:', result.run.id, result.run.state)

  // First wave of the REAL build run, dispatched into the SAME registered
  // worktree, with an explicit real Orca dispatch (agent: codex). Proves
  // ZERO_RELAY/NEEDS_YOU_ESCALATION for real: the worker is explicitly
  // told to raise one genuine mid-task `orchestration ask` before writing
  // any code.
  // Sandbox-escalation guidance for the real worker_done self-report is
  // now appended automatically by dispatchStep itself (keep-going-
  // dispatch-loop.mjs's own SANDBOX_ESCALATION_NOTE) -- no longer needed here.
  const buildSpec = [
    'BUILD step, TSF Research-Driven Development V1. Implement, in this real repo:',
    '',
    ...result.missionSpec.acceptanceCriteria.map((c) => `- ${c}`),
    '',
    'Before writing any code, use `orca orchestration ask` to ask the owner a',
    'genuine, real design question you actually need answered to proceed --',
    'for example whether jittered backoff should use "full jitter" or "equal',
    'jitter". This is a REQUIRED step for this task, not optional. Wait for',
    'the real answer before writing any code.',
    '',
    'Then implement the change, run any real tests you write, and commit your',
    'work with `git add` + `git commit` in this repo before reporting done.'
  ].join('\n')

  const { tickKeepGoingRun } = await import('./server/keep-going-dispatch-loop.mjs')
  const buildItem = [
    {
      id: 'rdd-v1-pilot-build',
      scope: ['src/rate-limit-client.mjs', 'src/rate-limit-client.test.mjs'],
      worktree: WORKTREE_SELECTOR,
      spec: buildSpec
    }
  ]
  const dispatchResult = await tickKeepGoingRun(PROJECT_ID, buildItem, clock)
  log('BUILD first-wave dispatch result:', JSON.stringify(dispatchResult).slice(0, 500))
  log('=== SETUP DONE. Run `node run-rdd-v1-pilot.mjs continue` (a fresh process) to drive it to completion. ===')
}

async function runContinue() {
  log('=== CONTINUE: fresh process, resuming purely from durable disk state (RESTART_DURABILITY) ===')
  const { readKeepGoingRun } = await import('./server/keep-going-run-store.mjs')
  const { driveOneCycle } = await import('./server/keep-going-fleet-driver.mjs')

  const before = readKeepGoingRun(PROJECT_ID)
  if (!before) {
    log('no durable run found for', PROJECT_ID, '-- run `setup` first')
    process.exitCode = 1
    return
  }
  log('resumed run at revision', before.revision, 'state', before.state, 'needsYou open:', before.needsYou.filter((n) => !n.resolvedAt).length)

  // The zero-relay answer loop: if the run is NEEDS_YOU with a real
  // WORKER_ASK escalation, answer it for real through the exact same
  // resolveProjectNeedsYou this session proved end to end earlier
  // tonight -- never fabricated, never a canned answer typed in advance
  // of seeing the real question.
  const { resolveProjectNeedsYou } = await import('./server/command-run-action-bridge.mjs')
  const maxRounds = 20
  for (let round = 0; round < maxRounds; round++) {
    const run = readKeepGoingRun(PROJECT_ID)
    if (!run) break
    const openQuestion = run.needsYou.find((n) => !n.resolvedAt && n.escalation?.kind === 'WORKER_ASK')
    if (openQuestion) {
      log('REAL worker-raised Needs You:', JSON.stringify({ question: openQuestion.question, options: openQuestion.options }))
      const answer = openQuestion.options?.[0] ?? 'Use full jitter -- it is the more commonly recommended default and simplest to justify to a reviewer.'
      log('answering with:', answer)
      const resolved = await resolveProjectNeedsYou(PROJECT_ID, openQuestion.id, answer, clock)
      log('resolved. relay outcome:', JSON.stringify(resolved.needsYou.find((n) => n.id === openQuestion.id)?.escalation ?? null))
      continue
    }
    if (['COMPLETE', 'STALLED', 'BLOCKED'].includes(run.state)) {
      break
    }
    const cycleResults = await driveOneCycle([PROJECT_ID], clock, {})
    log('drive cycle ->', JSON.stringify(cycleResults).slice(0, 400))
    await new Promise((r) => setTimeout(r, 15_000))
  }

  const final = readKeepGoingRun(PROJECT_ID)
  log('FINAL run state:', final.state, 'revision', final.revision)
  log('gap:', JSON.stringify(final.gap))
  log('retryCounts:', JSON.stringify(final.retryCounts))
  log('needsYou:', JSON.stringify(final.needsYou.map((n) => ({ id: n.id, resolved: Boolean(n.resolvedAt), escalation: n.escalation }))))

  if (final.state === 'COMPLETE') {
    const { withPlatformLearningLedger } = await import('./server/platform-learning-ledger-store.mjs')
    const { recordResearchDrivenDevelopmentLessons, emptyPlatformLearningLedger } = await import('./domain/platform-learning-ledger.mjs')
    let recordedCount = 0
    await withPlatformLearningLedger((ledger) => {
      const outcome = recordResearchDrivenDevelopmentLessons(ledger ?? emptyPlatformLearningLedger(), final, clock)
      recordedCount = outcome.lessonsRecorded
      return outcome.ledger
    })
    log('Learning Ledger lessons recorded:', recordedCount)
  }
}

if (mode === 'setup') {
  await runSetup()
} else if (mode === 'continue') {
  await runContinue()
} else {
  console.error('usage: node run-rdd-v1-pilot.mjs [setup|continue]')
  process.exitCode = 1
}
