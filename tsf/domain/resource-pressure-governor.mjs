// TSF_RESOURCE_PRESSURE_STATE_V0 -- host-tier classification, admission
// policy, and heavy-task lease mutual exclusion. Pure domain logic only;
// see server/resource-pressure-collector.mjs for the real os.freemem()/
// os.totalmem() evidence and server/resource-pressure-governor-http-
// routes.mjs for the HTTP glue. Design record: docs/tsf/
// TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md and the durable requirement this
// extends, RESOURCE_PRESSURE_GOVERNOR_REQUIREMENT.md.
//
// Composes with, does not duplicate, Orca Resource Auditor V0's fail-
// closed discipline (domain/resource-auditor.mjs, once adopted): unknown/
// unmeasurable evidence fails to the most restrictive tier, never to
// HEALTHY, and reclaimCandidates is structurally never populated here --
// naming a specific process/session as reclaimable needs Orca's
// enumerateProcesses() bridge (ORCA_CORE_GAP, already disclosed in the
// Resource Auditor review; not a second, new gap).

export const RESOURCE_PRESSURE_TIERS = ['HEALTHY', 'PRESSURED', 'CRITICAL', 'EMERGENCY']

const GB = 1024 ** 3
export const DEFAULT_RESOURCE_PRESSURE_THRESHOLDS_BYTES = {
  healthyAtLeastBytes: 4 * GB,
  pressuredAtLeastBytes: 2.5 * GB,
  criticalAtLeastBytes: 1.5 * GB
}

// Unmeasurable/invalid input fails closed to the most restrictive tier --
// never silently HEALTHY. Requirement doc's own writing conditions (~1.69
// GB free -> CRITICAL) are the worked example this mirrors.
export function classifyResourcePressureTier(
  availableBytes,
  thresholds = DEFAULT_RESOURCE_PRESSURE_THRESHOLDS_BYTES
) {
  if (
    typeof availableBytes !== 'number' ||
    !Number.isFinite(availableBytes) ||
    availableBytes < 0
  ) {
    return 'EMERGENCY'
  }
  if (availableBytes >= thresholds.healthyAtLeastBytes) {
    return 'HEALTHY'
  }
  if (availableBytes >= thresholds.pressuredAtLeastBytes) {
    return 'PRESSURED'
  }
  if (availableBytes >= thresholds.criticalAtLeastBytes) {
    return 'CRITICAL'
  }
  return 'EMERGENCY'
}

// Tiers gate admission uniformly across work categories per the
// requirement doc's own table -- PRESSURED delays/serializes, CRITICAL and
// EMERGENCY refuse new heavyweight dispatch outright, HEALTHY admits.
const ADMISSION_BY_TIER = {
  HEALTHY: { decision: 'ADMIT', reason: 'host memory healthy -- normal Fleet concurrency' },
  PRESSURED: {
    decision: 'DELAY',
    reason:
      'host memory pressured -- reduce new heavy concurrency, serialize heavy verification, avoid redundant pilots'
  },
  CRITICAL: {
    decision: 'REFUSE',
    reason:
      'host memory critical -- no new heavyweight dispatch; let active work checkpoint and replan'
  },
  EMERGENCY: {
    decision: 'REFUSE',
    reason:
      'host memory emergency -- fail closed on new heavyweight dispatch; prioritize checkpointing'
  }
}

// An unrecognized tier (e.g. a future value this module doesn't know yet)
// fails closed to EMERGENCY's policy, not HEALTHY's.
export function buildAdmissionPolicy(tier) {
  const { decision, reason } = ADMISSION_BY_TIER[tier] ?? ADMISSION_BY_TIER.EMERGENCY
  return {
    newFullSuiteTests: decision,
    newBrowserPilots: decision,
    newResearchWorkers: decision,
    // Main TSF overnight review finding: the original V0 candidate had no
    // field for this category even though it's explicitly named in the
    // governing directive alongside the other three -- Keep Going's own
    // Claude/Codex worker dispatch (chat-dispatch-bridge.mjs) is the one
    // heavy operation this consults today.
    newHeavyweightWorkerDispatch: decision,
    reason
  }
}

function sanitizeProcessList(list) {
  if (!Array.isArray(list)) {
    return []
  }
  return list
    .filter((p) => p && typeof p.ownerMission === 'string' && typeof p.kind === 'string')
    .map((p) => ({
      ownerMission: p.ownerMission,
      kind: p.kind,
      reason: typeof p.reason === 'string' ? p.reason : null
    }))
}

function sanitizeWaitingList(list) {
  if (!Array.isArray(list)) {
    return []
  }
  return list
    .filter((m) => m && typeof m.missionId === 'string' && typeof m.waitingSince === 'string')
    .map((m) => ({
      missionId: m.missionId,
      waitingSince: m.waitingSince,
      blockedOn: typeof m.blockedOn === 'string' ? m.blockedOn : null
    }))
}

function sanitizeLeaseSnapshot(leases, now) {
  if (!leases || typeof leases !== 'object') {
    return []
  }
  return Object.entries(leases)
    .filter(
      ([, lease]) => lease && typeof lease.expiresAt === 'string' && new Date(lease.expiresAt) > now
    )
    .map(([kind, lease]) => ({
      kind,
      holderMissionId: lease.holderMissionId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt
    }))
}

// `hostMemory` comes from the real collector (or a test fixture); every
// other honesty-sensitive field here is either sanitized caller input or
// hard-coded -- reclaimCandidates is never a parameter, so no caller shape
// can inject a fabricated one.
export function buildResourcePressureState(
  {
    hostMemory,
    protectedProcesses = [],
    missionsWaitingForResources = [],
    leases = {},
    thresholds
  },
  clock = () => new Date()
) {
  const now = clock()
  const tier = classifyResourcePressureTier(hostMemory?.availableBytes, thresholds)
  return {
    schemaVersion: 'TSF_RESOURCE_PRESSURE_STATE_V0',
    observedAt: now.toISOString(),
    // Hard-coded: no Orca-core bridge exists, so this can never honestly
    // read 'ORCA_NATIVE_COLLECTOR'. See resource-pressure-collector.mjs.
    evidenceSource: 'TSF_OS_MODULE',
    hostMemory: {
      totalBytes: hostMemory?.totalBytes ?? null,
      freeBytes: hostMemory?.freeBytes ?? null,
      availableBytes: hostMemory?.availableBytes ?? null,
      usedPercent: hostMemory?.usedPercent ?? null
    },
    tier,
    admission: buildAdmissionPolicy(tier),
    protectedProcesses: sanitizeProcessList(protectedProcesses),
    reclaimCandidates: [],
    missionsWaitingForResources: sanitizeWaitingList(missionsWaitingForResources),
    leases: sanitizeLeaseSnapshot(leases, now)
  }
}

// Heavy-task lease: per-`kind` mutual exclusion (one live holder at a
// time) so several HQs can't independently launch full suites/pilots at
// once, layered under the tier gate above. Default TTL is long enough for
// a real full regression but short enough that a crashed/forgotten holder
// self-heals without manual intervention.
export const DEFAULT_HEAVY_TASK_LEASE_TTL_MS = 2 * 60 * 60 * 1000

function isLeaseLive(lease, now) {
  return Boolean(lease) && typeof lease.expiresAt === 'string' && new Date(lease.expiresAt) > now
}

export function requestHeavyTaskLease(
  leases,
  { kind, missionId, ttlMs = DEFAULT_HEAVY_TASK_LEASE_TTL_MS },
  tier,
  clock = () => new Date()
) {
  const now = clock()
  const admission = buildAdmissionPolicy(tier)
  if (admission.newFullSuiteTests === 'REFUSE') {
    return {
      granted: false,
      lease: null,
      reason: admission.reason,
      waitingFor: 'MEMORY_HEADROOM',
      leases
    }
  }
  const existing = leases[kind]
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
  if (isLeaseLive(existing, now) && existing.holderMissionId === missionId) {
    const refreshed = { holderMissionId: missionId, acquiredAt: existing.acquiredAt, expiresAt }
    return {
      granted: true,
      lease: { kind, ...refreshed },
      reason: 'lease already held by this mission, refreshed',
      waitingFor: null,
      leases: { ...leases, [kind]: refreshed }
    }
  }
  if (isLeaseLive(existing, now)) {
    return {
      granted: false,
      lease: null,
      reason: `the ${kind} lease is already held by mission ${existing.holderMissionId}; heavy work of this kind is serialized`,
      waitingFor: 'HEAVY_TASK_LEASE',
      leases
    }
  }
  const record = { holderMissionId: missionId, acquiredAt: now.toISOString(), expiresAt }
  return {
    granted: true,
    lease: { kind, ...record },
    reason: `${kind} lease granted`,
    waitingFor: null,
    leases: { ...leases, [kind]: record }
  }
}

export function releaseHeavyTaskLease(leases, { kind, missionId }) {
  const existing = leases[kind]
  if (!existing) {
    return { released: false, reason: 'no lease held for this kind', leases }
  }
  if (existing.holderMissionId !== missionId) {
    return {
      released: false,
      reason: `lease is held by mission ${existing.holderMissionId}, not ${missionId} -- cannot release another mission's lease`,
      leases
    }
  }
  const rest = { ...leases }
  delete rest[kind]
  return { released: true, reason: `${kind} lease released`, leases: rest }
}
