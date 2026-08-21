import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeSecurityScanResult,
  buildSecurityHealthSummary,
  securityRequiresHighAssuranceReview
} from '../domain/security-health.mjs'

function rawScan(overrides = {}) {
  return {
    scannerName: 'stub-scanner',
    scannerVersion: '1.0.0',
    findings: [
      {
        category: 'DEPENDENCY_VULNERABILITIES',
        severity: 'HIGH',
        title: 'x',
        packageName: 'p',
        packageVersion: '1'
      },
      { category: 'DEPENDENCY_VULNERABILITIES', severity: 'HIGH', title: 'y' },
      { category: 'CONFIGURATION', severity: 'MEDIUM', title: 'z' }
    ],
    sbomAvailable: true,
    ...overrides
  }
}

test('normalizeSecurityScanResult rejects a missing scannerName/scannerVersion', () => {
  assert.throws(() => normalizeSecurityScanResult(rawScan({ scannerName: '' })), /scannerName/)
  assert.throws(
    () => normalizeSecurityScanResult(rawScan({ scannerVersion: '' })),
    /scannerVersion/
  )
})

test('normalizeSecurityScanResult rejects an unknown category or severity', () => {
  assert.throws(
    () =>
      normalizeSecurityScanResult(
        rawScan({ findings: [{ category: 'NOT_REAL', severity: 'HIGH' }] })
      ),
    /unknown category/
  )
  assert.throws(
    () =>
      normalizeSecurityScanResult(
        rawScan({ findings: [{ category: 'CONFIGURATION', severity: 'SUPER_BAD' }] })
      ),
    /unknown severity/
  )
})

test('REQUIRED PROOF: every finding is provenance-bound to the real scanner name/version, not a bare unsourced claim', () => {
  const result = normalizeSecurityScanResult(rawScan())
  for (const finding of result.findings) {
    assert.equal(finding.source, 'stub-scanner')
    assert.equal(finding.sourceVersion, '1.0.0')
  }
})

test("buildSecurityHealthSummary produces the exact example shape from Tim's own spec (2 HIGH deps, 0 secrets, 1 MEDIUM config, clean licenses)", () => {
  const result = normalizeSecurityScanResult(rawScan())
  const summary = buildSecurityHealthSummary(result)
  assert.equal(summary.dependencies, 'HIGH')
  assert.equal(summary.dependencyCount, 2)
  assert.equal(summary.secrets, 'NONE')
  assert.equal(summary.secretCount, 0)
  assert.equal(summary.configuration, 'MEDIUM')
  assert.equal(summary.licenses, 'CLEAN')
  assert.equal(summary.sbom, 'AVAILABLE')
  assert.equal(summary.status, 'HIGH')
})

test('REQUIRED PROOF: a null scan result (scanner unavailable) is honestly UNKNOWN across every dimension, never defaulted to healthy/clean', () => {
  const summary = buildSecurityHealthSummary(null)
  assert.equal(summary.status, 'UNKNOWN')
  assert.equal(summary.dependencies, 'UNKNOWN')
  assert.equal(summary.secrets, 'UNKNOWN')
  assert.equal(summary.configuration, 'UNKNOWN')
  assert.equal(summary.licenses, 'UNKNOWN')
  assert.equal(summary.sbom, 'UNAVAILABLE')
})

test('a license concern is reflected even with zero dependency/secret/config findings', () => {
  const result = normalizeSecurityScanResult(
    rawScan({
      findings: [{ category: 'LICENSES', severity: 'LOW', title: 'GPL-3.0 dependency detected' }]
    })
  )
  const summary = buildSecurityHealthSummary(result)
  assert.equal(summary.licenses, 'CONCERNS')
  assert.equal(summary.dependencies, 'NONE')
})

test('REQUIRED PROOF: a scanner adapter that tries to hand back a raw secret value has nowhere to put it -- normalizeSecurityScanResult never passes through an unrecognized field', () => {
  const result = normalizeSecurityScanResult(
    rawScan({
      findings: [
        {
          category: 'SECRETS_EXPOSURE',
          severity: 'CRITICAL',
          title: 'AWS key detected in .env',
          secretValue: 'AKIAABCDEFGHIJKLMNOP',
          rawMatch: 'AKIAABCDEFGHIJKLMNOP'
        }
      ]
    })
  )
  const [f] = result.findings
  assert.equal('secretValue' in f, false)
  assert.equal('rawMatch' in f, false)
  assert.deepEqual(Object.keys(f).sort(), [
    'category',
    'detail',
    'packageName',
    'packageVersion',
    'severity',
    'source',
    'sourceVersion',
    'title'
  ])
})

test('securityRequiresHighAssuranceReview is true at HIGH and CRITICAL, false below', () => {
  assert.equal(securityRequiresHighAssuranceReview({ status: 'MEDIUM' }), false)
  assert.equal(securityRequiresHighAssuranceReview({ status: 'HIGH' }), true)
  assert.equal(securityRequiresHighAssuranceReview({ status: 'CRITICAL' }), true)
  assert.equal(securityRequiresHighAssuranceReview({ status: 'UNKNOWN' }), false)
})
