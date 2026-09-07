#!/usr/bin/env node
// Wave D Phase 10 chaos scenario 4 fixture: a genuinely separate OS process
// that originates a real repair mission, runs ONE real repair attempt (fake
// worker + fake verifier reporting VERIFIED_FAIL, no real Codex/git-diff
// needed for this durability proof), writes a marker proving the durable
// checkpoint's verifierResults[] entry is really on disk, then hangs
// forever -- simulating a genuine backend crash/restart mid-repair-cycle.
//
// Usage: node self-improvement-backend-restart-worker.mjs <findingJsonPath> <canonicalRepoPath> <resultPath>
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , findingJsonPath, canonicalRepoPath, resultPath] = process.argv
const finding = JSON.parse(readFileSync(findingJsonPath, 'utf8'))

const { originateRepairMission } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'self-improvement-mission-origination.mjs')).href
)
const { runRepairAttempt } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'self-improvement-repair-cycle.mjs')).href
)

const fakeHealthyMemory = () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, usedPercent: 50 })
const fakeDispatch = async () => ({ workerId: 'restart-fixture-worker-1', providerId: 'openai', agentId: 'codex', exitCode: 0, timedOut: false })
const fakeVerifierFail = async () => ({ verdict: 'VERIFIED_FAIL', reasons: ['REPRODUCTION_STILL_FAILS'], detail: {} })

const origination = await originateRepairMission(finding, {
  canonicalRepoPath,
  clock: () => new Date(),
  deps: { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
})

const attempt = await runRepairAttempt({
  finding,
  missionId: origination.missionId,
  canonicalRepoPath,
  clock: () => new Date(),
  deps: { dispatchWorker: fakeDispatch, runIndependentVerification: fakeVerifierFail, currentHeadSha: async () => 'e'.repeat(40), lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
})

writeFileSync(resultPath, JSON.stringify({ done: true, missionId: origination.missionId, outcome: attempt.outcome }))

// Simulates a crash: never runs attempt 2, never exits on its own.
await new Promise(() => {})
