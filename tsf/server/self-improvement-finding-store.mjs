// Durable CAS store for TSF_SELF_IMPROVEMENT_FINDING_V1, keyed by findingId.
// Mirrors planner-mission-store.mjs/keep-going-run-store.mjs exactly
// (REUSE_PATTERN): same cross-process-file-lock.mjs mutex, same
// data-store.mjs opState collection convention, same synchronous-mutateFn
// constraint -- no second durability mechanism invented. Scoped per-worktree
// via opState (a self-improvement finding belongs to whichever TSF server
// detected it), not host-wide like resource-pressure-lease-store.mjs.
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedSelfImprovementFindingSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { applyDetection, findingIdFor } from '../domain/self-improvement-finding.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

// One lock file for the whole collection, not per-findingId -- same
// convention as planner-mission-store.mjs's single lockPath() covering every
// missionId.
function lockPath() {
  return `${getStateFilePath()}.self-improvement-finding.lock`
}

// Every read boundary asserts schema-version compatibility BEFORE the
// finding reaches any caller -- mirrors every other store's own
// versionCheckedXxx helper (keep-going-run-store.mjs, planner-mission-
// store.mjs). Fails closed on a version this running code was never
// verified against.
function versionCheckedFinding(finding) {
  if (finding) { assertSupportedSelfImprovementFindingSchemaVersion(finding) }
  return finding
}

export function readFinding(findingId) {
  return versionCheckedFinding(loadState().selfImprovementFindings?.[findingId] ?? null)
}

export function readAllFindings() {
  const findings = loadState().selfImprovementFindings ?? {}
  for (const finding of Object.values(findings)) { versionCheckedFinding(finding) }
  return findings
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// constraint every other withXxx in this codebase has -- see
// cross-process-file-lock.mjs's own header for why).
export async function withFinding(findingId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionCheckedFinding(opState.selfImprovementFindings?.[findingId] ?? null)
    const next = mutateFn(current)
    saveState({
      ...opState,
      selfImprovementFindings: { ...opState.selfImprovementFindings, [findingId]: next }
    })
    return next
  })
}

// The one entry point a real detector calls: computes the content-addressed
// findingId (findingIdFor, self-improvement-finding.mjs) BEFORE taking the
// lock (pure, no I/O), then applies applyDetection atomically under it --
// composing create-or-touch into a single durable round trip so two
// concurrent detections of the SAME defect can never race into two records.
export async function recordFindingDetection(raw, clock) {
  const findingId = findingIdFor(raw)
  return withFinding(findingId, (current) => applyDetection(current, raw, clock))
}
