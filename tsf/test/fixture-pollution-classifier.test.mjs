// TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: proves the classifier both (a)
// never matches the real projects it must never touch -- the mission's own
// explicit "real-project negative control" requirement -- and (b), when a
// local forensic backup from the actual incident is present on this
// machine, confirms real observed pollution and flags nothing ambiguous.
// The forensic backup is a gitignored, one-off local artifact (never
// committed -- see docs/tsf/TSF_FIXTURE_POLLUTION_RECONCILIATION_V1.md), so
// part (b) skips cleanly on a fresh clone/CI instead of depending on it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  classifyFixturePollutionCandidate,
  findFixturePollutionCandidateIds,
  matchesFixtureIdScheme
} from '../domain/fixture-pollution-classifier.mjs'

const BACKUP_DIR = path.join(
  import.meta.dirname,
  '..',
  'server',
  '.local-state',
  'forensic-backups'
)

function realProjectNegativeControlState() {
  return {
    keepGoingRuns: {
      'niners-war-room': {
        originalGoal: { statement: 'a real draft-day mission', acceptanceCriteria: ['ship it'] },
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      'worldforge-sablewake-live-runtime-repair-v3': {
        originalGoal: { statement: 'a real repair mission', acceptanceCriteria: ['ship it'] },
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      'tsf-orca': {
        originalGoal: { statement: 'a real TSF mission', acceptanceCriteria: ['ship it'] },
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    },
    onboardedProjects: {
      'niners-war-room': { repoPath: 'C:\\NWR\\Niners-War-Room' },
      'worldforge-sablewake-live-runtime-repair-v3': { repoPath: 'C:\\WorldForge\\Sablewake' },
      'tsf-orca': { repoPath: 'C:\\TSF_ORCA' }
    },
    chatThreads: {},
    projectExecutionHolds: {},
    projectCanonicalBases: {},
    portfolio: { knownProjects: {}, activeFleet: {}, workSet: [] }
  }
}

function loadLatestBackup() {
  if (!existsSync(BACKUP_DIR)) {
    return null
  }
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    return null
  }
  const newest = files.sort().at(-1)
  return JSON.parse(readFileSync(path.join(BACKUP_DIR, newest), 'utf8'))
}

test('REAL-PROJECT NEGATIVE CONTROL: niners-war-room, the real WorldForge project, and tsf-orca never match the fixture id scheme', () => {
  const state = realProjectNegativeControlState()
  for (const id of Object.keys(state.keepGoingRuns)) {
    assert.equal(matchesFixtureIdScheme(id), false, `${id} must never match the fixture id scheme`)
    const result = classifyFixturePollutionCandidate(id, state)
    assert.equal(
      result.classification,
      'AMBIGUOUS_REQUIRES_OWNER',
      `${id} must never classify as CONFIRMED_TEST_FIXTURE_POLLUTION`
    )
  }
})

test('REAL-PROJECT NEGATIVE CONTROL (adversarial): a synthetic real project carrying fixture-like CONTENT but a real id never confirms', () => {
  const state = {
    keepGoingRuns: {
      'niners-war-room': {
        originalGoal: {
          statement: 'stub-plan-for::this is deliberately adversarial content, not a real fixture',
          acceptanceCriteria: ['stub acceptance criterion']
        },
        checkpoints: [{ evidence: ['stub-task-id'] }],
        createdAt: '2026-09-09T22:13:54.196Z'
      }
    },
    onboardedProjects: {
      'niners-war-room': {
        repoPath:
          'C:\\Users\\codex-agent\\AppData\\Local\\Temp\\tsf-command-operator-integration-nytheria-target-ABCDEF'
      }
    },
    chatThreads: {},
    projectExecutionHolds: {},
    projectCanonicalBases: {},
    portfolio: { knownProjects: {}, activeFleet: {}, workSet: [] }
  }
  const result = classifyFixturePollutionCandidate('niners-war-room', state)
  assert.equal(
    result.classification,
    'AMBIGUOUS_REQUIRES_OWNER',
    'id-scheme mismatch alone must block confirmation even when every other signal looks like a fixture'
  )
})

test('a record carrying a real execution hold never confirms, even with a matching id and fixture content', () => {
  const id = 'tsf-command-operator-integration-nytheria-target-abc123'
  const state = {
    keepGoingRuns: {
      [id]: {
        originalGoal: {
          statement: 'stub-plan-for::x',
          acceptanceCriteria: ['stub acceptance criterion']
        },
        checkpoints: [{ evidence: ['stub-task-id'] }],
        createdAt: '2026-09-09T22:13:54.196Z'
      }
    },
    onboardedProjects: {
      [id]: { repoPath: `C:\\Users\\codex-agent\\AppData\\Local\\Temp\\${id}` }
    },
    chatThreads: {},
    projectExecutionHolds: { [id]: { reason: 'a real hold, somehow, on this id' } },
    projectCanonicalBases: {},
    portfolio: { knownProjects: {}, activeFleet: {}, workSet: [] }
  }
  const result = classifyFixturePollutionCandidate(id, state)
  assert.equal(result.classification, 'AMBIGUOUS_REQUIRES_OWNER')
  assert.equal(result.signals.noLegitimateActivity, false)
})

test('a record with an unscripted (non-test-dialogue) chat message never confirms', () => {
  const id = 'tsf-command-operator-integration-worldforge-keep-zzz999'
  const state = {
    keepGoingRuns: {
      [id]: {
        originalGoal: {
          statement: 'stub-plan-for::x',
          acceptanceCriteria: ['stub acceptance criterion']
        },
        checkpoints: [{ evidence: ['stub-task-id'] }],
        createdAt: '2026-09-09T22:13:54.196Z'
      }
    },
    onboardedProjects: {
      [id]: { repoPath: `C:\\Users\\codex-agent\\AppData\\Local\\Temp\\${id}` }
    },
    chatThreads: { [id]: [{ role: 'user', content: 'an owner actually typed this' }] },
    projectExecutionHolds: {},
    projectCanonicalBases: {},
    portfolio: { knownProjects: {}, activeFleet: {}, workSet: [] }
  }
  const result = classifyFixturePollutionCandidate(id, state)
  assert.equal(result.classification, 'AMBIGUOUS_REQUIRES_OWNER')
  assert.equal(result.signals.chatScripted, false)
})

test('LOCAL FORENSIC BACKUP (skips if absent): every real incident candidate confirms, none are ambiguous', (t) => {
  const state = loadLatestBackup()
  if (!state) {
    t.skip('no local forensic backup present on this machine (gitignored, not committed)')
    return
  }
  const candidateIds = findFixturePollutionCandidateIds(state)
  assert.ok(candidateIds.length > 0, 'the real backup must contain at least one fixture-shaped id')
  const results = candidateIds.map((id) => classifyFixturePollutionCandidate(id, state))
  const ambiguous = results.filter((r) => r.classification === 'AMBIGUOUS_REQUIRES_OWNER')
  assert.deepEqual(
    ambiguous.map((r) => ({ id: r.id, signals: r.signals })),
    [],
    'no ambiguous records expected against the real incident backup'
  )
  const confirmed = results.filter((r) => r.classification === 'CONFIRMED_TEST_FIXTURE_POLLUTION')
  assert.equal(confirmed.length, candidateIds.length)
})
