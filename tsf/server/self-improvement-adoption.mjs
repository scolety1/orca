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
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'
import { withAdoptionLock } from './command-adoption-execution.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'

// Real gap found by Wave D's own golden proof: ADOPTION_DECISION has
// existed in the receipt-chain enum since Wave B but no code path ever
// wrote one for ANY outcome (gate-closed, not-ready, merge-refused, or a
// real adopted merge) -- the receipt chain's own documented purpose
// ("links finding -> mission -> ... -> adoption decision -> ...") skipped
// this link entirely. One call site, all outcomes, mirrors every other
// receipt call in this mechanism (fire-and-forget after the real decision
// is already made, never gates the decision itself).
async function recordAdoptionDecisionReceipt(recordReceipt, missionId, findingId, outcome, clock) {
  await recordReceipt(missionId, { kind: 'ADOPTION_DECISION', missionId, findingId, detail: outcome }, clock)
  return outcome
}

// Pre-UI Productization V1, Priority 3 (lock/hold parity with the main
// adoption path): re-confirmed by direct code reading that this engine had
// NEITHER of command-adoption-execution.mjs's own two real safety
// properties -- (1) no per-project lock around its read-readiness-then-
// merge sequence (the exact TOCTOU shape findings #12/#14 fixed on the
// main path), and (2) zero project-execution-hold awareness at all (a
// real, active hold an operator set specifically to stop work on a
// project was silently ignored here, never checked). Fixed by reusing
// the SAME proven primitives directly -- no new lock, no new hold-read
// path: `withAdoptionLock` (now exported by command-adoption-execution.mjs)
// wraps this engine's entire body, keyed by the SAME projectId convention
// the main path uses, so a main-path adoption and a self-improvement
// repair adoption for the SAME project correctly serialize against EACH
// OTHER too, not just against themselves. Lock key falls back to
// `missionId` only when a finding is genuinely project-less
// (`finding.projectId` is nullable) -- never silently skips the lock.
// Hold is checked twice, mirroring the main path's own exact pattern:
// once early (folded into the same readiness assessment every other
// blocker already goes through) and once FRESH immediately before the
// real merge, to catch a hold that appeared while the several awaited
// git subprocess round-trips above were still in flight -- refusing on
// the CURRENT state, never the stale state this request started with.
// `Autonomous self-improvement adoption stays DISABLED`: this fix makes
// the path correct and consistent with the main path's own safety
// envelope for whenever it IS reachable; the GATE_CLOSED check below,
// unchanged, still runs first and still blocks every real production
// path today.
//
// `env`/`flagFilePath` are forwarded straight to readAdoptionAuthorizationGateState
// with NO default applied here -- undefined lets that function's own
// defaults (real process.env / real flag path) resolve, so this module
// never independently decides what "real" means; a caller that wants a
// fabricated gate for a test passes deps.env/deps.flagFilePath explicitly.
export async function attemptRepairAdoption({ finding, missionId, worktreePath, branch, canonicalRepoPath, verifierVerdict, clock = () => new Date(), deps = {} }) {
  const lockKey = finding.projectId ?? missionId
  return withAdoptionLock(lockKey, () =>
    attemptRepairAdoptionLocked({ finding, missionId, worktreePath, branch, canonicalRepoPath, verifierVerdict, clock, deps })
  )
}

// Private -- always called through the real, exported, lock-wrapped
// attemptRepairAdoption above; never call this directly, or the race it
// exists to close reopens (mirrors command-adoption-execution.mjs's own
// executeCommandAdoptionLocked convention exactly).
async function attemptRepairAdoptionLocked({ finding, missionId, worktreePath, branch, canonicalRepoPath, verifierVerdict, clock, deps }) {
  const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt
  const decided = (outcome) => recordAdoptionDecisionReceipt(recordReceipt, missionId, finding.findingId, outcome, clock)
  const readHold = deps.readProjectExecutionHold ?? readProjectExecutionHold

  const gateState = (deps.readAdoptionAuthorizationGateState ?? readAdoptionAuthorizationGateState)(deps.env, deps.flagFilePath)

  // Gate checked FIRST, before any real git I/O -- the closed-by-default
  // path (every real production run today) never touches a repo at all,
  // and a test proving "closed -> parked" needs no fixture repo/paths.
  if (!gateState.open) {
    return decided({ adopted: false, reason: 'GATE_CLOSED', blockers: ['the owner adoption-authorization gate is closed'], gateState })
  }

  // Honestly `false` when this finding carries no real project to check a
  // hold for -- never fabricated. A finding WITH a real projectId always
  // gets a real read.
  const initialHold = finding.projectId ? readHold(finding.projectId) : null
  const initialHoldActive = isProjectExecutionHoldActive(initialHold)

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
    gateOpen: gateState.open, // always true here -- the closed case already returned above
    holdActive: initialHoldActive
  })

  if (!readiness.ready) {
    return decided({ adopted: false, reason: 'NOT_READY', blockers: readiness.blockers, gateState })
  }

  // Fresh re-check, right before this function's first real action (the
  // merge) -- the initial hold read above is not sufficient on its own:
  // an operator can set a hold at any point during the several awaited
  // git subprocess round-trips this function just made. Mirrors command-
  // adoption-execution.mjs's own executeCommandAdoptionLocked exactly.
  const freshHold = finding.projectId ? readHold(finding.projectId) : null
  if (isProjectExecutionHoldActive(freshHold)) {
    return decided({
      adopted: false,
      reason: 'PROJECT_EXECUTION_HOLD_ACTIVE',
      detail: `${freshHold.reason}${freshHold.note ? `: ${freshHold.note}` : ''} (set by ${freshHold.setBy}) -- an execution hold was set while this repair adoption was in flight; refusing on current state, never the stale state this request started with`,
      gateState
    })
  }

  // Real ff-only merge -- refuses outright (never forces/resets) if
  // anything drifted between the readiness check above and this call.
  const merge = await ffOnlyMerge(canonicalRepoPath, branch)
  if (!merge.ok) {
    return decided({ adopted: false, reason: 'FF_ONLY_MERGE_REFUSED', detail: merge.detail, gateState })
  }
  const postMergeHead = await getCurrentCommit(canonicalRepoPath)
  return decided({
    adopted: true,
    previousHead: canonicalHead,
    adoptedHead: postMergeHead.ok ? postMergeHead.commit : candidateHead,
    missionId,
    findingId: finding.findingId,
    gateState
  })
}
