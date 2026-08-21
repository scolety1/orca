import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.STUB_MODE = 'success'
process.env.STUB_WBS_MULTI = '1'

const { listEvalPacks, getEvalPackEntry } = await import('../server/eval-pack-registry.mjs')
const { runEvalPack } = await import('../domain/evaluation-pack.mjs')

test('listEvalPacks names all 7 required M9 categories, each with a real, non-empty pack', () => {
  const packs = listEvalPacks()
  assert.equal(packs.length, 7)
  assert.deepEqual(
    packs.map((p) => p.category).sort(),
    ['AUTONOMY', 'ESTIMATOR', 'MEMORY', 'PLANNER', 'ROUTING', 'VERIFIER', 'WORKER'].sort()
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
