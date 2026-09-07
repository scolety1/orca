// Phase 3 Wave 2 (3C): OWNER_SUPPLIED_LOCAL_ARTIFACT domain-level proof.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireOwnerSuppliedLocalArtifact } from '../domain/owner-supplied-local-artifact-acquisition.mjs'

const clock = () => new Date('2026-09-08T10:00:00.000Z')
const TABLE_HTML = '<html><body><table><tr><th>Player</th><th>Passing / Yards</th></tr><tr><td>Brett Favre</td><td>4413</td></tr></table></body></html>'

test('requires an explicit ownerAssertion.assertedBy -- never fabricates provenance', async () => {
  await assert.rejects(
    () => acquireOwnerSuppliedLocalArtifact({ content: TABLE_HTML, ownerAssertion: {}, clock }),
    /assertedBy/
  )
})

test('requires exactly one of filePath or content', async () => {
  await assert.rejects(
    () => acquireOwnerSuppliedLocalArtifact({ ownerAssertion: { assertedBy: 'TIM' }, clock }),
    /exactly one of filePath or content/
  )
  await assert.rejects(
    () => acquireOwnerSuppliedLocalArtifact({ filePath: '/x', content: 'y', ownerAssertion: { assertedBy: 'TIM' }, clock }),
    /exactly one of filePath or content/
  )
})

test('ingests inline content: real receipt with provenance, honest NONE-inferred access classification', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({
    content: TABLE_HTML,
    ownerAssertion: { assertedBy: 'TIM', assertionDescription: 'saved from a paywalled archive I have a personal subscription to' },
    clock
  })
  assert.equal(receipt.decision, 'INGESTED')
  assert.equal(receipt.acquisitionMode, 'OWNER_SUPPLIED_LOCAL_ARTIFACT')
  assert.equal(receipt.accessClassification, 'NOT_APPLICABLE_LOCAL_ARTIFACT')
  assert.equal(typeof receipt.contentHash, 'string')
  assert.equal(receipt.artifactRef.headers[0], 'Player')
  assert.equal(receipt.ownerProvenance.assertedBy, 'TIM')
  assert.equal(receipt.ownerProvenance.independentlyVerified, false, 'never conflated with a verified source')
  assert.equal(receipt.artifactRef.rawContent, null, 'raw content stripped by default, same discipline as web fetch')
})

test('never claims independent verification, structurally -- no parameter can set independentlyVerified true', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({
    content: TABLE_HTML,
    ownerAssertion: { assertedBy: 'TIM', independentlyVerified: true }, // an attacker/careless-caller field that must be ignored
    clock
  })
  assert.equal(receipt.ownerProvenance.independentlyVerified, false)
})

test('reads a real local file when filePath is supplied', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsf-owner-artifact-'))
  const filePath = join(dir, 'snapshot.html')
  writeFileSync(filePath, TABLE_HTML, 'utf-8')
  try {
    const { receipt } = await acquireOwnerSuppliedLocalArtifact({
      filePath,
      ownerAssertion: { assertedBy: 'TIM' },
      clock
    })
    assert.equal(receipt.decision, 'INGESTED')
    assert.equal(receipt.sourceUrl, filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing file is reported honestly as ACQUISITION_ERROR, never a fabricated success', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({
    filePath: join(tmpdir(), 'tsf-owner-artifact-does-not-exist', 'nope.html'),
    ownerAssertion: { assertedBy: 'TIM' },
    clock
  })
  assert.equal(receipt.decision, 'ACQUISITION_ERROR')
  assert.equal(receipt.contentHash, null)
  assert.match(receipt.decisionReason, /ARTIFACT_READ_FAILED/)
  assert.equal(receipt.ownerProvenance.assertedBy, 'TIM', 'the assertion itself is still honestly recorded even though retrieval failed')
})

test('empty content is reported honestly, never treated as a real ingestion', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({ content: '   ', ownerAssertion: { assertedBy: 'TIM' }, clock })
  assert.equal(receipt.decision, 'ACQUISITION_ERROR')
  assert.match(receipt.decisionReason, /ARTIFACT_EMPTY/)
})

test('content with no table is reported honestly as NO_TABLES_FOUND', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({ content: '<html><body><p>no table here</p></body></html>', ownerAssertion: { assertedBy: 'TIM' }, clock })
  assert.equal(receipt.decision, 'ACQUISITION_ERROR')
  assert.match(receipt.decisionReason, /NO_TABLES_FOUND/)
})

test('retentionPolicy.allowRawRetention embeds the raw content when explicitly requested', async () => {
  const { receipt } = await acquireOwnerSuppliedLocalArtifact({
    content: TABLE_HTML,
    ownerAssertion: { assertedBy: 'TIM' },
    retentionPolicy: { allowRawRetention: true },
    clock
  })
  assert.equal(receipt.artifactRef.rawContent, TABLE_HTML)
})
