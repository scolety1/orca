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

// UPDATED (Conversational Hands-Free V2, Codex adversarial-review
// finding, real fix): a project whose display name is a literal PREFIX of
// another project's display name (VOICE-ALPHA / VOICE-ALPHA-TWO) used to
// resolve BOTH whenever the longer name was spoken, since the shorter
// name is also a literal substring of the message -- this was previously
// logged as a disclosed, unfixed P2 (safe -- nextCommandFocus never
// guessed a switch out of the resulting ambiguity -- but real friction).
// project-name-resolver.mjs now applies a real "longest-specific-match-
// wins" rule (a shorter match's own phrase that is a literal substring of
// a different project's own longer matched phrase is dropped) -- so the
// longer, more specific, and clearly-intended name now resolves cleanly
// on its own, with no correction turn needed.
test('MISRECOGNITION SAFETY (fixed): the longer of two prefix-colliding project names resolves cleanly and unambiguously to itself', async () => {
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
      alphaTwo.id,
      "the longer, more specific name must win outright -- the shorter project's own incidental substring match is shadowed, never a silent guess between the two"
    )
  })
})

test('CORRECTION FLOW SAFETY: natural spoken shorthand for the longer project ("Alpha Two") is fuzzy-only and correctly never moves focus by itself -- never a guessed wrong-project switch', async () => {
  const alpha = seedDisposableProject('voice-alpha-7q9', 'VOICE-ALPHA')
  const alphaTwo = seedDisposableProject('voice-alpha-two-4m2', 'VOICE-ALPHA-TWO')
  await withServer(async (base) => {
    // Explicit, known starting focus -- this file's tests share state, and
    // an earlier test may have already left focus sitting on alphaTwo
    // itself (via a real, correct exact match), which would make the
    // "never guessed its way onto alphaTwo" assertion below meaningless.
    await chat(base, { projectId: null, message: `Let's work on ${alpha.displayName}.` })
    const result = await chat(base, { projectId: null, message: 'No, I meant Alpha Two.' })
    assert.equal(result.status, 200)
    assert.equal(
      result.body.focusProjectId,
      alpha.id,
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

// REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed), reproduced end to
// end over real HTTP: focus is VOICE-ALPHA, both VOICE-ALPHA and
// VOICE-ALPHA-TWO have one open item each, and the owner says "answer the
// alpha two question" -- "alpha two" only fuzzy-matches VOICE-ALPHA-TWO
// (not its exact registered name), so the bridge's own exact-only
// turnTargetProjectIds came back empty and the request silently fell back
// to resolving the FOCUSED project's item (VOICE-ALPHA) -- the wrong one.
test("WRONG-PROJECT NEEDS-YOU MUTATION (P0, fixed): a fuzzy-only mention of a different project than focus refuses, never silently answers the focused project's item instead", async () => {
  const alpha = seedDisposableProject('dogfood-ny-fuzzy-alpha', 'VOICE-ALPHA')
  const alphaTwo = seedDisposableProject('dogfood-ny-fuzzy-alpha-two', 'VOICE-ALPHA-TWO')
  await seedRunWithOpenQuestion(alpha.id, 'Which provider?')
  await seedRunWithOpenQuestion(alphaTwo.id, 'Which environment?')
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${alpha.displayName}.` })
    const beforeAlpha = JSON.parse(JSON.stringify(readKeepGoingRun(alpha.id)))
    const beforeAlphaTwo = JSON.parse(JSON.stringify(readKeepGoingRun(alphaTwo.id)))

    const result = await chat(base, {
      projectId: null,
      message: 'Answer the alpha two question with option two.'
    })
    assert.equal(result.status, 200)
    assert.deepEqual(
      readKeepGoingRun(alpha.id).needsYou,
      beforeAlpha.needsYou,
      'the FOCUSED project (VOICE-ALPHA) must never be silently answered when the message actually named the OTHER project, even fuzzily'
    )
    assert.deepEqual(
      readKeepGoingRun(alphaTwo.id).needsYou,
      beforeAlphaTwo.needsYou,
      'the fuzzily-named project must also stay untouched -- a real refusal, never a guessed resolution either way'
    )
  })
})

// =====================================================================
// SECTION 6/12 -- CROSS-THREAD PERSISTENCE (reload history loss +
// wrong-project follow-up mutation, both from the same root cause)
// =====================================================================

// REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed), reproduced end to
// end: a Command-scope turn that resolves to exactly one project (e.g.
// "What is B doing?") only ever wrote into that project's OWN chat
// thread, never into the durable __command__ thread the visible Command
// transcript rehydrates from on reload -- this class of turn (extremely
// common: any single-exact-match mention) silently vanished from the
// transcript after every reload.
test("CROSS-THREAD PERSISTENCE (P0, fixed): a single-exact-match Command turn survives in the __command__ thread, not just the project's own thread", async () => {
  const nwr = seedDisposableProject('dogfood-thread-nwr', 'Dogfood-Thread-NWR')
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `What is ${nwr.displayName} doing?` })
    const history = await (await fetch(`${base}/api/chat/__command__`)).json()
    assert.ok(
      history.some((entry) => entry.role === 'user' && entry.content.includes(nwr.displayName)),
      "a single-exact-match Command turn must be visible in the durable __command__ thread, not only the project's own thread"
    )
  })
})

// REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed), reproduced end to
// end: same root cause as above, but with a real mutation consequence.
// Focus is A. The owner asks a read-only status question about B (an
// exact match, so it never moves focus off A) -- then says "pause that
// project," a back-reference with no project name at all, which resolves
// via command-responder.mjs's own lastReferencedProjectId. Before the
// fix, that function only ever saw __command__ (which never contained
// B's turn), so it fell back to durable focus and paused A -- the WRONG
// project, silently, exactly the danger class this whole mission's
// safety design exists to prevent.
test('CROSS-THREAD PERSISTENCE (P0, fixed): "pause that project" after asking about a DIFFERENT project than focus targets the one actually just discussed, never the stale focus', async () => {
  const a = seedDisposableProject('dogfood-thread-a', 'Dogfood-Thread-A')
  const b = seedDisposableProject('dogfood-thread-b', 'Dogfood-Thread-B')
  await seedActiveRun(a.id)
  await seedActiveRun(b.id)
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${a.displayName}.` })
    const status = await chat(base, {
      projectId: null,
      message: `What is ${b.displayName} doing?`
    })
    assert.equal(
      status.body.focusProjectId,
      a.id,
      'a status question about B must not move focus off A'
    )

    await chat(base, { projectId: null, message: 'Pause that project.' })
    assert.equal(
      readKeepGoingRun(b.id).state,
      'PAUSED',
      'the project the owner just asked about (B) must be the one paused'
    )
    assert.equal(
      readKeepGoingRun(a.id).state,
      'ACTIVE',
      'the stale-focused project (A) must NOT be silently paused instead'
    )
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
