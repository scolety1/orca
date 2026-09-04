import path from 'node:path'
import { runLiveBakeoff } from './fixtures/live-bakeoff-runner.mjs'

const parallelApiKey = process.env.PARALLEL_API_KEY
const exaApiKey = process.env.EXA_API_KEY

if (!parallelApiKey || !exaApiKey) {
  console.error('NEEDS_SECURE_PROVIDER_CREDENTIALS: PARALLEL_API_KEY/EXA_API_KEY not present in process.env')
  process.exit(1)
}

const outDir = path.join(process.cwd(), 'fixtures', 'captured-bakeoff-results')

console.log('Starting governed live bake-off (credentials confirmed present, values never logged)...')
const { state } = await runLiveBakeoff({ parallelApiKey, exaApiKey, outDir })
console.log('Bake-off complete.')
console.log('totalDispatched:', state.totalDispatched)
console.log('retriesUsed:', state.retriesUsed)
console.log('cumulativeSpendUsd (list price):', state.cumulativeSpendUsd)
for (const entry of state.callLog) {
  console.log(`  ${entry.providerId} ${entry.nodeId}: ok=${entry.ok} status=${entry.status} reason=${entry.reason ?? entry.failureReason} detail=${entry.detail} latencyMs=${entry.latencyMs} pollCount=${entry.pollCount} run=${entry.workerRunRef?.providerRunId} listPrice=$${entry.listPriceCostUsd} providerReported=${entry.providerReportedCostUsd}`)
}
