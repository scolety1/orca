// TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: one-time, narrowly-scoped
// reconciliation. Removes ONLY records domain/fixture-pollution-
// classifier.mjs CONFIRMS as test fixture pollution (every one of its 5
// independent signals must agree -- see that module and docs/tsf/
// TSF_FIXTURE_POLLUTION_RECONCILIATION_V1.md) from the live owner state
// file, after a mandatory local quarantine snapshot. Never a generic
// destructive admin API -- this script does exactly one thing, once.
//
// Dry-run by default; --apply is required to actually mutate anything.
//
// Usage (from tsf/):
//   node scripts/reconcile-fixture-pollution.mjs            # dry run
//   node scripts/reconcile-fixture-pollution.mjs --apply     # apply
//
// Rollback: every removed record is written verbatim, with the exact
// source-state hash and candidate ids, to a timestamped JSON file under
// server/.local-state/fixture-pollution-quarantine/ (gitignored, never
// committed). To roll back, read that file's `removed` object and merge
// its keepGoingRuns/onboardedProjects/chatThreads/portfolioProjects
// entries back into the live state file's own top-level collections by
// id (and portfolioProjects back into portfolio.projects).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getStateFilePath, loadState, saveState } from '../server/data-store.mjs'
import { withFileLock } from '../server/cross-process-file-lock.mjs'
import {
  classifyFixturePollutionCandidate,
  findFixturePollutionCandidateIds
} from '../domain/fixture-pollution-classifier.mjs'

const APPLY = process.argv.includes('--apply')
const QUARANTINE_DIR = path.join(path.dirname(getStateFilePath()), 'fixture-pollution-quarantine')

function sha256(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

function buildPlan(state) {
  const candidateIds = findFixturePollutionCandidateIds(state)
  const results = candidateIds.map((id) => classifyFixturePollutionCandidate(id, state))
  const confirmed = results.filter((r) => r.classification === 'CONFIRMED_TEST_FIXTURE_POLLUTION')
  const ambiguous = results.filter((r) => r.classification !== 'CONFIRMED_TEST_FIXTURE_POLLUTION')
  return { candidateIds, results, confirmed, ambiguous }
}

function removeConfirmedRecords(state, confirmedIds) {
  const removed = { keepGoingRuns: {}, onboardedProjects: {}, chatThreads: {}, portfolioProjects: {} }
  for (const id of confirmedIds) {
    if (state.keepGoingRuns?.[id]) {
      removed.keepGoingRuns[id] = state.keepGoingRuns[id]
      delete state.keepGoingRuns[id]
    }
    if (state.onboardedProjects?.[id]) {
      removed.onboardedProjects[id] = state.onboardedProjects[id]
      delete state.onboardedProjects[id]
    }
    if (state.chatThreads?.[id]) {
      removed.chatThreads[id] = state.chatThreads[id]
      delete state.chatThreads[id]
    }
    if (state.portfolio?.projects?.[id]) {
      removed.portfolioProjects[id] = state.portfolio.projects[id]
      delete state.portfolio.projects[id]
    }
    // A confirmed fixture record never legitimately reached
    // activeFleet/workSet (that is one of the classifier's own required
    // signals) -- stripped defensively anyway, never a no-op assumption.
    if (Array.isArray(state.portfolio?.activeFleet)) {
      state.portfolio.activeFleet = state.portfolio.activeFleet.filter((x) => x !== id)
    }
    if (Array.isArray(state.portfolio?.workSet)) {
      state.portfolio.workSet = state.portfolio.workSet.filter((x) => x !== id)
    }
  }
  return removed
}

function scanForDanglingReferences(state, confirmedIds) {
  const dangling = []
  for (const collectionKey of Object.keys(state)) {
    const serialized = JSON.stringify(state[collectionKey])
    if (!serialized) {
      continue
    }
    for (const id of confirmedIds) {
      if (serialized.includes(id)) {
        dangling.push({ collection: collectionKey, id })
      }
    }
  }
  return dangling
}

async function main() {
  const state = loadState()
  const plan = buildPlan(state)

  console.log(`TSF_FIXTURE_POLLUTION_RECONCILIATION_V1 -- ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`state file: ${getStateFilePath()}`)
  console.log(`candidates found: ${plan.candidateIds.length}`)
  console.log(`confirmed: ${plan.confirmed.length}`)
  console.log(`ambiguous: ${plan.ambiguous.length}`)
  if (plan.ambiguous.length > 0) {
    console.log('AMBIGUOUS_REQUIRES_OWNER records (will NEVER be touched by this script):')
    for (const result of plan.ambiguous) {
      console.log(`  ${result.id} -- ${JSON.stringify(result.signals)}`)
    }
  }

  if (plan.confirmed.length === 0) {
    console.log('nothing confirmed -- nothing to reconcile.')
    return
  }

  const confirmedIds = plan.confirmed.map((result) => result.id)
  const preHash = sha256(state)
  console.log(`pre-state sha256: ${preHash}`)

  if (!APPLY) {
    console.log('DRY RUN -- pass --apply to actually write. Confirmed candidate ids:')
    for (const id of confirmedIds) {
      console.log(`  ${id}`)
    }
    return
  }

  // Serializes against the live server's own keepGoingRuns critical
  // sections via the SAME lock path keep-going-run-store.mjs uses -- this
  // targets a real, currently-running server's state file, not an offline
  // snapshot.
  await withFileLock(`${getStateFilePath()}.lock`, 30_000, () => {
    const freshState = loadState()
    const freshPreHash = sha256(freshState)
    if (freshPreHash !== preHash) {
      throw new Error(
        `TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: state changed between plan and apply (expected ${preHash}, got ${freshPreHash}) -- refusing to apply a stale plan. Re-run to recompute.`
      )
    }

    mkdirSync(QUARANTINE_DIR, { recursive: true })
    const removed = removeConfirmedRecords(freshState, confirmedIds)
    const quarantinedAt = new Date().toISOString()
    const quarantineRecord = {
      schemaVersion: 'TSF_FIXTURE_POLLUTION_QUARANTINE_V1',
      quarantinedAt,
      sourceStateHash: preHash,
      candidateIds: confirmedIds,
      reason:
        'CONFIRMED_TEST_FIXTURE_POLLUTION -- tsf-command-operator-integration-nytheria/worldforge-* fixtures from tsf/test/command-operator-integration-adversarial.test.mjs, written into the real owner state file by a data-store.mjs env-var-caching isolation bug (see the TSF-SAFE-UI-001-ROOT-CAUSE comment in server/data-store.mjs), never real owner projects.',
      removed
    }
    const quarantineFile = path.join(
      QUARANTINE_DIR,
      `fixture-pollution-quarantine.${quarantinedAt.replace(/[:.]/g, '-')}.json`
    )
    writeFileSync(quarantineFile, JSON.stringify(quarantineRecord, null, 2), 'utf8')

    const dangling = scanForDanglingReferences(freshState, confirmedIds)
    if (dangling.length > 0) {
      throw new Error(
        `TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: ${dangling.length} dangling reference(s) remain after removal -- refusing to save. ${JSON.stringify(dangling.slice(0, 10))}`
      )
    }

    saveState(freshState)
    console.log(`quarantine written: ${quarantineFile}`)
    console.log(`removed ${confirmedIds.length} confirmed fixture record(s).`)
    console.log(`post-write sha256: ${sha256(freshState)}`)
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
