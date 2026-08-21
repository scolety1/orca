#!/usr/bin/env node
// Stands in for a real external security scanner (e.g. Trivy) in tests.
// Driven entirely by env vars so tests never depend on any specific
// scanner binary being installed. Mirrors stub-orca-cli.mjs/
// stub-planner-cli.mjs's own established stub-CLI conventions.
const mode = process.env.STUB_SECURITY_MODE || 'success'

if (mode === 'error') {
  process.stderr.write('deliberate stub scanner error')
  process.exit(1)
}
if (mode === 'malformed') {
  process.stdout.write('this is not json')
  process.exit(0)
}
if (mode === 'timeout') {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  process.exit(0)
}
if (mode === 'invalid-shape') {
  // Schema-conformant JSON, domain-invalid content (unknown severity) --
  // lets tests prove normalizeSecurityScanResult's own semantic
  // validation catches what "valid JSON" alone cannot.
  process.stdout.write(
    JSON.stringify({
      scannerName: 'stub-scanner',
      scannerVersion: '1.0.0',
      findings: [{ category: 'DEPENDENCY_VULNERABILITIES', severity: 'SUPER_BAD', title: 'x' }]
    })
  )
  process.exit(0)
}

// Default success mode: real, deliberately PLANTED findings -- 2 HIGH
// dependency vulnerabilities, 0 secrets, 1 MEDIUM configuration issue, 1
// license concern -- matching the exact example shape named in Tim's
// own M10 spec ("Dependencies 2 HIGH / Secrets NONE / Configuration 1
// MEDIUM / Licenses CLEAN / SBOM AVAILABLE"), overridable via
// STUB_SECURITY_FINDINGS for other test scenarios.
const findings = process.env.STUB_SECURITY_FINDINGS
  ? JSON.parse(process.env.STUB_SECURITY_FINDINGS)
  : [
      {
        category: 'DEPENDENCY_VULNERABILITIES',
        severity: 'HIGH',
        title: 'Planted: prototype pollution in stub-dep',
        packageName: 'stub-dep',
        packageVersion: '1.2.3'
      },
      {
        category: 'DEPENDENCY_VULNERABILITIES',
        severity: 'HIGH',
        title: 'Planted: ReDoS in stub-dep-2',
        packageName: 'stub-dep-2',
        packageVersion: '4.5.6'
      },
      {
        category: 'CONFIGURATION',
        severity: 'MEDIUM',
        title: 'Planted: overly permissive CORS configuration'
      }
    ]

process.stdout.write(
  JSON.stringify({
    scannerName: 'stub-scanner',
    scannerVersion: '1.0.0',
    findings,
    sbomAvailable: true,
    scannedAt: '2026-01-01T00:00:00.000Z'
  })
)
