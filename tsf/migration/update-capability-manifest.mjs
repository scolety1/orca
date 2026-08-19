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
    'REL-005': 'Orca native terminal/session ownership and duplicate-worker fencing',
    'LEG-004': 'Orca native browser snapshot, select interaction, and loopback verification against the disposable fixture'
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
    'PRJ-001': 'Bounded, read-only-first project onboarding (repo analysis, handoff reconciliation, migration classification, commit) proven end-to-end against a real local repository, including live Orca repo registration',
    'PRJ-002': 'Known-project registry and provenance classes',
    'PRJ-003': 'Bounded repository discovery (README/AGENTS.md/CLAUDE.md, package manifests, command guidance, stack/test/build detection) via tsf/server/repo-inspector.mjs, proven against a real local repository',
    'PRJ-006': 'Active Fleet domain logic',
    'PRJ-007': 'Work Set subset, fingerprint, saved-set logic, fail-closed new-dispatch gate, and explicit reentry proof',
    'PRJ-008': 'Known Projects/Active Fleet/Work Set lifecycle exercised end-to-end through real project onboarding, gated by the reused domain/portfolio.mjs invariant (Work Set is never automatic)',
    'WRK-001': 'Persistent Orca planner session decomposed and checkpointed one planning episode without implementing product code',
    'WRK-003': 'Planner coordinated four real Orca task/dispatch/worktree sessions through compact capsules',
    'WRK-006': 'Independent deterministic and deep Orca verifier sessions attested exact commits, trees, paths, tests, and browser behavior',
    'RTE-007': 'Provider-neutral stable role registry and configurable profiles',
    'CTX-001': 'Planner episode session-affinity contract and replacement receipt',
    'CTX-002': 'Worker mission session/worktree affinity enforcement',
    'MSN-002': 'High-level TSF mission state and Orca runtime fact projection',
    'MSN-007': 'Compact result admission validation and evidence requirement',
    'MSN-009': 'Sticky planner checkpointed automatic continuation through four bounded tasks and final synthesis',
    'MSN-010': 'Work Set removal blocks new dispatch while existing workers may settle; explicit reentry restores admission',
    'MSN-011': 'Capsule stop conditions and bounded same-owner correction prevented repeated or authority-expanding repair loops',
    'GIT-010': 'Independent Git and verifier checks rejected false-success claims until exact clean candidate commits existed',
    'GIT-011': 'Exact-binding adoption/reject/revision domain logic',
    'GIT-012': 'Governed local fixture workers produced exact candidate commits with clean isolated worktrees and no publication',
    'GIT-013': 'Stable/Upgrade/Testing/Published domain model',
    'GIT-014': 'Exact-binding test disposition and Stable promotion model',
    'AUT-003': 'Worker completion remains READY_FOR_ADOPTION until exact decision',
    'AUT-007': 'Receipt Lite schema, hashes, producer/session facts, and verification',
    'REL-007': 'Candidate admission binds exact commit/tree/path/test evidence plus independent runtime and browser attestation',
    'HLT-001': 'Actionable project/candidate/provider/compatibility Health projection, extended with an onboarding-time repository Health assessor (tsf/domain/health.mjs:assessRepositoryOnboardingHealth) proven against a real local repository'
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
manifest.updatedAt = '2026-08-19'
manifest.coverageRule = 'A non-PENDING state means foundation or overlay behavior exists; it does not claim final legacy parity unless separately proven.'

await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
