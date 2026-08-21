import assert from 'node:assert/strict'
import test from 'node:test'
import { assessRepositoryOnboardingHealth } from '../domain/health.mjs'
import {
  normalizeSecurityScanResult,
  buildSecurityHealthSummary
} from '../domain/security-health.mjs'

const CLOCK = () => new Date('2026-01-01T00:00:00.000Z')

function baseFacts(overrides = {}) {
  return {
    activeGitOperation: false,
    conflicted: [],
    detached: false,
    dirty: false,
    hasKnownTestCommand: true,
    hasReadme: true,
    hasInstructions: true,
    hasPackageManifest: true,
    dependenciesInstalled: true,
    ...overrides
  }
}

test('existing callers with no security scan attached are completely unaffected (additive-only change)', () => {
  const health = assessRepositoryOnboardingHealth(baseFacts(), CLOCK)
  assert.equal(health.status, 'HEALTHY')
  assert.equal(
    health.findings.some((f) => f.code.startsWith('SECURITY_')),
    false
  )
})

test('REQUIRED PROOF: a real HIGH security finding is surfaced as NEEDS_ATTENTION, never silently absorbed or escalated to BLOCKED', () => {
  const scan = normalizeSecurityScanResult({
    scannerName: 'stub-scanner',
    scannerVersion: '1.0.0',
    findings: [{ category: 'DEPENDENCY_VULNERABILITIES', severity: 'HIGH', title: 'x' }]
  })
  const health = assessRepositoryOnboardingHealth(
    baseFacts({ securitySummary: buildSecurityHealthSummary(scan) }),
    CLOCK
  )
  assert.equal(health.status, 'NEEDS_ATTENTION')
  const finding = health.findings.find((f) => f.code === 'SECURITY_FINDINGS_PRESENT')
  assert.ok(finding)
  assert.match(finding.summary, /Dependencies 1 HIGH/)
})

test('a scanner that could not run is surfaced as an honest UNKNOWN finding, never silently omitted', () => {
  const health = assessRepositoryOnboardingHealth(
    baseFacts({ securitySummary: buildSecurityHealthSummary(null) }),
    CLOCK
  )
  const finding = health.findings.find((f) => f.code === 'SECURITY_SCAN_UNAVAILABLE')
  assert.ok(finding)
  assert.equal(finding.status, 'UNKNOWN')
})

test('a MEDIUM-only security finding stays HEALTHY_WITH_CAVEATS, not NEEDS_ATTENTION', () => {
  const scan = normalizeSecurityScanResult({
    scannerName: 'stub-scanner',
    scannerVersion: '1.0.0',
    findings: [{ category: 'CONFIGURATION', severity: 'MEDIUM', title: 'x' }]
  })
  const health = assessRepositoryOnboardingHealth(
    baseFacts({ securitySummary: buildSecurityHealthSummary(scan) }),
    CLOCK
  )
  assert.equal(health.status, 'HEALTHY_WITH_CAVEATS')
})
