// Host-wide (NOT per-worktree) durable heavy-task-lease persistence.
// Bounded correction, Main TSF overnight review of Resource Pressure
// Governor V0: the original candidate kept lease state inside opState
// (data-store.mjs), whose TSF_UI_STATE_FILE default resolves relative to
// THIS process's own worktree checkout (import.meta.dirname). Every HQ in
// this environment runs its own TSF server from its own worktree, so that
// gave each HQ an independent, empty lease pool -- two different HQs could
// each acquire the same "kind" lease at once and run a full suite and a
// pilot simultaneously, exactly the destructive overlap the lease exists
// to prevent. A fixed OS-temp-dir path is one real, shared filesystem
// location for every process this user runs on this host, regardless of
// which worktree started it -- genuinely host-wide mutual exclusion.
//
// Reuses cross-process-file-lock.mjs (the same real OS-level exclusive-
// file-creation lock keep-going-run-store.mjs/research-mission-store.mjs
// already trust) so a read-modify-write here is atomic across processes,
// not just within one -- a correctness step beyond the original candidate,
// which only had single-process atomicity via opState's own save.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withFileLock } from './cross-process-file-lock.mjs'

// Overridable so parallel test files (and, later, a real per-host config
// point) don't share state -- mirrors data-store.mjs's TSF_UI_STATE_FILE
// override convention.
const LEASE_DIR =
  process.env.TSF_RESOURCE_PRESSURE_LEASE_DIR || path.join(tmpdir(), 'tsf-resource-pressure-governor')
const LEASE_FILE = path.join(LEASE_DIR, 'leases.json')
const LOCK_FILE = `${LEASE_FILE}.lock`

function readLeasesUnlocked() {
  if (!existsSync(LEASE_FILE)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(LEASE_FILE, 'utf8'))
  } catch {
    // Corrupt/partial file (e.g. a crash mid-write) fails closed to an
    // empty pool rather than throwing and taking the route down with it --
    // the next successful write repairs it.
    return {}
  }
}

function writeLeasesUnlocked(leases) {
  mkdirSync(LEASE_DIR, { recursive: true })
  const tmp = `${LEASE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(leases, null, 2), 'utf8')
  renameSync(tmp, LEASE_FILE)
}

// Reads the current host-wide lease pool under the same lock writers use,
// so a reader never observes a torn write from a concurrent process.
export async function readLeases() {
  return withFileLock(LOCK_FILE, 30_000, () => readLeasesUnlocked())
}

// mutateFn(current) -> next; runs synchronously inside the lock (same
// no-await-inside constraint withFileLock's other callers already have),
// persists `next`, and returns it -- an atomic cross-process
// read-modify-write.
export async function withLeases(mutateFn) {
  return withFileLock(LOCK_FILE, 30_000, () => {
    const next = mutateFn(readLeasesUnlocked())
    writeLeasesUnlocked(next)
    return next
  })
}
