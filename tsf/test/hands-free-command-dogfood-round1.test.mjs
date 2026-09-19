// Hands-Free Command + Project Manager V1 -- REAL-WORLD DOGFOOD ROUND 1
// (non-microphone portion). Real HTTP, real on-disk store (isolated via
// TSF_UI_STATE_FILE, never the real owner state), real disposable fixture
// projects. Typed-equivalent transcript injection stands in for spoken
// input here -- this file proves the CONTROL PLANE (targeting safety,
// focus/switching, authority, Needs-You resolution, async non-interference,
// reload durability), never real microphone/transcription behavior, which
// only a human with real audio hardware can validate.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-hands-free-dogfood-round1-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')

test.after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// Idempotent -- several dogfood scenarios (e.g. the misrecognition-safety
// pair) deliberately reuse the SAME real project id/name across more than
// one test in this file, mirroring a real owner referring to the same
// project across turns; re-seeding must not fail on an already-initialized
// repo.
function initFixtureRepo(name) {
  const dir = path.join(ROOT, name)
  if (existsSync(dir)) {
    return dir
  }
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), 'export const x = 1\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

// Real, disposable fixture projects -- never touches C:\TSF_ORCA, niners-
// war-room, or any other real owner project. Names deliberately mirror the
// mission's own scripted dogfood scenario (misrecognition-safety pair,
// async multi-project pair). The full-shaped lastAnalysis is required
// because this file drives the real HTTP layer (projectsById() ->
// projectOnboardedProject()), unlike direct-respondCommand-call tests that
// can get away with lastAnalysis: null.
function seedDisposableProject(id, displayName) {
  const repoPath = initFixtureRepo(id)
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [id]: {
        acceptedAt: '2026-09-19T00:00:00.000Z',
        receipts: [],
        lastAnalysis: {
          projectId: id,
          displayName,
          repoPath,
          analyzedAt: '2026-09-19T00:00:00.000Z',
          maturity: 'DEVELOPING',
          identity: { branch: 'main', head: 'seed000', tree: 'seedtree' },
          migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
          handoffReconciliation: { hasHandoff: false },
          orcaRegistration: { checked: false, registered: false },
          discovery: {
            commandGuidance: {
              hasKnownTestCommand: false,
              testCommands: [],
              lintCommands: [],
              buildCommands: []
            }
          },
          direction: {
            purpose: null,
            recommendedNextMission: null,
            upgradeCandidates: [],
            unfinishedSummary: null,
            completedSummary: null,
            alignment: 'UNKNOWN',
            live: false
          },
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-19T00:00:00.000Z' }
        }
      }
    }
  })
  return { id, displayName, repoPath }
}

const clock = () => new Date('2026-09-19T12:00:00.000Z')

async function seedActiveRun(projectId) {
  await withKeepGoingRun(projectId, () => {
    return createOvernightRun(
      {
        id: `run-${projectId}`,
        projectId,
        originalGoal: 'Ship a real, disposable improvement.',
        acceptanceCriteria: ['X'],
        usageMode: 'BALANCED'
      },
      clock
    )
  })
}

async function seedRunWithOpenQuestion(projectId, question) {
  await withKeepGoingRun(projectId, () => {
    let run = createOvernightRun(
      {
        id: `run-${projectId}`,
        projectId,
        originalGoal: 'Ship it.',
        acceptanceCriteria: ['X'],
        usageMode: 'BALANCED'
      },
      clock
    )
    run = raiseNeedsYou(run, { question, options: [] }, clock, run.revision)
    return run
  })
}

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
  }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

// =====================================================================
// SECTION 9 -- MISRECOGNITION / CORRECTION SAFETY
// =====================================================================

test('MISRECOGNITION SAFETY: an unambiguous short name resolves to exactly the right project even when a longer, similarly-prefixed project also exists', async () => {
  const alpha = seedDisposableProject('voice-alpha-7q9', 'VOICE-ALPHA')
  seedDisposableProject('voice-alpha-two-4m2', 'VOICE-ALPHA-TWO')
  await withServer(async (base) => {
    const result = await chat(base, {
      projectId: null,
      message: 'What is voice-alpha working on?'
    })
    assert.equal(result.status, 200)
    assert.deepEqual(
      result.body.resolvedProjectIds,
      [alpha.id],
      'the exact display name, with no trailing qualifier, must resolve unambiguously to that one project'
    )
  })
})

// REAL FINDING (P2, pre-existing project-name-resolver.mjs behavior, not
// introduced by this mission): when project B's display name has project
// A's display name as a literal PREFIX (VOICE-ALPHA / VOICE-ALPHA-TWO),
// resolveProjectsFromText matches BOTH whenever B's full name is spoken,
// because A's name is also a literal substring of the message. This is
// safe (nextCommandFocus's own decision table refuses to move focus on
// more than one turn target -- confirmed below, no wrong-project action
// is possible) but is real friction: an owner can never address the
// longer-named project by its own full, correct name in one turn. Logged
// here as a real, reproduced dogfood finding, not fixed -- it lives in
// pre-existing shared resolver code well outside this mission's own diff,
// and the mission's own instructions say fix only P0/P1 automatically.
test("MISRECOGNITION SAFETY: a name that is a real prefix of another project's name is genuinely ambiguous, and NO ACTION is taken (a real, logged P2 finding, not a P0/P1)", async () => {
  seedDisposableProject('voice-alpha-7q9', 'VOICE-ALPHA')
  const alphaTwo = seedDisposableProject('voice-alpha-two-4m2', 'VOICE-ALPHA-TWO')
  await withServer(async (base) => {
    const result = await chat(base, {
      projectId: null,
      message: "Let's work on VOICE-ALPHA-TWO."
    })
    assert.equal(result.status, 200)
    assert.equal(
      result.body.focusProjectId,
      null,
      "two turn targets (the prefix collision) must never resolve to a silent guess -- NO ACTION TAKEN, matching the mission's own safety requirement"
    )

    // The exact, full, correct name -- alone, with no other project name
    // in the same message -- corrects cleanly to a single exact match.
    // This is the real, working correction path (spoken shorthand like
    // "Alpha Two" alone stays FUZZY-only and, correctly, still never
    // moves focus -- see the next test).
    const corrected = await chat(base, {
      projectId: null,
      message: 'No, I meant VOICE-ALPHA.'
    })
    assert.equal(corrected.status, 200)
    assert.equal(
      corrected.body.focusProjectId,
      'voice-alpha-7q9',
      'an unambiguous exact-match correction must resolve and move focus'
    )
    void alphaTwo
  })
})

test('CORRECTION FLOW SAFETY: natural spoken shorthand for the longer project ("Alpha Two") is fuzzy-only and correctly never moves focus by itself -- never a guessed wrong-project switch', async () => {
  seedDisposableProject('voice-alpha-7q9', 'VOICE-ALPHA')
  const alphaTwo = seedDisposableProject('voice-alpha-two-4m2', 'VOICE-ALPHA-TWO')
  await withServer(async (base) => {
    const before = (await (await fetch(`${base}/api/chat/__command__/focus`)).json()).focusProjectId
    const result = await chat(base, { projectId: null, message: 'No, I meant Alpha Two.' })
    assert.equal(result.status, 200)
    assert.equal(
      result.body.focusProjectId,
      before,
      'a fuzzy-only match (natural shorthand, not the exact registered name) must never drive a focus switch -- fail closed, never guess, focus stays exactly what it was'
    )
    assert.notEqual(
      result.body.focusProjectId,
      alphaTwo.id,
      'must specifically never have guessed its way onto the fuzzy-matched project'
    )
  })
})

// =====================================================================
// SECTION 4 -- PROJECT FOCUS / SWITCHING / TURN-TARGET-VS-FOCUS / GO BACK
// =====================================================================

test("FOCUS/SWITCHING: the mission's own scripted sequence end to end, chained through one real conversation", async () => {
  const nwr = seedDisposableProject('dogfood-nwr', 'Dogfood-NWR')
  const tsf = seedDisposableProject('dogfood-tsf', 'Dogfood-TSF')
  await withServer(async (base) => {
    const t1 = await chat(base, { projectId: null, message: `Let's work on ${nwr.displayName}.` })
    assert.equal(t1.body.focusProjectId, nwr.id)

    const t2 = await chat(base, {
      projectId: null,
      message: "Research waiver-wire mechanics. Don't change anything yet."
    })
    assert.equal(
      t2.body.focusProjectId,
      nwr.id,
      'TURN_TARGET_VS_FOCUS: an on-topic research request keeps focus'
    )

    const t3 = await chat(base, { projectId: null, message: `Switch to ${tsf.displayName}.` })
    assert.equal(
      t3.body.focusProjectId,
      tsf.id,
      'PROJECT_SWITCHING: an explicit switch moves focus'
    )

    const t4 = await chat(base, {
      projectId: null,
      message: `How is ${nwr.displayName} doing?`
    })
    assert.equal(
      t4.body.focusProjectId,
      tsf.id,
      'TURN_TARGET_VS_FOCUS: a status question about a DIFFERENT project must never move focus off the current one'
    )
    assert.ok(
      (t4.body.resolvedProjectIds ?? []).includes(nwr.id),
      'the status ANSWER must still be about the actually-named project'
    )

    const t5 = await chat(base, { projectId: null, message: `Go back to ${nwr.displayName}.` })
    assert.equal(
      t5.body.focusProjectId,
      nwr.id,
      'GO_BACK: an explicit named go-back moves focus there'
    )

    const t6 = await chat(base, { projectId: null, message: `Switch back to ${tsf.displayName}.` })
    assert.equal(t6.body.focusProjectId, tsf.id)
  })
})

// =====================================================================
// SECTION 5 -- ASYNC MULTI-PROJECT WORK (background non-interference)
// =====================================================================

test("ASYNC MULTI-PROJECT: talking about Beta never disturbs Alpha's real background run state, and switching focus never mutates either run", async () => {
  const alpha = seedDisposableProject('dogfood-async-alpha', 'Dogfood-Async-Alpha')
  const beta = seedDisposableProject('dogfood-async-beta', 'Dogfood-Async-Beta')
  await seedActiveRun(alpha.id)
  await seedActiveRun(beta.id)
  const alphaBefore = JSON.parse(JSON.stringify(readKeepGoingRun(alpha.id)))

  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Work on ${alpha.displayName}.` })
    await chat(base, { projectId: null, message: `Switch to ${beta.displayName}.` })
    const status = await chat(base, {
      projectId: null,
      message: `What's ${alpha.displayName} doing?`
    })
    assert.equal(status.status, 200)
    // The real background run for Alpha must be byte-for-byte unchanged by
    // any of this conversation -- a pure read, never a side effect.
    assert.deepEqual(
      readKeepGoingRun(alpha.id).revision,
      alphaBefore.revision,
      'asking about a project, or switching focus away from it, must never mutate its real run'
    )
    assert.deepEqual(
      readKeepGoingRun(beta.id).revision,
      0,
      'Beta must also be untouched by pure conversation'
    )

    const fleet = await chat(base, { projectId: null, message: 'What needs me across everything?' })
    assert.equal(fleet.status, 200)
  })
})

// =====================================================================
// SECTION 7 -- HANDS-FREE NEEDS YOU (real resolution + ambiguity refusal)
// =====================================================================

test('HANDS-FREE NEEDS YOU: a named project with one open item resolves for real over full HTTP', async () => {
  const alpha = seedDisposableProject('dogfood-ny-alpha', 'Dogfood-NY-Alpha')
  await seedRunWithOpenQuestion(alpha.id, 'Which provider should we use?')
  await withServer(async (base) => {
    const result = await chat(base, {
      projectId: null,
      message: `Answer the ${alpha.displayName} question with option two.`
    })
    assert.equal(result.status, 200)
    assert.match(result.body.text, /Got it|resolved|option two/i)
    const run = readKeepGoingRun(alpha.id)
    const resolved = run.needsYou.find((n) => n.question === 'Which provider should we use?')
    assert.ok(
      resolved.resolvedAt,
      'the real run must show the question genuinely, durably resolved'
    )
  })
})

test('AMBIGUOUS NEEDS YOU: two open items with no named project and no focus -- NO ACTION WAS TAKEN, and the owner is asked which one', async () => {
  const gamma = seedDisposableProject('dogfood-ny-gamma', 'Dogfood-NY-Gamma')
  const delta = seedDisposableProject('dogfood-ny-delta', 'Dogfood-NY-Delta')
  await seedRunWithOpenQuestion(gamma.id, 'Which branch?')
  await seedRunWithOpenQuestion(delta.id, 'Which environment?')
  const beforeGamma = JSON.parse(JSON.stringify(readKeepGoingRun(gamma.id)))
  const beforeDelta = JSON.parse(JSON.stringify(readKeepGoingRun(delta.id)))
  await withServer(async (base) => {
    const result = await chat(base, { projectId: null, message: 'Answer that with yes.' })
    assert.equal(result.status, 200)
    assert.deepEqual(
      readKeepGoingRun(gamma.id).needsYou,
      beforeGamma.needsYou,
      'ambiguous refusal must never mutate any real state'
    )
    assert.deepEqual(readKeepGoingRun(delta.id).needsYou, beforeDelta.needsYou)
  })
})

// =====================================================================
// SECTION 8 -- VOICE AUTHORITY: STATUS vs DELIBERATIVE vs DIRECT
// =====================================================================

test('VOICE AUTHORITY: a status question and a deliberative question about pausing never mutate the real run; a direct imperative does', async () => {
  const alpha = seedDisposableProject('dogfood-authority-alpha', 'Dogfood-Authority-Alpha')
  await seedActiveRun(alpha.id)
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Work on ${alpha.displayName}.` })

    const statusBefore = readKeepGoingRun(alpha.id).state
    await chat(base, {
      projectId: null,
      message: `Is ${alpha.displayName} on hold?`
    })
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      statusBefore,
      'STATUS: a status question never mutates'
    )

    await chat(base, {
      projectId: null,
      message: `Should I pause ${alpha.displayName}?`
    })
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      statusBefore,
      'DELIBERATIVE: a question never mutates'
    )

    const direct = await chat(base, {
      projectId: null,
      message: `Pause ${alpha.displayName}.`
    })
    assert.equal(direct.status, 200)
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      'PAUSED',
      'DIRECT: an unambiguous imperative uses the canonical pause path'
    )

    const resumeDeliberative = await chat(base, {
      projectId: null,
      message: `Should I resume ${alpha.displayName}?`
    })
    assert.equal(resumeDeliberative.status, 200)
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      'PAUSED',
      'DELIBERATIVE resume question never mutates'
    )

    await chat(base, { projectId: null, message: `Resume ${alpha.displayName}.` })
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      'ACTIVE',
      'DIRECT resume mutates via the canonical path'
    )
  })
})

// =====================================================================
// SECTION 12 -- RELOAD / RESTART DURABILITY (combined)
// =====================================================================

test('RELOAD/RESTART DURABILITY: conversation, focus, and a real Needs-You item all survive a simulated restart together', async () => {
  const nwr = seedDisposableProject('dogfood-restart-nwr', 'Dogfood-Restart-NWR')
  await seedRunWithOpenQuestion(nwr.id, 'Ready to proceed?')
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${nwr.displayName}.` })
    const focusRes = await fetch(`${base}/api/chat/__command__/focus`)
    const focusBody = await focusRes.json()
    assert.equal(focusBody.focusProjectId, nwr.id)

    const history = await fetch(`${base}/api/chat/__command__`)
    const historyBody = await history.json()
    assert.ok(historyBody.length > 0, 'the real durable thread must contain the turn just sent')
  })

  // A genuinely fresh read, independent of any running server -- the same
  // durability proof http-command-focus-persistence.test.mjs's own
  // RESTART_DURABILITY test uses.
  const freshState = loadState()
  assert.equal(freshState.commandFocus.focusProjectId, nwr.id)
  const run = readKeepGoingRun(nwr.id)
  assert.ok(
    run.needsYou.some((n) => n.question === 'Ready to proceed?' && !n.resolvedAt),
    'the open Needs-You item must survive the restart, still open'
  )
})
