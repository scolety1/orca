// TSF REAL-PILOT READINESS -- FINAL P1 CLOSURE, Finding #22: a live-
// planner-routed question ("is this project on hold?" and its natural
// variants) must never let the model confidently deny a real, active
// hold with zero basis to know otherwise -- it previously had no access
// to project.primaryState/primaryReasonLabel (the SAME canonical,
// hold-aware fact HQ/Work/Projects/Command already read) anywhere in its
// transmitted prompt. Proves the real fix end to end through the actual
// invokeLivePlanner wiring, both with a real hold and with none (an
// honest null, never a fabricated state).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { invokeLivePlanner } from '../server/live-planner.mjs'

const HERE = import.meta.dirname
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

function project(overrides = {}) {
  return {
    id: 'weird-talent-marketplace',
    displayName: 'Weird Talent Marketplace',
    purpose: 'Synthetic, local-only marketplace demonstration.',
    branch: 'codex/semantic-challenger-shootout-20260812',
    lifecycle: 'IDEA_INCUBATOR_LOCAL',
    mission: { id: null, state: 'ONBOARDED', blockedReason: null },
    release: {
      stable: { head: 'ef0e232888b0fe1689ab7433e3f1333807d3b00d' },
      testing: 'UNKNOWN',
      adoption: 'NOT_APPLICABLE_ONBOARDING_ONLY',
      published: 'UNCHANGED_NO_PUBLICATION_ACTION',
      upgrade: null
    },
    health: { status: 'HEALTHY', findings: [] },
    candidate: null,
    receipts: { chain: [] },
    evidence: { resultCapsules: [] },
    ...overrides
  }
}

function opState(overrides = {}) {
  return {
    usageMode: 'BALANCED',
    workSet: ['weird-talent-marketplace'],
    plannerSessions: {},
    ...overrides
  }
}

async function withStubEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
    }
  }
}

async function promptFor(project_) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-ops-'))
  const debugFile = path.join(dir, 'argv.json')
  try {
    await withStubEnv(
      {
        TSF_PLANNER_CLAUDE_COMMAND: STUB,
        STUB_MODE: 'success',
        STUB_SESSION_ID: 's1',
        STUB_DEBUG_FILE: debugFile
      },
      () =>
        invokeLivePlanner({
          project: project_,
          message: 'is this project on hold?',
          opState: opState(),
          recentHistory: []
        })
    )
    const seen = JSON.parse(readFileSync(debugFile, 'utf8'))
    return seen.args[seen.args.indexOf('--system-prompt') + 1]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('Finding #22: a real, canonical execution-hold primaryState reaches the live planner system prompt', async () => {
  const p = await promptFor(
    project({ primaryState: 'WAITING', primaryReasonLabel: 'Execution hold' })
  )
  assert.match(p, /"state":\s*"WAITING"/)
  assert.match(p, /"reason":\s*"Execution hold"/)
  assert.match(p, /answer strictly from operatorFacts\.ownerPrimaryState/i)
})

test('Finding #22: no hold/no primaryState computed -> transmits an honest null, never a fabricated state', async () => {
  const p = await promptFor(project())
  assert.match(p, /"ownerPrimaryState":\s*\{\s*"state":\s*null,\s*"reason":\s*null/)
})
