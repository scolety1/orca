// M10: evidence-backed repository security signals extending Project
// Health -- NOT an autonomous penetration-testing platform. A security
// finding is evidence for a human/governed mission, never automatic
// authority: nothing here rewrites dependencies, rotates credentials,
// updates infrastructure, or remediates a finding on its own.
export const SEVERITY_LEVELS = Object.freeze(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const SEVERITY_RANK = Object.freeze({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })

export const SCAN_CATEGORIES = Object.freeze([
  'DEPENDENCY_VULNERABILITIES',
  'SECRETS_EXPOSURE',
  'CONFIGURATION',
  'LICENSES'
])

function highestSeverity(findings) {
  return findings.reduce(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    'NONE'
  )
}

// Fail-closed validation of a scanner adapter's raw output -- mirrors
// this program's established normalize* pattern (estimation.mjs's
// normalizeWbsTask, project-memory.mjs's addMemoryRecord). A malformed
// adapter response is a thrown error, never silently patched into
// something usable -- exactly what keeps a scanner failure from ever
// being mistaken for a clean scan.
export function normalizeSecurityScanResult(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('security scan result must be an object')
  }
  if (typeof raw.scannerName !== 'string' || !raw.scannerName.trim()) {
    throw new Error('security scan result requires a real scannerName')
  }
  if (typeof raw.scannerVersion !== 'string' || !raw.scannerVersion.trim()) {
    throw new Error('security scan result requires a real scannerVersion')
  }
  const findings = (raw.findings ?? []).map((f, i) => {
    if (!SCAN_CATEGORIES.includes(f.category)) {
      throw new Error(`security finding ${i}: unknown category ${f.category}`)
    }
    if (!SEVERITY_LEVELS.includes(f.severity)) {
      throw new Error(`security finding ${i}: unknown severity ${f.severity}`)
    }
    // Acceptance item 4: secret values are never unnecessarily copied
    // into TSF logs/UI. The finding shape has no field for a raw secret
    // match at all -- location/title only -- so even a scanner adapter
    // that (against its own contract) tried to hand back the actual
    // secret text has nowhere to put it: only the allow-listed fields
    // below survive normalization, an unrecognized field is silently
    // dropped rather than passed through.
    return {
      category: f.category,
      severity: f.severity,
      title: f.title ?? '(untitled finding)',
      detail: f.detail ?? null,
      packageName: f.packageName ?? null,
      packageVersion: f.packageVersion ?? null,
      // Provenance-bound (acceptance item 3): every finding traces back
      // to the exact scanner/version that produced it, never a bare
      // unsourced claim.
      source: raw.scannerName,
      sourceVersion: raw.scannerVersion
    }
  })
  return {
    schemaVersion: 'TSF_SECURITY_SCAN_RESULT_V1',
    scannerName: raw.scannerName,
    scannerVersion: raw.scannerVersion,
    findings,
    sbomAvailable: raw.sbomAvailable === true,
    scannedAt: raw.scannedAt ?? null
  }
}

// Builds the compact Health-line summary Tim's own spec names
// verbatim ("Dependencies 2 HIGH / Secrets NONE / Configuration 1
// MEDIUM / Licenses CLEAN / SBOM AVAILABLE"). scanResult === null means
// no scan was ever attempted or the scanner was unavailable -- reported
// honestly as UNKNOWN across every dimension, never defaulted to a
// clean/healthy reading (acceptance item 2 and 6).
export function buildSecurityHealthSummary(scanResult) {
  if (!scanResult) {
    return {
      schemaVersion: 'TSF_SECURITY_HEALTH_SUMMARY_V1',
      status: 'UNKNOWN',
      dependencies: 'UNKNOWN',
      dependencyCount: 0,
      secrets: 'UNKNOWN',
      secretCount: 0,
      configuration: 'UNKNOWN',
      configurationCount: 0,
      licenses: 'UNKNOWN',
      sbom: 'UNAVAILABLE',
      scannerName: null,
      scannerVersion: null
    }
  }
  const byCategory = (category) => scanResult.findings.filter((f) => f.category === category)
  const licenseFindings = byCategory('LICENSES')
  return {
    schemaVersion: 'TSF_SECURITY_HEALTH_SUMMARY_V1',
    status: highestSeverity(scanResult.findings),
    dependencies: highestSeverity(byCategory('DEPENDENCY_VULNERABILITIES')),
    dependencyCount: byCategory('DEPENDENCY_VULNERABILITIES').length,
    secrets: highestSeverity(byCategory('SECRETS_EXPOSURE')),
    secretCount: byCategory('SECRETS_EXPOSURE').length,
    configuration: highestSeverity(byCategory('CONFIGURATION')),
    configurationCount: byCategory('CONFIGURATION').length,
    licenses: licenseFindings.length > 0 ? 'CONCERNS' : 'CLEAN',
    sbom: scanResult.sbomAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
    scannerName: scanResult.scannerName,
    scannerVersion: scanResult.scannerVersion
  }
}

// Acceptance item 7: "High Assurance can consume the findings." HIGH_ASSURANCE
// itself is a reserved, not-yet-built usage mode (see http-server.mjs's
// routing endpoint) -- this is the real, callable query a future High
// Assurance adoption gate would use, built now so the capability
// genuinely exists rather than merely being planned.
export function securityRequiresHighAssuranceReview(summary) {
  return SEVERITY_RANK[summary.status] >= SEVERITY_RANK.HIGH
}
