#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// resource-pressure-lease-host-wide.test.mjs -- each invocation simulates
// a DIFFERENT HQ's TSF server (its own TSF_UI_STATE_FILE, inherited from
// the parent's env, so it would have its own independent opState) trying
// to acquire or release one heavy-task lease. Proves the lease store
// itself is shared across processes/worktrees via
// TSF_RESOURCE_PRESSURE_LEASE_DIR, not just within one process.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , op, kind, missionId, resultPath] = process.argv

const { withLeases } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'resource-pressure-lease-store.mjs'))
    .href
)
const { requestHeavyTaskLease, releaseHeavyTaskLease } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'domain', 'resource-pressure-governor.mjs'))
    .href
)

let result
if (op === 'acquire') {
  await withLeases((current) => {
    result = requestHeavyTaskLease(current, { kind, missionId }, 'HEALTHY')
    return result.leases
  })
} else if (op === 'release') {
  await withLeases((current) => {
    result = releaseHeavyTaskLease(current, { kind, missionId })
    return result.leases
  })
} else {
  throw new Error(`unknown op: ${op}`)
}

writeFileSync(resultPath, JSON.stringify(result))
