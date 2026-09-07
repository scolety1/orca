import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
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

test('listEvalPacks names all 8 required categories (M9 + Phase 1 UI_DOGFOOD), each with a real, non-empty pack', () => {
  const packs = listEvalPacks()
  assert.equal(packs.length, 8)
  assert.deepEqual(
    packs.map((p) => p.category).sort(),
    [
      'AUTONOMY',
      'ESTIMATOR',
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
    const entry = getEvalPackEntry(packId)
    const actualOutputs = await entry.run(entry.pack)
    const run = runEvalPack(entry.pack, actualOutputs)
    assert.equal(run.passRate, 1, `${packId} did not pass 100% against its own real capability`)
  }
})
