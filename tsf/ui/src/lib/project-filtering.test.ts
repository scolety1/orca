import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesSearch, sortProjects } from './project-filtering.ts'
import type { ProjectCard } from './types.ts'

function project(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    id: 'proj',
    displayName: 'Proj',
    sourceClass: 'REAL',
    lifecycle: 'ONBOARDED',
    activeFleet: false,
    workSet: false,
    missionState: 'ONBOARDED',
    blockedReason: null,
    healthStatus: 'HEALTHY',
    topFinding: null,
    migrationClassification: null,
    restrictions: [],
    release: {
      stable: { head: null, tree: null },
      previousStable: null,
      upgrade: null,
      testing: 'UNKNOWN',
      adoption: 'UNKNOWN',
      published: 'UNKNOWN'
    },
    candidateState: null,
    ...overrides
  }
}

test('matchesSearch matches on displayName, id, and migrationClassification, case-insensitively', () => {
  const p = project({
    id: 'weird-talent',
    displayName: 'Weird Talent Marketplace',
    migrationClassification: 'SENSITIVE'
  })
  assert.equal(matchesSearch(p, ''), true)
  assert.equal(matchesSearch(p, 'weird'), true)
  assert.equal(matchesSearch(p, 'TALENT'), true)
  assert.equal(matchesSearch(p, 'sensitive'), true)
  assert.equal(matchesSearch(p, 'nope'), false)
})

test('sortProjects NAME_ASC sorts by displayName, case-insensitively', () => {
  const projects = [
    project({ id: 'b', displayName: 'Beta' }),
    project({ id: 'a', displayName: 'alpha' })
  ]
  const sorted = sortProjects(projects, 'NAME_ASC')
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['a', 'b']
  )
})

test('sortProjects NEEDS_ATTENTION_FIRST puts a blockedReason project before a healthy one', () => {
  const needsYou = project({ id: 'needs-you', displayName: 'Zeta', blockedReason: 'Tim required' })
  const readyForWork = project({ id: 'ready', displayName: 'Alpha', healthStatus: 'HEALTHY' })
  const sorted = sortProjects([readyForWork, needsYou], 'NEEDS_ATTENTION_FIRST')
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['needs-you', 'ready']
  )
})

test('sortProjects NEEDS_ATTENTION_FIRST breaks ties within the same bucket by name', () => {
  const projects = [
    project({ id: 'b', displayName: 'Beta', healthStatus: 'HEALTHY' }),
    project({ id: 'a', displayName: 'Alpha', healthStatus: 'HEALTHY' })
  ]
  const sorted = sortProjects(projects, 'NEEDS_ATTENTION_FIRST')
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['a', 'b']
  )
})

test('sortProjects a BLOCKED project outranks a READY_FOR_WORK one', () => {
  const blocked = project({ id: 'blocked', displayName: 'Zeta', missionState: 'BLOCKED_SOMETHING' })
  const ready = project({ id: 'ready', displayName: 'Alpha', healthStatus: 'HEALTHY' })
  const sorted = sortProjects([ready, blocked], 'NEEDS_ATTENTION_FIRST')
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['blocked', 'ready']
  )
})
