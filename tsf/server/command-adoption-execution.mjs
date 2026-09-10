// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: the real
// execution engine. Resolves the project's own current canonical base
// (Part C), runs the domain revalidation checks (domain/command-adoption-
// execution.mjs) against real, freshly-gathered state, and -- only if every
// check passes -- performs a real, argv-based `git merge --ff-only` of the
// candidate branch into the canonical base, verifies it with a real
// post-merge `git rev-parse`, and durably records an ADOPTION_DECISION
// receipt (tsf/domain/receipts.mjs, REUSED verbatim) plus the canonical-base
// pointer's advance (Part C's store). Never partial/silent success: durable
// state is only ever written AFTER a real merge (or a real already-included
// determination) has already happened.
//
// HARD BOUNDARY: this module never imports anything from the self-
// improvement adoption path (self-improvement-adoption.mjs,
// self-improvement-adoption-authorization-gate.mjs) and never references
// TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION or
// OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1 -- this new capability's
// target is exclusively a real project-level Keep Going run candidate.
import {
  resolveCandidateWorktreeFromRun,
  revalidateCommandAdoptionCandidate
} from '../domain/command-adoption-execution.mjs'
import { createReceipt } from '../domain/receipts.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'
import { getCurrentCommit, isAncestor, isCleanWorkingTree, ffOnlyMerge } from '../adapters/git-identity.mjs'
import { resolveRepositoryIdentity } from './repository-identity.mjs'
import { readKeepGoingRun } from './keep-going-run-store.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { resolveProjectCanonicalBase } from './project-canonical-base-resolver.mjs'
import { recordProjectCanonicalBaseAdvanced } from './project-canonical-base-store.mjs'
import { withFileLock, acquireFileLock, releaseFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

// TSF Overnight Control-Plane Burn-In V2, Lane E (race/TOCTOU, explicitly
// named P0 territory) -- real, live-confirmed finding (not guessed):
// genuinely concurrent adoption requests for the SAME project (e.g. a
// real client retry storm, or the exact "N concurrent 'adopt it' chat
// calls" scenario this mission's own Lane D/E work covered for PAUSE
// tonight) raced past this engine's own ancestry/alreadyIncluded check --
// every concurrent caller read the SAME pre-merge canonical HEAD before
// any of them had merged, so every one of them classified the candidate
// as FAST_FORWARD_AVAILABLE (never ALREADY_INCLUDED) and proceeded to
// call ffOnlyMerge. A real `git merge --ff-only` to a SHA the repo is
// ALREADY at (because an earlier concurrent caller's merge already
// landed) is not an error -- git honestly reports "already up to date"
// and the merge call succeeds -- so this engine's own post-merge
// verification (postMerge.commit === candidateSha) could not distinguish
// "I just performed the real merge" from "someone else already did, and
// I'm merely observing it," and FALSELY reported "adopted: canonical
// advanced" with a brand-new, distinct receipt for EVERY concurrent
// caller (live-confirmed: 10 genuinely concurrent HTTP "adopt it" calls
// produced 9 separate, real, durably-persisted ADOPTED receipts for a
// SINGLE real merge). A genuine duplicate-delivery/truthfulness
// violation in the one, shared, core adoption engine every real adoption
// path in this codebase uses -- not introduced by tonight's HTTP wiring,
// but never exercised under genuine concurrency before tonight, and now
// reachable far more easily given how many more surfaces real adoption
// execution is wired into as of tonight's other fixes.
//
// Fixed by acquiring a real, per-project lock around this engine's
// ENTIRE critical section (ancestry check through the merge and receipt
// write) -- NOT server/cross-process-file-lock.mjs's own withFileLock
// convenience wrapper, whose own header comment explicitly documents a
// synchronous-fn-only contract (an await inside would let other code run
// while the "atomic" section is still open -- exactly the failure mode
// here, confirmed empirically with a standalone repro before writing
// this fix) that every one of withFileLock's other 18 real call sites
// in this codebase already correctly respects (verified: all pass a
// plain, non-async `() => {...}`). This engine's own critical section is
// inherently async (real git subprocess calls), so it uses
// acquireFileLock/releaseFileLock directly instead.
//
// Real, live-confirmed refinement caught before this fix ever landed
// (not guessed): acquireFileLock's own `heldByThisProcess` guard is a
// deliberate REENTRANCY check (its own comment: guards against an
// accidental nested/recursive acquisition bug within one call), not a
// same-process "wait your turn" queue -- two genuinely-independent
// concurrent calls in the SAME Node process for the SAME project both
// hit that guard and throw TSF_LOCK_REENTRANT immediately, which a
// first version of this fix let escape as a raw, unhandled-looking
// error instead of an honest queued wait. Confirmed live with 10
// genuinely concurrent HTTP "adopt it" calls. Fixed with a small,
// in-process, per-project promise-chain queue (adoptionQueueTails)
// BELOW acquireFileLock, so concurrent same-process callers naturally
// await their turn via ordinary promise chaining and never call
// acquireFileLock for the same path at the same time at all -- the real
// cross-process file lock still runs underneath, for the separate real
// concern of a genuinely different OS process (a CLI, a second server
// instance) touching the same project concurrently.
function adoptionExecutionLockPath(projectId) {
  return `${getStateFilePath()}.adoption-execution.${projectId}.lock`
}

const adoptionQueueTails = new Map()

async function withAdoptionLock(projectId, fn) {
  const previousTail = adoptionQueueTails.get(projectId) ?? Promise.resolve()
  // Every queued turn, including this one, must run regardless of
  // whether an earlier turn threw -- `.catch(() => {})` on the tail
  // itself (not on this turn's own result) means one project's failed
  // adoption attempt never wedges every later attempt for that same
  // project.
  const thisTurn = previousTail.catch(() => {}).then(async () => {
    const lockPath = adoptionExecutionLockPath(projectId)
    const token = await acquireFileLock(lockPath, undefined)
    try {
      return await fn()
    } finally {
      await releaseFileLock(lockPath, token)
    }
  })
  adoptionQueueTails.set(projectId, thisTurn)
  try {
    return await thisTurn
  } finally {
    // Only clear the map entry if nothing newer queued behind us while
    // we were running -- otherwise a later caller's own tail (already
    // stored) would be wrongly forgotten.
    if (adoptionQueueTails.get(projectId) === thisTurn) {
      adoptionQueueTails.delete(projectId)
    }
  }
}

export async function executeCommandAdoption(args) {
  return withAdoptionLock(args.project.id, () => executeCommandAdoptionLocked(args))
}

function lockPath() {
  return `${getStateFilePath()}.onboarded-project-receipts.lock`
}

// Locked, synchronous read-modify-write of exactly one onboarded project's
// receipts array -- mirrors project-execution-hold-store.mjs's own withXxx
// shape; no dedicated store module exists for onboardedProjects today (see
// onboarding-http-routes.mjs's own unprotected loadState/saveState), so this
// is the one real, durable append path for a receipt this engine writes.
async function appendOnboardedProjectReceipt(projectId, receiptInput, clock) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const record = opState.onboardedProjects?.[projectId]
    if (!record) {
      const error = new Error(`no onboarded project record for ${projectId} -- cannot append a receipt`)
      error.code = 'TSF_ONBOARDED_PROJECT_NOT_FOUND'
      throw error
    }
    const previousReceiptHash = record.receipts?.at(-1)?.receiptHash ?? null
    const receipt = createReceipt({ ...receiptInput, projectId }, { previousReceiptHash, clock })
    const nextRecord = { ...record, receipts: [...(record.receipts ?? []), receipt] }
    saveState({ ...opState, onboardedProjects: { ...opState.onboardedProjects, [projectId]: nextRecord } })
    return receipt
  })
}

// Classifies real ancestry between the candidate SHA and the canonical
// base's current HEAD via two real `git merge-base --is-ancestor` calls
// (adapters/git-identity.mjs, REUSED directly -- no new git primitive
// invented for this). Equal SHAs are ALREADY_INCLUDED (trivially an
// ancestor of itself, but nothing to merge).
async function classifyAncestry(ancestorCheck, root, canonicalSha, candidateSha) {
  if (canonicalSha === candidateSha) {
    return 'ALREADY_INCLUDED'
  }
  const forward = await ancestorCheck(root, canonicalSha, candidateSha)
  if (!forward.ok) {
    return 'UNKNOWN'
  }
  if (forward.isAncestor) {
    return 'FAST_FORWARD_AVAILABLE'
  }
  const backward = await ancestorCheck(root, candidateSha, canonicalSha)
  if (!backward.ok) {
    return 'UNKNOWN'
  }
  return backward.isAncestor ? 'ALREADY_INCLUDED' : 'DIVERGED'
}

// The real logic. `project` needs { id, root }. Returns
// { ok: true, alreadyIncluded, priorCanonicalSha, candidateSha, resultingCanonicalSha, receipt }
// or { ok: false, reason, detail } for any failed check -- never partial/
// silent success. Private -- always called through the real, exported,
// lock-wrapped executeCommandAdoption above; never call this directly,
// or the race it exists to close reopens.
async function executeCommandAdoptionLocked({ project, clock = () => new Date(), deps = {} }) {
  const readRun = deps.readKeepGoingRun ?? readKeepGoingRun
  const readHold = deps.readProjectExecutionHold ?? readProjectExecutionHold
  const resolveBase = deps.resolveProjectCanonicalBase ?? resolveProjectCanonicalBase
  const isClean = deps.isCleanWorkingTree ?? isCleanWorkingTree
  const currentCommit = deps.getCurrentCommit ?? getCurrentCommit
  const ancestorCheck = deps.isAncestor ?? isAncestor
  const merge = deps.ffOnlyMerge ?? ffOnlyMerge
  const resolveIdentity = deps.resolveRepositoryIdentity ?? resolveRepositoryIdentity
  const recordCanonicalAdvance = deps.recordProjectCanonicalBaseAdvanced ?? recordProjectCanonicalBaseAdvanced
  const appendReceipt = deps.appendOnboardedProjectReceipt ?? appendOnboardedProjectReceipt

  const run = readRun(project.id)
  const hold = readHold(project.id)
  const holdActive = isProjectExecutionHoldActive(hold)
  const holdDetail = holdActive ? `${hold.reason}${hold.note ? `: ${hold.note}` : ''} (set by ${hold.setBy})` : null

  const candidateWorktree = resolveCandidateWorktreeFromRun(run)
  const worktreeResolved = !!candidateWorktree
  let worktreeClean = false
  let candidateSha = null
  if (worktreeResolved) {
    const cleanResult = await isClean(candidateWorktree)
    worktreeClean = cleanResult.ok && cleanResult.clean
    const headResult = await currentCommit(candidateWorktree)
    candidateSha = headResult.ok ? headResult.commit : null
  }

  const baseResolution = await resolveBase(project, deps)
  if (!baseResolution.resolved) {
    return { ok: false, reason: baseResolution.reason, detail: baseResolution.detail }
  }
  const canonicalRef = baseResolution.ref

  // The merge itself must run in a worktree that actually has canonicalRef
  // checked out -- never silently checked out on the candidate's behalf
  // (that would be a real, surprising side effect on a repo root an
  // operator may be actively using). Mirrors the same real assumption
  // self-improvement-adoption.mjs's own canonicalRepoPath already relies on
  // (TSF's own repo is always on tsf/main).
  const canonicalIdentity = await resolveIdentity(project.root)
  let priorCanonicalSha = null
  let ancestry = 'UNKNOWN'
  let canonicalWorktreeOnBase = false
  let canonicalClean = false
  if (canonicalIdentity.ok) {
    canonicalWorktreeOnBase = canonicalIdentity.identity.branch === canonicalRef
    priorCanonicalSha = canonicalIdentity.identity.head
    if (canonicalWorktreeOnBase) {
      const canonicalCleanResult = await isClean(project.root)
      canonicalClean = canonicalCleanResult.ok && canonicalCleanResult.clean
    }
    if (worktreeResolved && candidateSha && canonicalWorktreeOnBase) {
      ancestry = await classifyAncestry(ancestorCheck, project.root, priorCanonicalSha, candidateSha)
    }
  }

  if (canonicalIdentity.ok && !canonicalWorktreeOnBase) {
    return {
      ok: false,
      reason: 'CANONICAL_WORKTREE_NOT_ON_BASE_BRANCH',
      detail: `the project's repository root is checked out on "${canonicalIdentity.identity.branch}", not the resolved canonical base "${canonicalRef}" -- refusing to check it out automatically; check it out manually before adopting`
    }
  }
  if (!canonicalIdentity.ok) {
    return { ok: false, reason: canonicalIdentity.reason, detail: canonicalIdentity.detail }
  }

  const revalidation = revalidateCommandAdoptionCandidate({
    candidateKind: 'KEEP_GOING_RUN',
    runExists: !!run,
    runState: run?.state ?? null,
    candidateProjectId: run?.projectId ?? null,
    targetProjectId: project.id,
    holdActive,
    holdDetail,
    worktreeResolved,
    worktreeClean,
    ancestry
  })
  if (!revalidation.eligible) {
    return { ok: false, reason: revalidation.reason, detail: revalidation.detail }
  }

  const missionId = run.id

  if (revalidation.alreadyIncluded) {
    const receipt = await appendReceipt(project.id, {
      kind: 'ADOPTION_DECISION',
      missionId,
      result: { outcome: 'ALREADY_INCLUDED' },
      decision: {
        type: 'ADOPT',
        alreadyIncluded: true,
        canonicalRef,
        priorCanonicalSha,
        candidateSha,
        triggeredBy: 'EXPLICIT_OWNER_COMMAND_ADOPTION'
      }
    }, clock)
    return {
      ok: true,
      alreadyIncluded: true,
      priorCanonicalSha,
      candidateSha,
      resultingCanonicalSha: priorCanonicalSha,
      receipt
    }
  }

  if (!canonicalClean) {
    return {
      ok: false,
      reason: 'CANONICAL_BASE_WORKTREE_NOT_CLEAN',
      detail: 'the canonical base worktree is not clean -- refusing to attempt a merge'
    }
  }

  // Real, argv-based fast-forward-only merge -- never a shell-interpolated
  // string. Merges by exact SHA (never a branch name resolved a second
  // time), matching the exact fact this function's own ancestry check just
  // verified.
  const mergeResult = await merge(project.root, candidateSha)
  if (!mergeResult.ok) {
    return { ok: false, reason: 'FF_ONLY_MERGE_REFUSED', detail: mergeResult.detail }
  }

  // Real post-merge verification -- never trusts the merge call's own
  // reported success alone.
  const postMerge = await currentCommit(project.root)
  if (!postMerge.ok || postMerge.commit !== candidateSha) {
    return {
      ok: false,
      reason: 'POST_MERGE_VERIFICATION_FAILED',
      detail: postMerge.ok
        ? `post-merge HEAD (${postMerge.commit}) does not match the candidate SHA (${candidateSha})`
        : postMerge.detail
    }
  }
  const resultingCanonicalSha = postMerge.commit

  const receipt = await appendReceipt(project.id, {
    kind: 'ADOPTION_DECISION',
    missionId,
    result: { outcome: 'ADOPTED' },
    decision: {
      type: 'ADOPT',
      alreadyIncluded: false,
      canonicalRef,
      priorCanonicalSha,
      candidateSha,
      resultingCanonicalSha,
      triggeredBy: 'EXPLICIT_OWNER_COMMAND_ADOPTION'
    }
  }, clock)

  // Durable canonical-base pointer update -- AFTER the receipt, both AFTER
  // the real merge already succeeded and was verified. Never written on any
  // failed path above.
  await recordCanonicalAdvance({ projectId: project.id, ref: canonicalRef, resultingSha: resultingCanonicalSha, missionId }, clock)

  return { ok: true, alreadyIncluded: false, priorCanonicalSha, candidateSha, resultingCanonicalSha, receipt }
}
