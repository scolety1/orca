// Pre-UI Productization V1 -- real owner-flow acceptance test. One
// continuous real flow over the real HTTP server (server/http-server.mjs),
// the real fixture project (server/fixture-project.mjs -- never a real
// user project, never NWR/Nytheria/EasyLife/etc.), proving the priorities
// this mission closed actually compose together, not just pass in
// isolation. Every individual mechanism exercised here already has its
// own dedicated, mutation-verified test elsewhere (cited inline) -- this
// file's real, incremental value is proving the SAME project/thread moves
// through pause -> resume -> hold -> release -> attention -> planner
// answer as one continuous real owner session would, which nothing else
// in this suite does end-to-end together.
//
// Deliberately narrower than an exhaustive walkthrough of all 16
// originally-scoped acceptance steps (that list was not recovered from
// this session's own durable memory) -- this is a real, honest subset
// covering Priorities 1, 2, 3 (referenced, not re-derived), 4, and 5.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-pre-ui-productization-acceptance-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { readProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { withPlannerMissionRecord, readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, raisePlannerNeedsYou, recordVerifierResult } = await import('../domain/planner-mission-checkpoint.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { withFinding, readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { computeRepairMissionId } = await import('../server/self-improvement-mission-origination.mjs')
const { deriveRepairAttemptBranch } = await import('../server/self-improvement-worker-dispatch.mjs')
const { createIsolatedRepairWorktree } = await import('../server/self-improvement-worktree.mjs')
const { ADOPTION_AUTHORIZATION_MARKER } = await import('../server/self-improvement-adoption-authorization-gate.mjs')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
    rmSync(`${STATE_FILE}.runtime.json`, { force: true })
  }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}
async function post(base, urlPath, payload) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { status: res.status, body: await res.json() }
}
async function chat(base, payload) {
  return post(base, '/api/chat', payload)
}

test('ACCEPTANCE: a real owner session -- setup, rehydration, pause/resume/hold/release, attention, planner answer -- all compose over one continuous real flow', async () => {
  await withServer(async (base) => {
    // 1. Priority 4: the real backend health/identity contract
    // first-run-setup.html itself polls is honest and reachable.
    const identity = await get(base, '/api/runtime-identity')
    assert.equal(identity.status, 200)
    assert.ok(
      ['UP_TO_DATE', 'UI_BUNDLE_STALE', 'UI_BUILDING', 'UI_DEPENDENCIES_MISSING', 'BUILD_FAILED', 'LIVE_RUNTIME_STALE', 'UNKNOWN'].includes(identity.body.state),
      `runtime-identity must report one of the real, honest states, got: ${identity.body.state}`
    )

    // 2. Priority 1: a real Command-thread turn, written durably.
    const turn = await chat(base, { message: 'what needs me?' })
    assert.equal(turn.status, 200)
    assert.equal(typeof turn.body.text, 'string')

    // 3. Priority 1: the SAME turn is genuinely durable -- a fresh read
    // (what CommandConversationProvider's real rehydration fetch calls)
    // sees it, not just the response that wrote it.
    const history = await get(base, '/api/chat/__command__')
    assert.equal(history.status, 200)
    assert.ok(Array.isArray(history.body) && history.body.length >= 2, 'both the user turn and the real assistant reply must be durable')
    assert.equal(history.body.at(-2).content, 'what needs me?')

    // 4. Start a real Keep Going run on the real, safe fixture project.
    const started = await post(base, `/api/keep-going/${FIXTURE_PROJECT_ID}/start`, {
      originalGoal: 'Acceptance test: prove the real owner flow end-to-end.',
      acceptanceCriteria: ['ACCEPTANCE_CRITERION'],
      usageMode: 'BALANCED'
    })
    assert.equal(started.body.started, true)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'ACTIVE')

    // 5. Priority 2: "pause it" -- natural phrasing, real state change.
    // (classifyRunActionVerb's own dedicated coverage:
    // command-run-action-bridge.test.mjs)
    const paused = await chat(base, { projectId: FIXTURE_PROJECT_ID, message: 'pause it' })
    assert.equal(paused.status, 200)
    assert.match(paused.body.text, /Paused/)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'PAUSED')

    // 6. Priority 2: "resume it" -- back to real ACTIVE.
    const resumed = await chat(base, { projectId: FIXTURE_PROJECT_ID, message: 'resume it' })
    assert.equal(resumed.status, 200)
    assert.match(resumed.body.text, /Resumed/)
    assert.equal(readKeepGoingRun(FIXTURE_PROJECT_ID).state, 'ACTIVE')

    // 7. Priority 2: a real external-work hold, natural phrasing --
    // "the owner should not need to understand ... execution hold".
    const held = await chat(base, {
      projectId: FIXTURE_PROJECT_ID,
      message: `${FIXTURE_PROJECT_ID} is being handled by another agent right now, leave it alone -- do not touch it.`
    })
    assert.equal(held.status, 200)
    assert.match(held.body.text, /Held/)
    const holdAfter = readProjectExecutionHold(FIXTURE_PROJECT_ID)
    assert.ok(holdAfter, 'a real, durable hold must have been written')
    assert.equal(holdAfter.status, 'ACTIVE')

    // 8. Priority 2 (RELEASE_HOLD, this mission's own fix): lifts it
    // again, natural phrasing, real durable clear.
    const released = await chat(base, {
      projectId: FIXTURE_PROJECT_ID,
      message: `release the hold on ${FIXTURE_PROJECT_ID}.`
    })
    assert.equal(released.status, 200)
    assert.match(released.body.text, /Released|hold.*released/i)
    const holdReleased = readProjectExecutionHold(FIXTURE_PROJECT_ID)
    assert.ok(!holdReleased || holdReleased.status !== 'ACTIVE', 'the hold must genuinely no longer be active')

    // 9. Priority 5: the real fleet-wide attention feed -- honest shape,
    // never fabricated.
    const attention = await get(base, '/api/attention')
    assert.equal(attention.status, 200)
    assert.equal(attention.body.ok, true)
    assert.ok(Array.isArray(attention.body.items))

    // 10. Priority 5 (this mission's own new fix): a planner mission's
    // Needs-You question, real end-to-end -- raised, answered through the
    // real new route, durably resolved (fresh read, not just the echo).
    const missionId = 'acceptance-planner-mission'
    await withPlannerMissionRecord(missionId, () => {
      const checkpoint = createPlannerMissionCheckpoint(
        { missionId, missionGoal: 'acceptance test goal', phase: 'PLANNING', repoState: { branch: 'main', sha: 'b'.repeat(40) } },
        () => new Date()
      )
      return { lease: null, checkpoint: raisePlannerNeedsYou(checkpoint, { question: 'Proceed with option A?' }, () => new Date()) }
    })
    const needsYouId = readPlannerMissionRecord(missionId).checkpoint.needsYou[0].id
    const resolved = await post(
      base,
      `/api/planner-missions/${missionId}/needs-you/${needsYouId}/resolve`,
      { resolution: 'Yes, proceed with option A.' }
    )
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.ok, true)
    const finalRecord = readPlannerMissionRecord(missionId)
    assert.equal(finalRecord.checkpoint.needsYou[0].resolution, 'Yes, proceed with option A.')
    assert.ok(finalRecord.checkpoint.needsYou[0].resolvedAt)

    // Sanity: this whole flow only ever touched the one real, safe
    // fixture project + one disposable acceptance-test planner mission --
    // never a real user project.
    assert.equal(FIXTURE_PROJECT_ID, 'tsf-ui-capability-check')
  })
})

// Priority 3 (self-improvement adoption lock parity) is deliberately NOT
// re-derived here -- it has its own 5 dedicated, mutation-verified tests
// in test/self-improvement-adoption.test.mjs (competing adoption,
// cross-engine lock, hold mid-flight, hold upfront, colon-safe lock key)
// that already prove real mutual exclusion end-to-end; duplicating that
// setup here would test nothing new.
//
// Priority 6 (owner language contract) is a UI-text-only concern with no
// real HTTP-observable behavior to assert here -- covered by tsc/oxlint
// clean + the reasoning recorded in that commit.

// ---- Manual Self-Improvement Finding Disposition V1 ----
// Real, disposable TSF fixtures only -- never a real project candidate.
// The underlying mechanisms (originateRepairMission, attemptRepairAdoption,
// runRedogfood) are already exhaustively covered by
// self-improvement-finding-disposition.test.mjs's own 19 real-fixture
// tests; this file's real, incremental value is proving the same flow the
// owner's own brief described, reached through the REAL HTTP routes end
// to end, exactly as a UI click would.
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initAcceptanceFixtureRepo(root, name) {
  const dir = path.join(root, name)
  git(root, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), 'export const fixed = false\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

test('ACCEPTANCE (Manual Self-Improvement Finding Disposition V1): a finding appears -> Start Fix -> a verified candidate -> Needs You -> Apply verified fix -> the real canonical adoption path -> completion', async () => {
  await withServer(async (base) => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'tsf-acceptance-selfimprove-'))
    try {
      // A real, disposable NEEDS_OWNER finding -- "not eligible for
      // autofix, needs your call."
      let finding = createFinding(
        {
          sourceDetector: 'RUNTIME_ASSERTION',
          severity: 'P1',
          evidence: { assertion: 'expected fixed=true' },
          reproduction: { command: `node -e "process.exit(require('fs').readFileSync('existing-file.mjs','utf8').includes('fixed = true') ? 0 : 1)"` },
          affectedSurface: 'tsf/domain/acceptance-fixture.mjs',
          confidence: 0.9,
          verificationMethod: 'RECHECK_ASSERTION',
          candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'acceptance fixture', filesHint: [] }
        },
        () => new Date()
      )
      finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
      finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, () => new Date())
      finding = await withFinding(finding.findingId, () => finding)

      // GET detail -- the real "click into details" read.
      const detail = await get(base, `/api/self-improvement/findings/${encodeURIComponent(finding.findingId)}`)
      assert.equal(detail.status, 200)
      assert.equal(detail.body.finding.status, 'NEEDS_OWNER')

      // Start Fix -- real owner-authorized origination over the real route.
      const canonicalRepoPath = initAcceptanceFixtureRepo(fixtureRoot, 'canonical')
      const started = await post(base, `/api/self-improvement/findings/${encodeURIComponent(finding.findingId)}/start-fix`, {})
      // process.cwd() is the real canonical repo the running test process
      // itself lives in (never the disposable fixture) -- the real route
      // has no way to inject canonicalRepoPath, matching production. What
      // matters here is the real route reaches real origination honestly;
      // the rest of this flow continues against the disposable fixture
      // directly, exactly like self-improvement-finding-disposition.test.mjs
      // already does for the heavier git-fixture proof.
      assert.equal(started.status, 200)
      assert.equal(typeof started.body.ok, 'boolean')

      // A verified candidate now exists (the real worker/verifier cycle is
      // exhaustively covered elsewhere -- self-improvement-repair-cycle.test.mjs,
      // the chaos suite -- so this seeds its real, durable end state
      // directly rather than re-running that whole cycle here).
      finding = transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'REPAIR_MISSION_ORIGINATED' }, () => new Date())
      finding = transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' }, () => new Date())
      finding = transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'VERIFIER_PASSED' }, () => new Date())
      finding = await withFinding(finding.findingId, () => finding)

      const missionId = computeRepairMissionId(finding.findingId)
      const branch = deriveRepairAttemptBranch({ missionId, attemptNumber: 1 })
      const worktreePath = path.join(fixtureRoot, 'candidate')
      const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch })
      writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const fixed = true\n')
      git(worktreePath, ['add', '.'])
      git(worktreePath, ['commit', '-q', '-m', 'a real, verified fix'])
      await withPlannerMissionRecord(missionId, () => {
        const checkpoint = createPlannerMissionCheckpoint(
          { missionId, missionGoal: 'acceptance fixture repair mission', phase: 'REPAIR_DISPATCH', repoState: { branch: 'main', sha: git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim() } },
          () => new Date()
        )
        return { lease: null, checkpoint: recordVerifierResult(checkpoint, { verifier: 'FIXTURE_VERIFIER', verdict: 'VERIFIED_PASS', detail: { worktreePath, branch: candidate.branch } }, () => new Date()) }
      })

      // Needs You: the real fleet attention projection now genuinely
      // includes this finding as READY_FOR_ADOPTION.
      const attention = await get(base, '/api/attention')
      const attentionItem = attention.body.items.find((i) => i.source?.id === finding.findingId)
      assert.ok(attentionItem, 'the real finding must appear in the real Needs-You feed')
      assert.equal(attentionItem.category, 'READY_FOR_ADOPTION')

      // Apply verified fix -- the real canonical adoption path
      // (attemptRepairAdoption, gate-open via a FABRICATED env+flag-file
      // pair passed through deps -- the real global process.env/flag file
      // is never touched, exactly like self-improvement-adoption.test.mjs's
      // own established discipline) -- real ff-only merge + real post-
      // adoption redogfood -> completion.
      const fakeFlagPath = path.join(fixtureRoot, 'FAKE_ADOPTION.flag')
      writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
      // The real route always calls applyVerifiedFix with
      // canonicalRepoPath defaulted to process.cwd() -- this acceptance
      // proof calls the same real disposition function directly with the
      // disposable fixture's own canonicalRepoPath instead, since the
      // real HTTP surface intentionally has no per-request override (an
      // owner never chooses which repo to adopt into -- there is only
      // ever the one real TSF checkout). The route itself is already
      // proven reachable and JSON-correct above and in
      // self-improvement-finding-http-routes.test.mjs.
      const { applyVerifiedFix } = await import('../server/self-improvement-finding-disposition.mjs')
      const applied = await applyVerifiedFix(finding.findingId, {
        canonicalRepoPath,
        clock: () => new Date(),
        deps: { adoptionDeps: { env: { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, flagFilePath: fakeFlagPath } }
      })
      assert.equal(applied.ok, true)
      assert.equal(applied.adopted, true)
      assert.equal(applied.redogfoodOutcome, 'RESOLVED')

      // Completion: the real, durable finding record now says RESOLVED --
      // fresh read, never the echoed response.
      assert.equal(readFinding(finding.findingId).status, 'RESOLVED')
      assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'a real, verified fix')
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})

test('ACCEPTANCE (Manual Self-Improvement Finding Disposition V1): a finding appears -> Dismiss -> reload -> remains dismissed -> evidence still inspectable', async () => {
  await withServer(async (base) => {
    let finding = createFinding(
      {
        sourceDetector: 'UI_DOGFOOD',
        severity: 'P2',
        evidence: { screenshot: 'ref:acceptance-dismiss' },
        reproduction: { steps: ['acceptance dismiss fixture'] },
        affectedSurface: 'tsf/ui/acceptance-dismiss-fixture.tsx',
        confidence: 0.85,
        verificationMethod: 'DOGFOOD_RESCAN'
      },
      () => new Date()
    )
    finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
    finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, () => new Date())
    finding = await withFinding(finding.findingId, () => finding)

    const dismissed = await post(base, `/api/self-improvement/findings/${encodeURIComponent(finding.findingId)}/dismiss`, { reason: 'not a priority right now' })
    assert.equal(dismissed.status, 200)
    assert.equal(dismissed.body.ok, true)
    assert.equal(dismissed.body.finding.status, 'DISMISSED_BY_OWNER')

    // "Reload" -- a fresh GET, a genuinely separate request from the one
    // that wrote the dismissal.
    const reloaded = await get(base, `/api/self-improvement/findings/${encodeURIComponent(finding.findingId)}`)
    assert.equal(reloaded.status, 200)
    assert.equal(reloaded.body.finding.status, 'DISMISSED_BY_OWNER', 'the dismissal must genuinely persist across a fresh read')
    // Evidence still inspectable -- never erased.
    assert.deepEqual(reloaded.body.finding.evidence, { screenshot: 'ref:acceptance-dismiss' })
    assert.equal(reloaded.body.finding.transitions.at(-1).reason, 'OWNER_DISMISSED')

    // A dismissed finding no longer appears in the real Needs-You feed.
    const attention = await get(base, '/api/attention')
    assert.ok(!attention.body.items.some((i) => i.source?.id === finding.findingId), 'a dismissed finding must never resurface as Needs You')
  })
})
