import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { buildResearchProvenancePackage, canonicalOutputToCsv } from './domain/research-provenance.mjs'
import { verifyReceipt } from './domain/receipts.mjs'

const clock = () => new Date('2026-09-03T10:15:00.000Z')
const dir = 'fixtures/captured-bakeoff-results'
const mission = JSON.parse(readFileSync(`${dir}/mission-with-sources.json`, 'utf8'))

const { packageBody, receipt } = buildResearchProvenancePackage(mission, { decidedBy: 'smcolety@gmail.com', clock })
console.log('receipt valid:', verifyReceipt(receipt))
console.log('integrityReport status:', packageBody.integrityReport.status)

writeFileSync(`${dir}/provenance-package.json`, JSON.stringify(packageBody, null, 2))
writeFileSync(`${dir}/provenance-receipt.json`, JSON.stringify(receipt, null, 2))
writeFileSync(`${dir}/canonical-output.csv`, canonicalOutputToCsv(mission, clock))
writeFileSync(`${dir}/mission.json`, JSON.stringify(mission, null, 2))

// Clean up superseded intermediates.
for (const stale of ['evaluated-mission.json', 'mission-with-sources.json']) {
  rmSync(`${dir}/${stale}`, { force: true })
}
console.log('Finalized. CSV line count:', canonicalOutputToCsv(mission, clock).trim().split('\n').length)
