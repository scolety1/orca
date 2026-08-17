import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const path = fileURLToPath(new URL('./capability-migration.v1.json', import.meta.url))
const manifest = JSON.parse(await readFile(path, 'utf8'))

const coverage = {
  UPSTREAM_NATIVE: {
    'WRK-009': 'Orca native isolated worktrees and coordination primitives',
    'MSN-008': 'Orca native terminal/session ownership and restart recovery',
    'MSN-012': 'Orca native durable long-running terminal sessions',
    'GIT-001': 'Orca native repository/workspace inspection',
    'GIT-002': 'Orca native isolated worktree execution replaces legacy Mirror runtime',
    'GIT-004': 'Orca native worktree and candidate branch identity',
    'GIT-005': 'Orca native concurrent isolated worktrees',
    'HLT-002': 'Orca native runtime and session health facts',
    'EXT-001': 'Orca plugin/skill/agent capability discovery',
    'REL-002': 'Orca native durable stores and atomic plugin storage',
    'REL-005': 'Orca native terminal/session ownership and duplicate-worker fencing'
  },
  REUSED_LEGACY_CODE: {
    'CTX-005': 'Legacy project-context capsule schema retained byte-for-byte',
    'MSN-005': 'Legacy operator action lifecycle/idempotency helper retained byte-for-byte',
    'AUT-008': 'Legacy action identity, replay, pending, and interruption logic retained',
    'UI-007': 'Legacy operator action lifecycle state model retained'
  },
  ADAPTED_LEGACY_CODE: {
    'RTE-001': 'Stable legacy aliases adapted into provider-neutral execution roles',
    'RTE-003': 'Legacy model/effort tiers adapted into role mappings and observed/requested resolution',
    'RTE-004': 'Legacy Usage Modes adapted to Orca roles, retry, autonomy, and trust policy',
    'CTX-003': 'Legacy mission envelope outcomes adapted into TSF_PLAN_CAPSULE_V1',
    'CTX-004': 'Legacy result envelope outcomes adapted into TSF_RESULT_CAPSULE_V1',
    'LEG-003': 'Legacy thin work-order invariants adapted into compact plan capsules'
  },
  NEW_TSF_OVERLAY: {
    'PRJ-001': 'Bounded project registration domain contract; fixture-only runway',
    'PRJ-002': 'Known-project registry and provenance classes',
    'PRJ-006': 'Active Fleet domain logic',
    'PRJ-007': 'Work Set subset, fingerprint, and saved-set logic',
    'WRK-001': 'Persistent planner identity and bounded decomposition contract',
    'WRK-003': 'Planner/worker coordination above Orca sessions',
    'WRK-006': 'Independent verifier session enforcement',
    'RTE-007': 'Provider-neutral stable role registry and configurable profiles',
    'CTX-001': 'Planner episode session-affinity contract and replacement receipt',
    'CTX-002': 'Worker mission session/worktree affinity enforcement',
    'MSN-002': 'High-level TSF mission state and Orca runtime fact projection',
    'MSN-007': 'Compact result admission validation and evidence requirement',
    'GIT-011': 'Exact-binding adoption/reject/revision domain logic',
    'GIT-013': 'Stable/Upgrade/Testing/Published domain model',
    'GIT-014': 'Exact-binding test disposition and Stable promotion model',
    'AUT-003': 'Worker completion remains READY_FOR_ADOPTION until exact decision',
    'AUT-007': 'Receipt Lite schema, hashes, producer/session facts, and verification',
    'HLT-001': 'Actionable project/candidate/provider/compatibility Health projection'
  }
}

const byId = new Map()
for (const [state, entries] of Object.entries(coverage)) {
  for (const [id, evidence] of Object.entries(entries)) byId.set(id, { state, evidence })
}

manifest.allowedStates = [
  'UPSTREAM_NATIVE',
  'REUSED_LEGACY_CODE',
  'ADAPTED_LEGACY_CODE',
  'NEW_TSF_OVERLAY',
  'PENDING',
  'REFERENCE_ONLY',
  'REJECTED'
]
manifest.capabilities = manifest.capabilities.map((entry) => {
  const mapped = byId.get(entry.id)
  if (mapped) return { ...entry, state: mapped.state, successorEvidence: mapped.evidence }
  if (entry.state === 'REFERENCE_ONLY' || entry.state === 'REJECTED') return entry
  return { ...entry, state: 'PENDING' }
})
manifest.summary = Object.fromEntries(
  manifest.allowedStates.map((state) => [state, manifest.capabilities.filter((entry) => entry.state === state).length])
)
manifest.summary.TOTAL = manifest.capabilities.length
manifest.updatedAt = '2026-08-17'
manifest.coverageRule = 'A non-PENDING state means foundation or overlay behavior exists; it does not claim final legacy parity unless separately proven.'

await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
