import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildRefusalReceipt,
  buildExtractionFailureReceipt,
  buildAcquisitionReceipt,
  WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA
} from '../domain/web-source-acquisition-receipt.mjs'
import { routeSourceCandidate } from '../domain/web-source-router.mjs'
import { extractTablesFromHtml } from '../domain/html-table-tokenizer.mjs'
import { inferTableSchema } from '../domain/web-table-schema-inference.mjs'
import { computeTableSelectorFingerprint } from '../domain/web-table-selector-fingerprint.mjs'

const contractsDir = path.join(import.meta.dirname, '..', 'contracts')
const schema = JSON.parse(
  readFileSync(
    path.join(contractsDir, 'web-table-source-acquisition-receipt.schema.v1.json'),
    'utf-8'
  )
)
const clock = () => new Date('2026-09-04T12:00:00.000Z')

function assertMatchesSchemaKeys(receipt) {
  assert.deepEqual(new Set(Object.keys(receipt)), new Set(schema.required))
  assert.equal(receipt.schemaVersion, WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA)
  assert.equal(schema.properties.schemaVersion.const, WEB_SOURCE_ACQUISITION_RECEIPT_SCHEMA)
  assert.ok(
    schema.properties.decision.enum.includes(receipt.decision),
    `decision "${receipt.decision}" must be one of ${schema.properties.decision.enum}`
  )
}

test('a refusal receipt carries exactly the schema-required fields', () => {
  const routeDecision = routeSourceCandidate({ url: 'https://example.com/x' }, {})
  assertMatchesSchemaKeys(buildRefusalReceipt({ routeDecision, clock }))
})

test('an allowed-but-unsupported-content-type route never leaks bare ALLOWED into the receipt', () => {
  const routeDecision = routeSourceCandidate(
    { url: 'https://example.com/report.pdf', contentTypeHint: 'PDF' },
    { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }
  )
  assertMatchesSchemaKeys(buildRefusalReceipt({ routeDecision, clock }))
})

test('an extraction-failure receipt carries exactly the schema-required fields', () => {
  const routeDecision = routeSourceCandidate(
    { url: 'https://example.com/x' },
    { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }
  )
  assertMatchesSchemaKeys(
    buildExtractionFailureReceipt({
      routeDecision,
      failureReason: 'TIMEOUT',
      failureDetail: '15000ms',
      clock
    })
  )
})

test('a successful acquisition receipt carries exactly the schema-required fields and a stable hash', () => {
  const routeDecision = routeSourceCandidate(
    { url: 'https://example.com/x' },
    { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }
  )
  const table = extractTablesFromHtml('<table><tr><th>A</th></tr><tr><td>1</td></tr></table>')[0]
  const schemaInfo = inferTableSchema(table.headers, table.bodyRows)
  const selectorFingerprint = computeTableSelectorFingerprint(table)
  const fetchResult = {
    finalUrl: 'https://example.com/x',
    httpStatus: 200,
    contentType: 'text/html',
    bytesRead: 42,
    attempts: 1,
    redirectChain: [],
    bodyText: '<table></table>'
  }
  const receipt = buildAcquisitionReceipt({
    routeDecision,
    fetchResult,
    table,
    schema: schemaInfo,
    selectorFingerprint,
    driftEvidence: { drifted: false },
    sourceAsOf: { evidence: null, extractionMethod: 'NONE', confidence: 'NONE', value: null },
    clock
  })
  assertMatchesSchemaKeys(receipt)
  const receiptWithoutHash = { ...receipt }
  delete receiptWithoutHash.receiptHash
  const { receiptHash, ...rebuiltWithoutHash } = buildAcquisitionReceipt({
    routeDecision,
    fetchResult,
    table,
    schema: schemaInfo,
    selectorFingerprint,
    driftEvidence: { drifted: false },
    sourceAsOf: { evidence: null, extractionMethod: 'NONE', confidence: 'NONE', value: null },
    clock
  })
  assert.deepEqual(
    receiptWithoutHash,
    rebuiltWithoutHash,
    'deterministic given the same clock/inputs'
  )
  assert.equal(receipt.receiptHash, receiptHash)
})

test('transportEvidence, when supplied, matches its schema exactly and is null by default (V0-only callers unaffected)', () => {
  const routeDecision = routeSourceCandidate({ url: 'https://example.com/x' }, {})
  const noTransport = buildRefusalReceipt({ routeDecision, clock })
  assert.equal(noTransport.transportEvidence, null)

  const pinnedTransport = {
    schemaVersion: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_EVIDENCE_V1',
    transport: 'PINNED_CONNECTION_FETCH',
    robotsUsedPinnedTransport: true,
    contentUsedPinnedTransport: true,
    ordinaryFetchFallbackOccurred: false,
    capability: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1'
  }
  const withTransport = buildRefusalReceipt({
    routeDecision,
    transportEvidence: pinnedTransport,
    clock
  })
  assertMatchesSchemaKeys(withTransport)
  const transportSchema = schema.properties.transportEvidence
  assert.deepEqual(
    new Set(Object.keys(withTransport.transportEvidence)),
    new Set(transportSchema.required)
  )
  assert.deepEqual(withTransport.transportEvidence, pinnedTransport)
})

// public-web-source-acquisition.mjs's pinned-transport-construction-failure
// path (see its test suite) honestly reports false here -- pinning was never
// reached, not merely "not proven". The schema must accept that shape, not
// just the pinning-succeeded shape asserted above.
test('transportEvidence honestly reporting pinning was NOT used (construction failure) still matches its schema', () => {
  const routeDecision = routeSourceCandidate({ url: 'https://example.com/x' }, {})
  const unpinnedTransport = {
    schemaVersion: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_EVIDENCE_V1',
    transport: 'PINNED_CONNECTION_FETCH',
    robotsUsedPinnedTransport: false,
    contentUsedPinnedTransport: false,
    ordinaryFetchFallbackOccurred: false,
    capability: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1'
  }
  const withTransport = buildExtractionFailureReceipt({
    routeDecision,
    failureReason: 'PINNED_TRANSPORT_CONSTRUCTION_FAILED',
    failureDetail: 'boom',
    transportEvidence: unpinnedTransport,
    clock
  })
  assertMatchesSchemaKeys(withTransport)
  const transportSchema = schema.properties.transportEvidence
  assert.deepEqual(
    new Set(Object.keys(withTransport.transportEvidence)),
    new Set(transportSchema.required)
  )
  assert.equal(transportSchema.properties.robotsUsedPinnedTransport.type, 'boolean')
  assert.equal(transportSchema.properties.contentUsedPinnedTransport.type, 'boolean')
  assert.deepEqual(withTransport.transportEvidence, unpinnedTransport)
})
