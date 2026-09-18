import path from 'node:path'
process.env.TSF_UI_STATE_FILE = path.join(
  process.cwd(),
  'server',
  '.local-state',
  'rdd-v1-refinement-pilot-state.json'
)
process.env.TSF_DISPOSABLE_RUNTIME = '1'
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
const clock = () => new Date()
const PROJECT_ID = 'rdd-v1-pilot-refinement'
const RECONCILIATION_VERIFICATION_TASK_ID = 'tsf-reconciliation-verification'
const { readKeepGoingRun } = await import('./server/keep-going-run-store.mjs')
const { driveOneCycle } = await import('./server/keep-going-fleet-driver.mjs')
const before = readKeepGoingRun(PROJECT_ID)
if (before.state === 'NEEDS_YOU') {
  const open = before.needsYou.find((n) => !n.resolvedAt)
  console.log('OPEN_QUESTION', JSON.stringify(open))
} else if (['COMPLETE', 'STALLED', 'BLOCKED'].includes(before.state)) {
  console.log('TERMINAL', before.state)
} else {
  const priorRetries = before.retryCounts?.[RECONCILIATION_VERIFICATION_TASK_ID] ?? 0
  const results = await driveOneCycle([PROJECT_ID], clock, {})
  console.log('CYCLE', JSON.stringify(results).slice(0, 700))
  const after = readKeepGoingRun(PROJECT_ID)
  const afterRetries = after?.retryCounts?.[RECONCILIATION_VERIFICATION_TASK_ID] ?? 0
  if (afterRetries > priorRetries) {
    console.log(`*** REAL VERIFICATION FAILURE -> REFINEMENT TRIGGERED (pass #${afterRetries}) ***`)
    console.log('checkpoint evidence:', JSON.stringify(after.checkpoints.slice(-1)))
  }
}
const after2 = readKeepGoingRun(PROJECT_ID)
console.log(
  'STATE',
  after2.state,
  'revision',
  after2.revision,
  'inFlightWave',
  Boolean(after2.inFlightWave),
  'waves',
  after2.waves.length,
  'retryCounts',
  JSON.stringify(after2.retryCounts)
)
