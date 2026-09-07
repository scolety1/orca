// Native Self-Improvement Loop V1, Phase 5: real, gated adoption. Reuses
// adapters/git-identity.mjs's proven ancestor-check/ff-only-merge
// primitives DIRECTLY (REUSE_DIRECTLY, same primitives self-update-
// adoption.mjs's own governance already relies on) for the canonical-repo
// side; self-improvement-worktree.mjs's own helpers for the candidate
// worktree side. No separate fetch step: createIsolatedRepairWorktree
// makes a genuinely LINKED worktree (`git worktree add`), which shares the
// canonical repo's own object database and refs by construction -- the
// candidate branch's commits are already visible from canonicalRepoPath
// with zero network/fetch step, unlike a separate clone. Documented here,
// not assumed silently.
import { assessRepairAdoptionReadiness } from '../domain/self-improvement-adoption-readiness.mjs'
import { ffOnlyMerge, getCurrentCommit, isAncestor, isCleanWorkingTree } from '../adapters/git-identity.mjs'
import { currentHeadSha, isWorktreeClean } from './self-improvement-worktree.mjs'
import { readAdoptionAuthorizationGateState } from './self-improvement-adoption-authorization-gate.mjs'

// `env`/`flagFilePath` are forwarded straight to readAdoptionAuthorizationGateState
// with NO default applied here -- undefined lets that function's own
// defaults (real process.env / real flag path) resolve, so this module
// never independently decides what "real" means; a caller that wants a
// fabricated gate for a test passes deps.env/deps.flagFilePath explicitly.
export async function attemptRepairAdoption({ finding, missionId, worktreePath, branch, canonicalRepoPath, verifierVerdict, deps = {} }) {
  const gateState = (deps.readAdoptionAuthorizationGateState ?? readAdoptionAuthorizationGateState)(deps.env, deps.flagFilePath)

  // Gate checked FIRST, before any real git I/O -- the closed-by-default
  // path (every real production run today) never touches a repo at all,
  // and a test proving "closed -> parked" needs no fixture repo/paths.
  if (!gateState.open) {
    return { adopted: false, reason: 'GATE_CLOSED', blockers: ['the owner adoption-authorization gate is closed'], gateState }
  }

  const candidateHead = await currentHeadSha(worktreePath)
  const candidateWorktreeClean = await isWorktreeClean(worktreePath)
  const canonicalCleanResult = await isCleanWorkingTree(canonicalRepoPath)
  const canonicalHeadResult = await getCurrentCommit(canonicalRepoPath)
  const canonicalClean = canonicalCleanResult.ok && canonicalCleanResult.clean
  const canonicalHead = canonicalHeadResult.ok ? canonicalHeadResult.commit : null
  const ancestorResult = canonicalHead ? await isAncestor(canonicalRepoPath, canonicalHead, candidateHead) : { ok: false, isAncestor: false }
  const candidateIsFastForward = ancestorResult.ok && ancestorResult.isAncestor

  const readiness = assessRepairAdoptionReadiness({
    findingStatus: finding.status,
    verifierVerdict,
    candidateIsFastForward,
    candidateWorktreeClean,
    canonicalClean,
    gateOpen: gateState.open // always true here -- the closed case already returned above
  })

  if (!readiness.ready) {
    return { adopted: false, reason: 'NOT_READY', blockers: readiness.blockers, gateState }
  }

  // Real ff-only merge -- refuses outright (never forces/resets) if
  // anything drifted between the readiness check above and this call.
  const merge = await ffOnlyMerge(canonicalRepoPath, branch)
  if (!merge.ok) {
    return { adopted: false, reason: 'FF_ONLY_MERGE_REFUSED', detail: merge.detail, gateState }
  }
  const postMergeHead = await getCurrentCommit(canonicalRepoPath)
  return {
    adopted: true,
    previousHead: canonicalHead,
    adoptedHead: postMergeHead.ok ? postMergeHead.commit : candidateHead,
    missionId,
    findingId: finding.findingId,
    gateState
  }
}
