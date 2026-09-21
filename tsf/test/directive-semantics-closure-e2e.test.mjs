// DIRECTIVE SEMANTICS CLOSURE V1 -- Section 6: real end-to-end proof, not
// just unit-level classifier calls. Same real-HTTP/real-disposable-project
// harness as test/hands-free-command-dogfood-round1.test.mjs (a small,
// separate file rather than growing that one, which is already close to
// this repo's max-lines budget). Proves the two closure-pass gaps fixed in
// isGenuineDirective (punctuation-free voice questions, musing statements)
// hold through the REAL /api/chat route, not merely against the isolated
// function.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-directive-semantics-e2e-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readKeepGoingRun, withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')

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
  await withKeepGoingRun(projectId, () =>
    createOvernightRun(
      {
        id: `run-${projectId}`,
        projectId,
        originalGoal: 'Ship a real, disposable improvement.',
        acceptanceCriteria: ['X'],
        usageMode: 'BALANCED'
      },
      clock
    )
  )
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

test('E2E: a punctuation-free spoken question never mutates a real run, but the same words as a real imperative do', async () => {
  const alpha = seedDisposableProject('e2e-punct-free-alpha', 'E2E-Punct-Free-Alpha')
  await seedActiveRun(alpha.id)
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Work on ${alpha.displayName}.` })
    const before = readKeepGoingRun(alpha.id).state

    // No punctuation at all -- exactly what a real voice transcript
    // (Web Speech API and similar) often produces.
    const spoken = await chat(base, {
      projectId: null,
      message: `should we pause ${alpha.displayName}`
    })
    assert.equal(spoken.status, 200)
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      before,
      'a punctuation-free spoken QUESTION must never mutate the real run'
    )

    const direct = await chat(base, { projectId: null, message: `Pause ${alpha.displayName}.` })
    assert.equal(direct.status, 200)
    assert.equal(
      readKeepGoingRun(alpha.id).state,
      'PAUSED',
      'the SAME words as a genuine imperative must still mutate via the canonical path'
    )
  })
})

test('E2E: a musing statement never mutates a real run, but the same intent as a direct request does', async () => {
  const beta = seedDisposableProject('e2e-musing-beta', 'E2E-Musing-Beta')
  await seedActiveRun(beta.id)
  await withServer(async (base) => {
    await chat(base, { projectId: null, message: `Work on ${beta.displayName}.` })
    const before = readKeepGoingRun(beta.id).state

    const musing = await chat(base, {
      projectId: null,
      message: `Maybe we should pause ${beta.displayName}.`
    })
    assert.equal(musing.status, 200)
    assert.equal(
      readKeepGoingRun(beta.id).state,
      before,
      'a musing statement must never mutate the real run'
    )

    const direct = await chat(base, { projectId: null, message: `Pause ${beta.displayName}.` })
    assert.equal(direct.status, 200)
    assert.equal(
      readKeepGoingRun(beta.id).state,
      'PAUSED',
      'the SAME intent as a genuine imperative must still mutate via the canonical path'
    )
  })
})

test('E2E: a punctuation-free question about ONE project never touches a DIFFERENT project mutated in the same turn sequence', async () => {
  const gamma = seedDisposableProject('e2e-cross-project-gamma', 'E2E-Cross-Project-Gamma')
  const delta = seedDisposableProject('e2e-cross-project-delta', 'E2E-Cross-Project-Delta')
  await seedActiveRun(gamma.id)
  await seedActiveRun(delta.id)
  await withServer(async (base) => {
    const gammaBefore = readKeepGoingRun(gamma.id).state
    // Punctuation-free question about delta must not touch gamma, and
    // must not mutate delta either (it is a question, not a directive).
    await chat(base, { projectId: null, message: `is ${delta.displayName} paused` })
    assert.equal(readKeepGoingRun(gamma.id).state, gammaBefore, 'an unrelated project is untouched')
    assert.equal(
      readKeepGoingRun(delta.id).state,
      'ACTIVE',
      'a punctuation-free question about the named project itself must not mutate it either'
    )

    const direct = await chat(base, { projectId: null, message: `Pause ${delta.displayName}.` })
    assert.equal(direct.status, 200)
    assert.equal(readKeepGoingRun(delta.id).state, 'PAUSED', 'the named project mutates correctly')
    assert.equal(
      readKeepGoingRun(gamma.id).state,
      gammaBefore,
      'the sibling project remains untouched'
    )
  })
})
