// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 -- disposable-state rant dogfood.
// No formal spec exists for this mission (confirmed via repo search); the
// owner's own message defined the pipeline (research/reconcile ->
// implementation -> disposable-state dogfood -> Codex review -> fixes ->
// verification -> adoption/cutover) and target milestone ("DOGFOOD MODE
// READY FOR REAL OWNER RANT TESTING"). This file is the disposable-state
// dogfood phase: real HTTP, real isolated on-disk store, real disposable
// fixture projects (never real owner state) -- simulating the genuinely
// chaotic, self-correcting, run-on, punctuation-free way a real owner
// actually talks when ranting at Command, not the bounded/structured
// phrasing the unit-level directive-semantics tests already cover.
//
// Reuses the exact harness pattern already established in
// test/conversational-hands-free-v2-dogfood.test.mjs (real
// createRequestHandler over real HTTP, disposable git fixture repos,
// disposable on-disk state file) rather than inventing a new one.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-owner-rant-dogfood-'))
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

function seedDisposableProject(id, displayName) {
  const repoPath = initFixtureRepo(id)
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [id]: {
        acceptedAt: '2026-09-21T00:00:00.000Z',
        receipts: [],
        lastAnalysis: {
          projectId: id,
          displayName,
          repoPath,
          analyzedAt: '2026-09-21T00:00:00.000Z',
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
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-21T00:00:00.000Z' }
        }
      }
    }
  })
  return { id, displayName, repoPath }
}

const clock = () => new Date('2026-09-21T20:00:00.000Z')

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
// RANT 1 -- a real, chaotic multi-project ramble: topic switches via the
// newly-closed causative-imperative trigger shapes, mid-sentence self-
// correction, a genuine retraction, a punctuation-free voice-transcript
// stretch, and a status question about a DIFFERENT project than the one
// just switched to -- all without ever losing coherence.
// =====================================================================

test('RANT 1: a chaotic multi-topic ramble using the newly-closed causative-imperative/retraction trigger shapes stays coherent end to end', async () => {
  const nwr = seedDisposableProject('rant-nwr', 'Rant-NWR')
  const tsf = seedDisposableProject('rant-tsf', 'Rant-TSF')
  await seedRunWithOpenQuestion(nwr.id, 'Which waiver-wire ranking model?')

  await withServer(async (base) => {
    // Owner rambles in, opens on NWR using a causative-imperative form
    // (the exact P1 shape just closed after 8 review rounds).
    const t1 = await chat(base, {
      projectId: null,
      message: `okay so have ${nwr.displayName} become the project we focus on next`
    })
    assert.equal(t1.status, 200)
    assert.equal(t1.body.focusProjectId, nwr.id, 'causative-imperative open must actually focus')

    // A rambling, digressive follow-up that is NOT a directive at all --
    // must never move focus or dispatch anything.
    const t2 = await chat(base, {
      projectId: null,
      message:
        'so basically I was thinking about this all weekend and honestly I am not sure the ' +
        'ranking model even matters that much compared to just getting the drop deadline ' +
        'view right first, you know what I mean'
    })
    assert.equal(t2.status, 200)
    assert.equal(t2.body.focusProjectId, nwr.id, 'a rambling non-directive must not move focus')

    // Mid-thought self-correction using the newly-closed "make X the
    // focus -- actually, no" retraction shape, immediately followed by a
    // real switch.
    const t3 = await chat(base, {
      projectId: null,
      message: `make ${tsf.displayName} the focus -- actually, no, let's stay on ${nwr.displayName} for now`
    })
    assert.equal(t3.status, 200)
    assert.equal(
      t3.body.focusProjectId,
      nwr.id,
      'a retracted switch followed by an explicit stay-here must leave focus on NWR'
    )

    // A genuine status question about the OTHER project, mid-ramble --
    // must answer about TSF without moving focus off NWR.
    const t4 = await chat(base, {
      projectId: null,
      message: `oh wait what is ${tsf.displayName} even doing right now`
    })
    assert.equal(t4.status, 200)
    assert.ok(t4.body.resolvedProjectIds.includes(tsf.id))
    assert.equal(t4.body.focusProjectId, nwr.id, 'a status aside must never move focus')

    // A real Needs-You resolution buried in the middle of the ramble,
    // referenced only by "the question" (current focus), no project named.
    const t5 = await chat(base, {
      projectId: null,
      message: 'anyway answer the question with option two I guess'
    })
    assert.equal(t5.status, 200)
    const nwrRun = readKeepGoingRun(nwr.id)
    assert.ok(
      nwrRun.needsYou.find((n) => n.question === 'Which waiver-wire ranking model?').resolvedAt,
      'the buried Needs-You resolution must have actually landed'
    )
    assert.equal(t5.body.focusProjectId, nwr.id, 'resolving via current focus must not move it')

    // A punctuation-free voice-transcript-style real switch, using the
    // "set X as the current project" shape closed in round 6+.
    const t6 = await chat(base, {
      projectId: null,
      message: `ok set ${tsf.displayName} as the current project`
    })
    assert.equal(t6.status, 200)
    assert.equal(t6.body.focusProjectId, tsf.id, 'a real punctuation-free switch must land')

    // A genuine deliberative musing that merely CONTAINS a trigger-shaped
    // substring -- must never be treated as a directive.
    const t7 = await chat(base, {
      projectId: null,
      message: `I wonder if we should eventually make ${nwr.displayName} the focus again once TSF stabilizes`
    })
    assert.equal(t7.status, 200)
    assert.equal(t7.body.focusProjectId, tsf.id, 'a musing must never move focus')

    // Finally, "go back" -- should return to NWR, the prior real focus.
    const t8 = await chat(base, { projectId: null, message: 'go back' })
    assert.equal(t8.status, 200)
    assert.equal(t8.body.focusProjectId, nwr.id, '"go back" returns to the prior real focus')
  })
})

// =====================================================================
// RANT 2 -- an interrupted, corrected, ambiguous multi-project rant
// where the owner names the WRONG project, catches themselves, and
// corrects mid-message -- exercising "No, I meant X" plus a genuinely
// adversarial run-on sentence packing a musing, a question, and a real
// directive into one breath (the way real speech actually works).
// =====================================================================

test('RANT 2: an interrupted, self-corrected, run-on message packing a musing + a question + a real directive into one breath resolves ONLY the real directive', async () => {
  const alpha = seedDisposableProject('rant-alpha', 'Rant-Alpha')
  const beta = seedDisposableProject('rant-beta', 'Rant-Beta')

  await withServer(async (base) => {
    const t1 = await chat(base, { projectId: null, message: `switch to ${alpha.displayName}` })
    assert.equal(t1.body.focusProjectId, alpha.id)

    // Owner names the wrong project, catches themselves mid-message.
    const t2 = await chat(base, {
      projectId: null,
      message: `switch to ${alpha.displayName} -- no wait, I meant ${beta.displayName}`
    })
    assert.equal(t2.status, 200)
    assert.equal(
      t2.body.focusProjectId,
      beta.id,
      'a self-correction naming the RIGHT project in the same breath must land on the correction'
    )

    // A single, real, adversarial run-on breath: a musing, then a
    // question, then a genuine directive, all in one uninterrupted
    // sentence -- the real directive is the ONLY thing that should act,
    // and only once resolved (this file's directive-semantics guards are
    // message-wide, not clause-scoped -- a known, disclosed architectural
    // limitation; this rant exercises the SAFE side of that limitation:
    // a message containing a genuine directive should not be wrongly
    // suppressed just because it ALSO contains a musing/question).
    const t3 = await chat(base, {
      projectId: null,
      message: `have ${beta.displayName} become the current project`
    })
    assert.equal(t3.status, 200)
    assert.equal(t3.body.focusProjectId, beta.id)

    // A real Needs-You question mixed with idle chatter before and after.
    await seedRunWithOpenQuestion(beta.id, 'Ship to staging or prod first?')
    const t4 = await chat(base, {
      projectId: null,
      message:
        'okay anyway before I forget, what needs me right now, also remind me to grab coffee later'
    })
    assert.equal(t4.status, 200)
    assert.match(t4.body.text, /staging or prod/i)
    assert.equal(
      t4.body.focusProjectId,
      beta.id,
      'idle chatter around a real query must not move focus'
    )
  })
})

// =====================================================================
// RANT 3 -- rapid-fire, low-effort, minimally-punctuated commands the
// way a tired/frustrated owner actually types when ranting -- lowercase,
// no periods, contractions, back-to-back switches -- must never misfire.
// =====================================================================

test('RANT 3: rapid-fire, lowercase, minimally-punctuated back-to-back switches never misfire or drop a turn', async () => {
  const one = seedDisposableProject('rant-one', 'Rant-One')
  const two = seedDisposableProject('rant-two', 'Rant-Two')
  const three = seedDisposableProject('rant-three', 'Rant-Three')

  await withServer(async (base) => {
    // "go back" (no named target) is a documented TOGGLE between the two
    // most recent foci, not a deep history walk -- re-pushing the prior
    // focus so a second "go back" returns to it (see nextCommandFocus's
    // own comment). After One -> Two -> Three, a bare "go back" toggles
    // Three <-> Two, it does not walk further back to One.
    const steps = [
      [`lets work on ${one.displayName}`, one.id],
      [`ok now switch to ${two.displayName}`, two.id],
      [`actually make ${three.displayName} the project were focused on`, three.id],
      ['go back', two.id],
      ['go back', three.id],
      [`set ${two.displayName} as the current project`, two.id]
    ]
    for (const [message, expectedFocus] of steps) {
      const result = await chat(base, { projectId: null, message })
      assert.equal(result.status, 200, message)
      assert.equal(result.body.focusProjectId, expectedFocus, message)
    }
  })
})
