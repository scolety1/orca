// Conversational Command + Continuous Hands-Free V2 -- dogfood round 2
// (non-microphone portion). Real HTTP, real isolated on-disk store, real
// disposable fixture projects (never real owner state). Typed-equivalent
// transcript injection stands in for spoken input. Covers Phase 8 (long
// conversational development flow), Phase 9 (natural conversational
// questions), and Phase 10 (async multi-project: Researching/Building/
// Needs-You simultaneously, Command remains responsive to all three).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-conversational-v2-dogfood-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'
process.env.STUB_SCOPE_OVERRIDE = 'NEEDS_YOU_QUERY'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { registerProject } = await import('../domain/portfolio.mjs')
const { projectsById } = await import('../server/project-catalog.mjs')

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

function seedCatalogProject(id, displayName, sourceClass) {
  const repoPath = initFixtureRepo(id)
  const opState = loadState()
  const portfolio = opState.portfolio.projects[id]
    ? opState.portfolio
    : registerProject(
        opState.portfolio,
        {
          id,
          displayName,
          root: repoPath,
          sourceClass,
          lifecycle: sourceClass === 'FIXTURE' ? 'FIXTURE' : 'ONBOARDED',
          provenance: 'TEST_ISOLATED_REPOSITORY'
        },
        clock
      )
  saveState({
    ...opState,
    portfolio,
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

function seedDisposableProject(id, displayName) {
  return seedCatalogProject(id, displayName, 'FIXTURE')
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

test('safety advisory uses exact fixture metadata and protects real and similarly named projects', async () => {
  const disposable = seedDisposableProject('dogfood-v2-safe-fixture', 'Dogfood-V2-Safe-Fixture')
  const lookalike = seedCatalogProject(
    'dogfood-v2-safe-fixture-copy',
    'Dogfood-V2-Safe-Fixture Copy',
    'REAL'
  )
  const ownerProject = [...projectsById().map.values()].find(
    (project) => project.sourceClass === 'REAL' && project.id !== lookalike.id
  )
  assert.ok(ownerProject, 'the real catalog must contribute an owner project for this proof')

  await withServer(async (base) => {
    const previousScope = process.env.STUB_SCOPE_OVERRIDE
    process.env.STUB_SCOPE_OVERRIDE = 'GLOBAL_ADVISORY'
    try {
      const result = await chat(base, {
        projectId: null,
        message: 'Which project is safe to mess around with?'
      })
      assert.equal(result.status, 200)
      assert.ok(result.body.text.includes(disposable.displayName))
      assert.ok(!result.body.text.includes(lookalike.displayName))
      assert.ok(!result.body.text.includes(ownerProject.displayName))
    } finally {
      process.env.STUB_SCOPE_OVERRIDE = previousScope
    }
  })
})

// =====================================================================
// PHASE 9 -- NATURAL CONVERSATIONAL QUESTIONS (real HTTP reproduction of
// the real dogfood finding: "what project are we talking about" fell
// through to a generic refusal even though the durable focus was known)
// =====================================================================

test('PHASE 9 (P1, fixed): "What project are we talking about?" answers from the real durable focus, over full HTTP', async () => {
  const nwr = seedDisposableProject('dogfood-v2-focus-query', 'Dogfood-V2-FocusQuery')
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Let's work on ${nwr.displayName}.` })
    const result = await chat(base, {
      projectId: null,
      message: 'What project are we talking about?'
    })
    assert.equal(result.status, 200)
    assert.match(result.body.text, new RegExp(nwr.displayName))
    assert.deepEqual(result.body.resolvedProjectIds, [nwr.id])
  })
})

test('PHASE 9: "What project are we talking about?" honestly says so when nothing is focused yet -- never guesses', async () => {
  // Explicit precondition, not execution-order-dependent -- this file's
  // other tests share the same on-disk store and may have already set a
  // real durable focus by the time this one runs.
  saveState({ ...loadState(), commandFocus: null })
  await withServer(async (base) => {
    const result = await chat(base, { projectId: null, message: 'What are we working on?' })
    assert.equal(result.status, 200)
    assert.match(result.body.text, /haven't focused/i)
  })
})

// =====================================================================
// PHASE 10 -- ASYNC MULTI-PROJECT: Researching / Building / Needs-You
// simultaneously, Command remains conversationally responsive to all three
// =====================================================================

test('PHASE 10: three disposable projects in three different real states (a run in progress, an open Needs-You, a fresh unstarted project) are all correctly, independently reported without any cross-contamination', async () => {
  const alpha = seedDisposableProject('dogfood-v2-alpha', 'Dogfood-V2-Alpha')
  const beta = seedDisposableProject('dogfood-v2-beta', 'Dogfood-V2-Beta')
  const gamma = seedDisposableProject('dogfood-v2-gamma', 'Dogfood-V2-Gamma')
  await seedActiveRun(alpha.id)
  await seedRunWithOpenQuestion(beta.id, 'Which environment should this ship to?')

  await withServer(async (base) => {
    // Establish a conversation already in progress, focused elsewhere.
    await chat(base, { projectId: null, message: `Let's work on ${gamma.displayName}.` })

    const alphaStatus = await chat(base, {
      projectId: null,
      message: `What is ${alpha.displayName} doing?`
    })
    assert.equal(alphaStatus.status, 200)
    assert.ok(alphaStatus.body.resolvedProjectIds.includes(alpha.id))
    assert.equal(
      alphaStatus.body.focusProjectId,
      gamma.id,
      'a status question about Alpha must never move focus off Gamma'
    )

    const needsYou = await chat(base, { projectId: null, message: 'What needs me?' })
    assert.equal(needsYou.status, 200)
    assert.match(needsYou.body.text, new RegExp(beta.displayName))
    assert.doesNotMatch(
      needsYou.body.text,
      new RegExp(alpha.displayName),
      'Alpha (no open question) must never appear as needing the owner'
    )

    // Answer Beta's Needs-You entirely by name, without ever switching focus.
    const answered = await chat(base, {
      projectId: null,
      message: `Answer the ${beta.displayName} question with option two.`
    })
    assert.equal(answered.status, 200)
    assert.equal(
      answered.body.focusProjectId,
      gamma.id,
      'resolving a Needs-You elsewhere by name must never move focus'
    )
    const betaRun = readKeepGoingRun(beta.id)
    const resolved = betaRun.needsYou.find(
      (n) => n.question === 'Which environment should this ship to?'
    )
    assert.ok(resolved.resolvedAt, "Beta's question must be genuinely, durably resolved")

    // Alpha's real background run must be completely untouched by any of this.
    const alphaRun = readKeepGoingRun(alpha.id)
    assert.equal(
      alphaRun.revision,
      0,
      'Alpha must never be mutated by conversation about Beta or Gamma'
    )
  })
})

// =====================================================================
// PHASE 8/FLOW E -- a long, chained conversational development flow
// (10+ turns: idea, switch, status, instruction, Needs-You, go-back,
// another project, status, refinement) -- proves the whole control plane
// stays coherent across a realistic extended session, not just isolated
// two-turn scenarios.
// =====================================================================

test('PHASE 8, FLOW E: a long chained conversation stays coherent end to end (focus, turn targets, Needs-You, go-back all correct throughout)', async () => {
  const tsf = seedDisposableProject('dogfood-v2-flow-tsf', 'Dogfood-V2-Flow-TSF')
  const nwr = seedDisposableProject('dogfood-v2-flow-nwr', 'Dogfood-V2-Flow-NWR')
  await seedRunWithOpenQuestion(nwr.id, 'Which waiver-wire ranking model?')

  await withServer(async (base) => {
    const t1 = await chat(base, { projectId: null, message: `Let's work on ${tsf.displayName}.` })
    assert.equal(t1.body.focusProjectId, tsf.id)

    const t2 = await chat(base, {
      projectId: null,
      message: 'I think Command needs to be easier to use while I am injured.'
    })
    assert.equal(t2.status, 200)
    assert.equal(t2.body.focusProjectId, tsf.id, 'an on-topic follow-up keeps focus')

    const t3 = await chat(base, { projectId: null, message: `Switch to ${nwr.displayName}.` })
    assert.equal(t3.body.focusProjectId, nwr.id)

    const t4 = await chat(base, { projectId: null, message: 'What needs me?' })
    assert.match(t4.body.text, /waiver-wire ranking model/i)
    assert.equal(
      t4.body.focusProjectId,
      nwr.id,
      'a read-only Needs-You query never moves focus by itself'
    )

    const t5 = await chat(base, {
      projectId: null,
      message: 'Answer the question with option two.'
    })
    assert.equal(t5.status, 200)
    assert.equal(
      t5.body.focusProjectId,
      nwr.id,
      'resolving via current focus (no project named) must not move focus'
    )
    const run = readKeepGoingRun(nwr.id)
    assert.ok(
      run.needsYou.find((n) => n.question === 'Which waiver-wire ranking model?').resolvedAt
    )

    const t6 = await chat(base, { projectId: null, message: `What is ${tsf.displayName} doing?` })
    assert.equal(t6.body.focusProjectId, nwr.id, 'checking on TSF must not move focus off NWR')

    const t7 = await chat(base, { projectId: null, message: 'Go back.' })
    assert.equal(t7.body.focusProjectId, tsf.id, '"go back" returns to the prior focus (TSF)')

    const t8 = await chat(base, { projectId: null, message: 'What project are we talking about?' })
    assert.match(t8.body.text, new RegExp(tsf.displayName))

    const t9 = await chat(base, { projectId: null, message: `Switch to ${nwr.displayName}.` })
    assert.equal(t9.body.focusProjectId, nwr.id)

    const t10 = await chat(base, { projectId: null, message: 'Go back.' })
    assert.equal(t10.body.focusProjectId, tsf.id, 'a second "go back" returns to TSF again')
  })
})
