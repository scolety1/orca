import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
// Phase 13: the two new GOLDEN_PATH packs are the first packs in this
// registry to transitively touch server/data-store.mjs (via
// command-responder.mjs / research-mission-store.mjs) -- its STATE_FILE is
// a module-level constant resolved from this env var ONLY ONCE, at first
// import, anywhere in this process. Isolated here (matching every other
// test file's own established convention, e.g. http-eval.test.mjs) so the
// REQUIRED PROOF run below never touches the real, shared local dev state
// file on this host.
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-eval-pack-registry-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.keep-going.lock', '.research.lock', '.research-library.lock', '.platform-learning-ledger.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'
process.env.STUB_WBS_MULTI = '1'
// Finding F1: generateWbs now consults the Resource Pressure Governor --
// forces HEALTHY so this file's own assertions never flake on a genuinely
// shared, loaded host, mirroring chat-dispatch-bridge.test.mjs's convention.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { listEvalPacks, getEvalPackEntry } = await import('../server/eval-pack-registry.mjs')
const { runEvalPack } = await import('../domain/evaluation-pack.mjs')

test('listEvalPacks names all 10 required categories (M9 + Phase 1 UI_DOGFOOD + Phase 13 GOLDEN_PATH x2), each with a real, non-empty pack', () => {
  const packs = listEvalPacks()
  assert.equal(packs.length, 10)
  assert.deepEqual(
    packs.map((p) => p.category).sort(),
    [
      'AUTONOMY',
      'ESTIMATOR',
      'GOLDEN_PATH',
      'GOLDEN_PATH',
      'MEMORY',
      'PLANNER',
      'ROUTING',
      'UI_DOGFOOD',
      'VERIFIER',
      'WORKER'
    ].sort()
  )
  for (const p of packs) {
    assert.ok(p.caseCount > 0)
  }
})

test('getEvalPackEntry returns null for an unknown packId', () => {
  assert.equal(getEvalPackEntry('not-a-real-pack'), null)
})

test('REQUIRED PROOF: every registered pack genuinely runs end to end without error and passes against its own real capability', async () => {
  for (const { packId } of listEvalPacks()) {
    // eslint-disable-next-line no-await-in-loop -- each pack's own real capability run is inherently sequential; small, bounded set
    const entry = getEvalPackEntry(packId)
    // eslint-disable-next-line no-await-in-loop
    const actualOutputs = await entry.run(entry.pack)
    const run = runEvalPack(entry.pack, actualOutputs)
    assert.equal(run.passRate, 1, `${packId} did not pass 100% against its own real capability`)
  }
})
