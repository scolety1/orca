// Projects real TSF pilot fixture evidence (tsf/pilots/*) plus the local
// operator fixture project into a single Known Projects view model.
// No network, no credentials, no mutation of the source pilot files.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assessHealth } from '../domain/health.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PILOTS_DIR = path.join(HERE, '..', 'pilots')

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readNdjson(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function tryRead(file) {
  return existsSync(file) ? readJson(file) : null
}

// planner-evidence.json records `selectedMission` as either a plain string
// (weird-talent) or an { title, rationale, nonScope } object (shopify).
function normalizeSelectedMission(plannerEvidence) {
  const raw = plannerEvidence?.selectedMission
  if (!raw) return null
  if (typeof raw === 'string') return { title: raw, rationale: plannerEvidence?.operatorFriction ?? null, nonScope: plannerEvidence?.exclusions ?? [] }
  return raw
}

// Pilot result-capsule files use two recorded shapes: a plain
// TSF_RESULT_CAPSULE_V1 array (shopify), or a wrapper object with a
// differently-shaped `.results[]` (weird-talent). Normalize both into one
// shape rather than assuming the newer array form everywhere.
function normalizeResultCapsules(raw) {
  if (Array.isArray(raw)) {
    return raw.map((r) => ({
      id: r.missionId ?? null,
      status: r.outcome ?? 'UNKNOWN',
      filesChanged: r.filesChanged ?? [],
      testsRun: r.testsRun ?? [],
      implementationSummary: r.implementationSummary ?? null,
      workerIdentity: r.workerIdentity ?? null
    }))
  }
  if (raw?.results) {
    return raw.results.map((r) => ({
      id: r.workItemId ?? null,
      status: r.status ?? 'UNKNOWN',
      filesChanged: [],
      testsRun: (r.tests ?? []).map((t) => (typeof t === 'string' ? { command: t } : t)),
      implementationSummary: r.finding ?? null,
      workerIdentity: r.sessionId ? { orcaSessionId: r.sessionId, worktreeId: null } : null
    }))
  }
  return []
}

// Maps a pilot's registration health block onto the shared assessHealth() fact
// shape so Health status is computed by the same domain function used
// elsewhere, not restated ad hoc per pilot.
function healthFactsFromRegistration(registration, state) {
  const facts = {
    repositoryAvailable: registration.health?.repositoryAvailable !== false,
    testsPassed: registration.health?.status !== 'RED',
    humanDecisionPending: state?.phase2Allowed === false || registration.workState?.missionState === 'BLOCKED_ARCHITECTURAL_CONFLICT'
  }
  if (registration.workState?.missionState === 'BLOCKED') facts.workerStuck = false
  return facts
}

function loadPilot(dirName) {
  const dir = path.join(PILOTS_DIR, dirName)
  const registration = tryRead(path.join(dir, 'project-registration.json'))
  if (!registration) return null
  const state = tryRead(path.join(dir, 'state.json'))
  const plannerEvidence = tryRead(path.join(dir, 'planner-evidence.json'))
  const verifierResult = tryRead(path.join(dir, 'verifier-result.json'))
  const browserProof = tryRead(path.join(dir, 'browser-proof.json'))
  const resultCapsules = normalizeResultCapsules(tryRead(path.join(dir, 'result-capsules.json')))
  const receipts = readNdjson(path.join(dir, 'receipts.ndjson')).map((receipt) => ({
    ...receipt,
    chainValid: verifyReceipt(receipt)
  }))

  const health = assessHealth(healthFactsFromRegistration(registration, state), () => new Date(registration.registeredAt ?? Date.now()))
  // A pilot registration's own recorded status is real recorded evidence;
  // prefer it when it names a more specific state than the generic facts probe.
  const status = registration.health?.status?.startsWith('YELLOW')
    ? 'DEGRADED'
    : registration.health?.status === 'RED'
      ? 'BLOCKED'
      : health.status

  return {
    id: registration.projectId,
    displayName: registration.displayName,
    sourceClass: 'REAL',
    provenance: registration.sourceProvenance,
    root: registration.repository?.path ?? registration.sourcePath ?? null,
    lifecycle: registration.lifecycle ?? 'IN_DEVELOPMENT',
    branch: registration.repository?.branch ?? null,
    registeredAt: registration.registeredAt,
    purpose: registration.purpose ?? null,
    restrictions: registration.restrictions ?? [],
    activeFleet: !!registration.workState?.activeFleet,
    workSet: !!registration.workState?.workSet,
    mission: {
      id: registration.workState?.missionId ?? state?.missionId ?? null,
      state: registration.workState?.missionState ?? state?.missionState ?? 'UNKNOWN',
      blockedReason: registration.health?.blockedReason ?? null
    },
    release: {
      stable: {
        branch: registration.repository?.branch ?? 'main',
        head: registration.release?.stableHead ?? null,
        tree: registration.release?.stableTree ?? null
      },
      previousStable: registration.release?.previousStableHead
        ? { head: registration.release.previousStableHead, tree: registration.release.previousStableTree }
        : null,
      upgrade: registration.release?.upgradeHead
        ? { head: registration.release.upgradeHead, tree: registration.release.upgradeTree }
        : null,
      testing: registration.release?.testing ?? 'UNKNOWN',
      adoption: registration.release?.adoption ?? 'UNKNOWN',
      published: registration.release?.published ?? 'UNKNOWN'
    },
    health: { ...health, status },
    baseline: {
      tests: registration.health?.baselineTests ?? 'UNKNOWN',
      lint: registration.health?.baselineLint ?? 'UNKNOWN',
      typecheck: registration.health?.baselineTypecheck ?? 'UNKNOWN',
      build: registration.health?.baselineBuild ?? 'UNKNOWN'
    },
    evidence: {
      planner: plannerEvidence?.planner ?? null,
      selectedMission: normalizeSelectedMission(plannerEvidence),
      verifier: verifierResult?.verifier ?? verifierResult?.verifier ?? null,
      browser: browserProof ?? null,
      resultCapsules,
      verifierRaw: verifierResult
    },
    receipts: {
      chain: receipts,
      chainValid: receipts.length > 0 && receipts.every((r) => r.chainValid),
      tip: receipts.at(-1)?.receiptHash ?? null
    },
    candidate: candidateFromPilot(registration, state, verifierResult, resultCapsules)
  }
}

// Reconstructs an adoption-candidate view from recorded evidence. Real pilot
// candidates are historical: their decision already happened, so the view is
// read-only. `decidable` is only true for the local fixture project.
function candidateFromPilot(registration, state, verifierResult, resultCapsules) {
  const upgrade = registration.release?.upgradeHead
  if (!upgrade) return null
  const lastResult = resultCapsules.at(-1) ?? null
  const adoptionState = registration.release?.adoption ?? 'UNKNOWN'
  return {
    id: `${registration.projectId}-${registration.workState?.missionId ?? 'candidate'}`,
    projectId: registration.projectId,
    missionId: registration.workState?.missionId ?? null,
    state: adoptionState.startsWith('ADOPTED')
      ? 'ADOPTED'
      : registration.workState?.missionState === 'BLOCKED' || registration.workState?.missionState === 'BLOCKED_ARCHITECTURAL_CONFLICT'
        ? 'BLOCKED'
        : registration.release?.testing === 'GREEN'
          ? 'READY_FOR_ADOPTION'
          : 'NOT_READY',
    decidable: false,
    branch: registration.repository?.branch ?? null,
    head: upgrade,
    tree: registration.release?.upgradeTree ?? null,
    filesChanged: lastResult?.filesChanged ?? [],
    implementationSummary: lastResult?.implementationSummary ?? null,
    testsRun: lastResult?.testsRun ?? [],
    verifierVerdict: verifierResult?.finalPass?.outcome ?? verifierResult?.checks ?? null,
    verifierChecks: verifierResult?.checks ?? null,
    residualRisks: state?.blockedReason ?? registration.health?.blockedReason ?? null
  }
}

export function loadRealPilotProjects() {
  if (!existsSync(PILOTS_DIR)) return []
  const dirs = readdirSync(PILOTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-v1') && entry.name.includes('real-project'))
    .map((entry) => entry.name)
  const projects = dirs.map(loadPilot).filter(Boolean)
  // Stable, deterministic order matching pilot numbering.
  return projects.sort((a, b) => (a.registeredAt ?? '').localeCompare(b.registeredAt ?? ''))
}
