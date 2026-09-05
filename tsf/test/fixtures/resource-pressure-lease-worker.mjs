#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// resource-pressure-lease-host-wide.test.mjs -- each invocation simulates
// a DIFFERENT HQ's TSF server (its own TSF_UI_STATE_FILE, inherited from
// the parent's env, so it would have its own independent opState) trying
// to acquire or release one heavy-task lease, or racing another such
// process to acquire the same one. Proves the lease store itself is
// shared across processes/worktrees via TSF_RESOURCE_PRESSURE_LEASE_DIR,
// not just within one process.
//
// Usage: node resource-pressure-lease-worker.mjs <op> <kind> <missionId> <resultPath> [ttlMs] [startMarkerPath]
//   op: 'acquire' | 'release' | 'hold' (acquire, write a start marker, then
//   sleep forever until killed -- never releases; simulates a crashed
//   holder for stale-lease-recovery proofs).
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , op, kind, missionId, resultPath, ttlMsArg, startMarkerPath] = process.argv
const ttlMs = ttlMsArg ? Number(ttlMsArg) : undefined

const { withLeases } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'resource-pressure-lease-store.mjs'))
    .href
)
const { requestHeavyTaskLease, releaseHeavyTaskLease } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'domain', 'resource-pressure-governor.mjs'))
    .href
)

let result
if (op === 'acquire' || op === 'hold') {
  // Written BEFORE the acquire attempt so a genuine-race test can confirm
  // both processes actually overlapped, not that one happened to finish
  // first -- same discipline keep-going-run-store-cross-process.test.mjs's
  // own worker fixture already uses.
  if (startMarkerPath) {
    writeFileSync(startMarkerPath, String(Date.now()))
  }
  await withLeases((current) => {
    result = requestHeavyTaskLease(current, { kind, missionId, ttlMs }, 'HEALTHY')
    return result.leases
  })
  if (op === 'hold') {
    writeFileSync(resultPath, JSON.stringify(result))
    // Never releases, never exits on its own -- the test kills this
    // process (SIGKILL) to simulate a genuine crash while the lease is
    // held. Sleeps rather than busy-waiting.
    await new Promise(() => {})
  }
} else if (op === 'release') {
  await withLeases((current) => {
    result = releaseHeavyTaskLease(current, { kind, missionId })
    return result.leases
  })
} else {
  throw new Error(`unknown op: ${op}`)
}

writeFileSync(resultPath, JSON.stringify(result))
