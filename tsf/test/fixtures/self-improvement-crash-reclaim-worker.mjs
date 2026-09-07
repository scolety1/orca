#!/usr/bin/env node
// Wave D Phase 10 chaos scenario 1 fixture: a genuinely separate OS process
// that runs the REAL originateRepairMission for a real ELIGIBLE_FOR_AUTOFIX
// finding, writes a marker proving the mission checkpoint is durably on
// disk, then NEVER proceeds further and never exits -- simulating a real
// planner crash immediately after origination, before any worker was ever
// dispatched. Mirrors planner-crash-reclaim-worker.mjs's own
// acquire-then-hang shape (REUSE_PATTERN).
//
// Usage: node self-improvement-crash-reclaim-worker.mjs <findingJsonPath> <canonicalRepoPath> <resultPath>
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , findingJsonPath, canonicalRepoPath, resultPath] = process.argv
const finding = JSON.parse(readFileSync(findingJsonPath, 'utf8'))

const { originateRepairMission } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'self-improvement-mission-origination.mjs')).href
)

const fakeHealthyMemory = () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, usedPercent: 50 })
const repoState = { branch: 'tsf/self-improve/crash-fixture', sha: 'd'.repeat(40) }

const result = await originateRepairMission(finding, {
  canonicalRepoPath,
  clock: () => new Date(),
  deps: { observeRepoState: () => repoState, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
})

// Written the moment the real mission checkpoint is durable on disk --
// proves this child genuinely completed real origination before dying.
writeFileSync(resultPath, JSON.stringify({ originated: true, created: result.created, missionId: result.missionId }))

// Simulates a crash: never dispatches a worker, never exits on its own.
await new Promise(() => {})
