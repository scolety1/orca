// Compare-and-swap over the single, durable, cross-mission Platform
// Learning Ledger. Mirrors research-library-store.mjs's withResearchLibrary
// exactly (REUSE_PATTERN) -- same cross-process file lock, same
// synchronous-critical-section constraint, same singleton-not-keyed-by-
// missionId shape, its own lock file so a busy mission write never blocks a
// ledger read/write or vice versa. Per-worktree scope, like every other
// opState collection here (see data-store.mjs) -- a real cross-worktree
// ledger sync is out of this bounded wave's scope, disclosed in the
// checkpoint doc, not silently assumed.
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedPlatformLearningLedgerSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.platform-learning-ledger.lock`
}

function ledgerFrom(opState) {
  const ledger = opState.platformLearningLedger ?? null
  if (ledger) {
    assertSupportedPlatformLearningLedgerSchemaVersion(ledger)
  }
  return ledger
}

export function readPlatformLearningLedger() {
  return ledgerFrom(loadState())
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// ledger (or null if never used before -- the caller is responsible for
// calling emptyPlatformLearningLedger() in that case, exactly like
// withResearchLibrary's mutateFn(null) convention), return the next
// ledger, or throw to abort -- nothing is persisted if it throws.
export async function withPlatformLearningLedger(mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const next = mutateFn(ledgerFrom(opState))
    saveState({ ...opState, platformLearningLedger: next })
    return next
  })
}
