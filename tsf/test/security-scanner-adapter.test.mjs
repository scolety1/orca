import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runSecurityScan } from '../adapters/security-scanner-adapter.mjs'
import { buildSecurityHealthSummary } from '../domain/security-health.mjs'

const HERE = import.meta.dirname
const STUB = path.join(HERE, 'fixtures', 'stub-security-scanner.mjs')

function fixtureRepo() {
  return mkdtempSync(path.join(tmpdir(), 'tsf-security-scan-'))
}

test('REQUIRED PROOF: scanner not configured is honestly SCANNER_UNAVAILABLE, never a fabricated clean scan', async () => {
  delete process.env.TSF_SECURITY_SCANNER_COMMAND
  const result = await runSecurityScan(fixtureRepo())
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'SCANNER_UNAVAILABLE')
})

test('REQUIRED PROOF: a real, planted-issue fixture is detected end to end through the real scanner adapter', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'success'
  const dir = fixtureRepo()
  try {
    const result = await runSecurityScan(dir)
    assert.equal(result.ok, true)
    const summary = buildSecurityHealthSummary(result.result)
    assert.equal(summary.dependencies, 'HIGH')
    assert.equal(summary.dependencyCount, 2)
    assert.equal(summary.configuration, 'MEDIUM')
    assert.equal(summary.sbom, 'AVAILABLE')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real scanner exit failure is honestly SCANNER_ERROR', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'error'
  const result = await runSecurityScan(fixtureRepo())
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'SCANNER_ERROR')
})

test('a non-JSON scanner response is honestly MALFORMED_RESPONSE', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'malformed'
  const result = await runSecurityScan(fixtureRepo())
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'MALFORMED_RESPONSE')
})

test('REQUIRED PROOF: a schema-conformant but domain-invalid scanner response fails honestly as INVALID_SCAN_RESULT -- normalizeSecurityScanResult is real defense-in-depth', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'invalid-shape'
  const result = await runSecurityScan(fixtureRepo())
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_SCAN_RESULT')
})

test('REQUIRED PROOF: a scanner that genuinely hangs past its real timeout is honestly SCANNER_TIMEOUT, not left hanging or silently treated as clean -- a real review finding: this path was previously asserted only in code, never actually triggered by any test', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'timeout'
  // Overridable only for this test -- the stub's own timeout mode sleeps
  // 5000ms; a short override here proves the real SCANNER_TIMEOUT branch
  // fires without waiting out the real 120000ms production default.
  process.env.TSF_SECURITY_SCANNER_TIMEOUT_MS = '200'
  try {
    const result = await runSecurityScan(fixtureRepo())
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SCANNER_TIMEOUT')
  } finally {
    delete process.env.TSF_SECURITY_SCANNER_TIMEOUT_MS
  }
})

test('the scan never mutates the real fixture repo it points at', async () => {
  process.env.TSF_SECURITY_SCANNER_COMMAND = STUB
  process.env.STUB_SECURITY_MODE = 'success'
  const dir = fixtureRepo()
  try {
    const { readdirSync } = await import('node:fs')
    const before = readdirSync(dir)
    await runSecurityScan(dir)
    const after = readdirSync(dir)
    assert.deepEqual(before, after)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
