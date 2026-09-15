// TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: classifies a project/run id as
// CONFIRMED_TEST_FIXTURE_POLLUTION only when every independent signal below
// agrees -- see docs/tsf/TSF_FIXTURE_POLLUTION_RECONCILIATION_V1.md for the
// incident this exists to safely clean up. A record failing any signal is
// AMBIGUOUS_REQUIRES_OWNER, never auto-cleaned. This module makes no I/O
// calls and mutates nothing -- callers decide what to do with a
// classification.

// tsf/test/command-operator-integration-adversarial.test.mjs's own id
// scheme: mkdtempSync(path.join(tmpdir(), `tsf-command-operator-
// integration-${name}-`)) with name in {nytheria-target, nytheria-keep,
// nytheria-exclude} (and the analogous worldforge names the same test file
// convention uses elsewhere in this codebase).
const FIXTURE_ID_PATTERN =
  /^tsf-command-operator-integration-(nytheria|worldforge)-(target|keep|exclude)-[0-9a-z]{6}$/

// fixtures/stub-planner-cli.mjs's own literal stub output.
const FIXTURE_GOAL_MARKER = 'stub-plan-for::'
const FIXTURE_ACCEPTANCE_CRITERION = 'stub acceptance criterion'
const FIXTURE_EVIDENCE_MARKER = 'stub-task-id'

// The test file's own literal scripted chat lines -- a fixture project's
// chat thread (if any) must contain ONLY these, never owner-authored text.
const KNOWN_FIXTURE_CHAT_LINES = new Set([
  'push nytheria to production',
  'yes, go ahead and get nytheria ready',
  "what's going on with nytheria?",
  'go ahead and fix nytheria, not worldforge-two'
])

export function matchesFixtureIdScheme(id) {
  return FIXTURE_ID_PATTERN.test(id)
}

// mkdtempSync's own real output shape: the tmpdir prefix plus 6 mixed-case
// alphanumeric characters, with the SAME id (case-folded) as the suffix.
function repoPathIsDisposableTempFixture(onboarded) {
  const repoPath = onboarded?.repoPath
  if (typeof repoPath !== 'string') {
    return false
  }
  return /[\\/](Temp|tmp)[\\/]tsf-command-operator-integration-(nytheria|worldforge)-(target|keep|exclude)-[A-Za-z0-9]{6}$/.test(
    repoPath
  )
}

// null = no Keep Going run exists for this candidate (the onboarding-only
// "exclude" bucket never gets one, by the test's own design) -- treated as
// non-disqualifying, not as a pass on its own. Reads the REAL raw
// keep-going.mjs TSF_OVERNIGHT_RUN_V1 shape -- goal/acceptanceCriteria live
// under originalGoal, and checkpoints is an append-only array (the LAST
// entry is the equivalent of the HTTP-projected "lastCheckpoint" field).
function goalMatchesFixtureContent(run) {
  if (!run) {
    return null
  }
  const statement = run.originalGoal?.statement
  const acceptanceCriteria = run.originalGoal?.acceptanceCriteria
  const goalOk = typeof statement === 'string' && statement.startsWith(FIXTURE_GOAL_MARKER)
  const criteriaOk =
    Array.isArray(acceptanceCriteria) &&
    acceptanceCriteria.length === 1 &&
    acceptanceCriteria[0] === FIXTURE_ACCEPTANCE_CRITERION
  const lastCheckpoint = Array.isArray(run.checkpoints) ? run.checkpoints.at(-1) : null
  const evidenceOk = Boolean(lastCheckpoint?.evidence?.includes(FIXTURE_EVIDENCE_MARKER))
  return goalOk && criteriaOk && evidenceOk
}

function timestampIsPlausibleTestRun(createdAt, { notBefore, now = new Date() } = {}) {
  if (!createdAt) {
    return false
  }
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) {
    return false
  }
  if (notBefore && created < notBefore) {
    return false
  }
  return created <= now
}

function chatThreadIsScriptedFixtureDialogue(thread) {
  if (thread == null) {
    return true
  }
  if (!Array.isArray(thread)) {
    return false
  }
  return thread.every((msg) => msg.role !== 'user' || KNOWN_FIXTURE_CHAT_LINES.has(msg.content))
}

// A record with any of these real-authority markers has plausible
// legitimate owner activity attached to it and must never be auto-cleaned,
// regardless of how strongly its id/content/timing look like a fixture.
// Deliberately does NOT check portfolio.projects/onboardedProjects
// membership -- fixture pollution registers there too (that IS the
// incident), so mere presence there is not evidence of legitimacy. Only
// signals an owner would have to deliberately create -- a hold, a
// canonical base, or curating the project onto activeFleet/workSet -- count
// as real activity here.
function hasNoLegitimateOwnerActivity(state, id) {
  const hold = state.projectExecutionHolds?.[id]
  const canonicalBase = state.projectCanonicalBases?.[id]
  const inActiveFleet =
    Array.isArray(state.portfolio?.activeFleet) && state.portfolio.activeFleet.includes(id)
  const inWorkSet = Array.isArray(state.portfolio?.workSet) && state.portfolio.workSet.includes(id)
  return !hold && !canonicalBase && !inActiveFleet && !inWorkSet
}

// Enumerates every id, across the collections a fixture project could ever
// appear in, that matches the fixture naming scheme -- the starting
// candidate set BEFORE per-record signal verification.
export function findFixturePollutionCandidateIds(state) {
  const ids = new Set()
  for (const collection of ['keepGoingRuns', 'onboardedProjects', 'chatThreads']) {
    for (const key of Object.keys(state[collection] || {})) {
      if (matchesFixtureIdScheme(key)) {
        ids.add(key)
      }
    }
  }
  return [...ids].sort()
}

export function classifyFixturePollutionCandidate(id, state, opts = {}) {
  const onboarded = state.onboardedProjects?.[id]
  const run = state.keepGoingRuns?.[id]
  const thread = state.chatThreads?.[id]

  const signals = {
    idSchemeMatch: matchesFixtureIdScheme(id),
    existsInOnboardedProjects: onboarded != null,
    repoPathMatch: repoPathIsDisposableTempFixture(onboarded),
    goalContentMatch: goalMatchesFixtureContent(run),
    timestampPlausible: timestampIsPlausibleTestRun(
      run?.createdAt || onboarded?.lastAnalysis?.analyzedAt,
      opts
    ),
    chatScripted: chatThreadIsScriptedFixtureDialogue(thread),
    noLegitimateActivity: hasNoLegitimateOwnerActivity(state, id)
  }

  const confirmed =
    signals.idSchemeMatch &&
    signals.existsInOnboardedProjects &&
    signals.repoPathMatch &&
    signals.goalContentMatch !== false &&
    signals.timestampPlausible &&
    signals.chatScripted &&
    signals.noLegitimateActivity

  return {
    id,
    classification: confirmed ? 'CONFIRMED_TEST_FIXTURE_POLLUTION' : 'AMBIGUOUS_REQUIRES_OWNER',
    signals
  }
}
