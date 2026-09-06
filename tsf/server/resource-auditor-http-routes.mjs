// GET/POST /api/resource-auditor/* -- Orca Resource Auditor V0. Read-only:
// every route here either runs one real, read-only git command against a
// registry-checked path, or classifies caller-supplied evidence under a
// production trust boundary that can only demote a result, never trust it.
// None of these routes delete a worktree, kill a process, run Git GC, or
// purge a cache -- V0 produces evidence, classification, and dry-run plans
// only. See tsf/docs/tsf/TSF_RESOURCE_AUDITOR_V0.md.
import { collectGitObjectStoreEvidence } from './resource-auditor-git-object-store.mjs'
import { resolveCanonicalPath } from './resource-auditor-path-identity.mjs'
import {
  classifyWorkspaceResource,
  buildResourceAuditDryRunPlan,
  buildResourcePressureRecommendations,
  applyProductionTrustBoundary
} from '../domain/resource-auditor.mjs'
import {
  trustedRegistryRootsFromOperatorState,
  isPathWithinRegisteredRoots
} from '../domain/resource-auditor-evidence.mjs'

export async function handleResourceAuditorRoute(
  parts,
  req,
  res,
  { opState },
  { json, notFound, readBody }
) {
  if (parts[1] !== 'resource-auditor') {
    return false
  }

  // GET /api/resource-auditor/git-object-store?worktreePath=... -- runs
  // exactly `git count-objects -vH` against the given path and returns the
  // exact parsed fields, classified DISK_USAGE_UNKNOWN_RECLAIMABLE.
  // Path authority: the path's OS-resolved real path (following any
  // symlink/junction) must fall within TSF's own trusted workspace
  // registry -- the repoPath of an onboarded project (the same registry
  // health-repair.mjs already trusts for running baseline commands), never
  // an unrestricted caller-supplied path. An empty registry (nothing
  // onboarded yet) rejects everything -- fails closed, not open.
  if (parts[2] === 'git-object-store' && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost')
    const worktreePath = url.searchParams.get('worktreePath')
    if (!worktreePath) {
      json(res, 422, { ok: false, error: 'worktreePath query parameter is required' })
      return true
    }
    // A TOCTOU window exists between this resolution/registry check and
    // collectGitObjectStoreEvidence's later use of the path -- accepted,
    // not fixed: this route only ever discloses aggregate git object
    // counts/sizes (never file content), so the exposure from winning that
    // race is the same low-severity metadata disclosure the registry gate
    // already exists to bound, not a new capability.
    const realCandidate = await resolveCanonicalPath(worktreePath)
    if (!realCandidate) {
      json(res, 200, {
        ok: false,
        reason: 'REPOSITORY_UNAVAILABLE',
        detail: 'path does not exist or could not be resolved'
      })
      return true
    }
    const roots = trustedRegistryRootsFromOperatorState(opState)
    const realRoots = (await Promise.all(roots.map((root) => resolveCanonicalPath(root)))).filter(
      (root) => root !== null
    )
    if (!isPathWithinRegisteredRoots(realCandidate, realRoots)) {
      json(res, 403, {
        ok: false,
        reason: 'PATH_NOT_IN_TRUSTED_WORKSPACE_REGISTRY',
        detail:
          'the resolved real path is not the root of, or nested under, any onboarded project repoPath'
      })
      return true
    }
    const result = await collectGitObjectStoreEvidence(realCandidate)
    if (!result.ok) {
      json(res, 200, { ok: false, reason: result.reason, detail: result.detail })
      return true
    }
    json(res, 200, { ok: true, evidence: result.evidence })
    return true
  }

  // POST /api/resource-auditor/classify { evidence: [...] } -- pure
  // classification over caller-supplied evidence, under a hard production
  // trust boundary: every evidence item's declared provenance is
  // overwritten with CALLER_SUPPLIED unconditionally, regardless of what
  // the request body claims -- a caller cannot assert ORCA_NATIVE_SCAN or
  // TRUSTED_LOCAL_COLLECTOR to bypass this, because this route has no way
  // to independently verify such a claim. applyProductionTrustBoundary then
  // caps any resulting DISPOSABLE_CANDIDATE down to REVIEW. This is the
  // TSF-layer integration seam (mapOrcaWorkspaceCleanupCandidateToEvidence)
  // -- until a real server-side collector is wired to this route (tracked
  // as an ORCA_CORE_GAP; requires an Orca-side live evidence bridge), no
  // evidence reaching this route can ever legitimately be more trusted than
  // CALLER_SUPPLIED. Never touches the filesystem or a process.
  if (parts[2] === 'classify' && req.method === 'POST') {
    const body = await readBody(req)
    const evidenceList = Array.isArray(body?.evidence) ? body.evidence : []
    const plans = evidenceList.map((rawEvidence) => {
      const evidence = {
        ...rawEvidence,
        provenance: { ...rawEvidence.provenance, source: 'CALLER_SUPPLIED' }
      }
      const classification = classifyWorkspaceResource(evidence)
      const bounded = applyProductionTrustBoundary(classification, evidence)
      return buildResourceAuditDryRunPlan(evidence, bounded)
    })
    const recommendations = buildResourcePressureRecommendations(
      plans,
      body?.contentionSignals ?? []
    )
    json(res, 200, { ok: true, plans, recommendations })
    return true
  }

  notFound(res, `unknown resource-auditor route: ${parts.slice(2).join('/')}`)
  return true
}
