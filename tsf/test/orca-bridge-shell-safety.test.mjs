// Real V1 stabilization finding (sibling of the Planner Chat live-use
// defect -- see test/planner-chat-arg-safety.test.mjs and
// providers/resolve-agent-entry.mjs for the real, reproduced root cause):
// three Orca bridge adapters shared the identical bare-PATH-fallback
// pattern, `{ command: 'orca', viaShell: process.platform === 'win32' }`.
// registerOrcaRepo (orca-cli-bridge.mjs) passes a real, arbitrary
// filesystem path -- which can contain spaces -- through this same
// fallback-then-shell:true chain; the orchestration bridge's callers pass
// real prompt/comment/title text the same way. Confirmed directly: `orca`
// on PATH is a real installed .exe (not an npm .cmd/.ps1 shim) and runs
// correctly via spawn with shell:false, so shell:true was never actually
// needed here at all -- corrected to false in all three.
import assert from 'node:assert/strict'
import test from 'node:test'
import { candidateEntries as cliCandidates } from '../adapters/orca-cli-bridge.mjs'
import { candidateEntries as capacityCandidates } from '../adapters/orca-capacity-bridge.mjs'
import { candidateEntries as orchestrationCandidates } from '../adapters/orca-orchestration-bridge.mjs'

const MODULES = {
  'orca-cli-bridge': cliCandidates,
  'orca-capacity-bridge': capacityCandidates,
  'orca-orchestration-bridge': orchestrationCandidates
}

for (const [name, candidateEntries] of Object.entries(MODULES)) {
  test(`${name}: the bare 'orca' PATH fallback never uses shell:true`, () => {
    const candidates = candidateEntries()
    const fallback = candidates.find((c) => c.command === 'orca')
    assert.ok(fallback, 'the bare-orca fallback candidate must still exist')
    assert.equal(fallback.viaShell, false)
  })
}
