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
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

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

// The real entry point. `project` needs { id, root }. Returns
// { ok: true, alreadyIncluded, priorCanonicalSha, candidateSha, resultingCanonicalSha, receipt }
// or { ok: false, reason, detail } for any failed check -- never partial/
// silent success.
export async function executeCommandAdoption({ project, clock = () => new Date(), deps = {} }) {
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
