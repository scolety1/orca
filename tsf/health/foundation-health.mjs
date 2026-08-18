import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM_SHA = '2307f2ebbe1c1e737c0b12d920bb0a208332db2c'
const LEGACY_PATH = 'C:\\TSF_V1'
const EXPECTED_LEGACY_HEAD = 'c702a373b39ea6b2e451788da82ed0437811dfc3'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function git(repository, ...args) {
  try {
    return execFileSync(
      'git',
      ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, '-C', repository, ...args],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  } catch {
    return null
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'))
}

const migration = readJson('tsf/migration/capability-migration.v1.json')
const roles = readJson('tsf/routing/provider-role-mappings.v1.json')
const profiles = readJson('tsf/providers/launch-profiles.v1.json')
const sessionAffinity = readJson('tsf/contracts/session-affinity.v1.json')
const usageModes = readJson('tsf/routing/usage-modes.v1.json')
const upstreamDelta = readJson('tsf/migration/upstream-delta.v1.json')
const coreDelta = (git(root, 'diff', '--name-only', `${UPSTREAM_SHA}..HEAD`) ?? '')
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) => !path.startsWith('tsf/') && !path.startsWith('docs/tsf/'))
const capabilityIds = migration.capabilities.map((entry) => entry.id)
const invalidCoverage = migration.capabilities.filter(
  (entry) => entry.proposedWave === null && !['REFERENCE_ONLY', 'REJECTED'].includes(entry.state)
)

const report = {
  status: 'PASS',
  foundation: 'ORCA',
  upstreamSha: UPSTREAM_SHA,
  downstreamSha: git(root, 'rev-parse', 'HEAD'),
  upstreamAncestryPreserved:
    git(root, 'merge-base', '--is-ancestor', UPSTREAM_SHA, 'HEAD') === '',
  upstreamCoreDeltaCount: coreDelta.length,
  upstreamCoreDeltaFiles: coreDelta,
  overlayLoadable:
    existsSync(resolve(root, 'tsf/orca-plugin.json')) && existsSync(resolve(root, 'tsf/main.mjs')),
  providerAdapterPresence: roles.schemaVersion === 'TSF_PROVIDER_ROLE_MAPPINGS_V1',
  safeCodexProfileConfigured: profiles.profiles.CODEX_SAFE?.blanketBypass === false,
  safeCodexProfileStatus: profiles.profiles.CODEX_SAFE?.status ?? 'UNKNOWN',
  safeClaudeProfileConfigured: profiles.profiles.CLAUDE_SAFE?.blanketBypass === false,
  safeClaudeProfileStatus: profiles.profiles.CLAUDE_SAFE?.status ?? 'UNKNOWN',
  sessionAffinityContract: sessionAffinity.schemaVersion,
  usageModes: Object.keys(usageModes.modes),
  pluginExtensionSeam: upstreamDelta.extensionSeam,
  legacyReference: {
    path: LEGACY_PATH,
    expectedHead: EXPECTED_LEGACY_HEAD,
    observedHead: git(LEGACY_PATH, 'rev-parse', 'HEAD') ?? 'UNAVAILABLE'
  },
  capabilityLedger: {
    sourceCommit: migration.source.legacyArchaeologyCommit,
    sourceSha256: migration.source.ledgerSha256,
    count: migration.capabilities.length,
    uniqueIds: new Set(capabilityIds).size,
    uncovered: invalidCoverage.map((entry) => entry.id)
  },
  migrationWave: 4,
  realProjectWork: migration.realPilotEvidence
    ? {
        authorization: 'FIRST_BOUNDED_PILOT_ONLY',
        projectId: migration.realPilotEvidence.projectId,
        candidateHead: migration.realPilotEvidence.candidateHead,
        candidateState: migration.realPilotEvidence.candidateState
      }
    : 'NOT_AUTHORIZED_FOR_THIS_RUNWAY'
}

if (
  report.downstreamSha === null ||
  !report.upstreamAncestryPreserved ||
  report.upstreamCoreDeltaCount !== 0 ||
  !report.overlayLoadable ||
  !report.providerAdapterPresence ||
  !report.safeCodexProfileConfigured ||
  !report.safeClaudeProfileConfigured ||
  report.capabilityLedger.count !== 111 ||
  report.capabilityLedger.uniqueIds !== 111 ||
  report.capabilityLedger.uncovered.length !== 0
) {
  report.status = 'FAIL'
  process.exitCode = 1
}

console.log(JSON.stringify(report, null, 2))
