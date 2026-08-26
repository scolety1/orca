// Real V1 stabilization finding: a real "Cannot read properties of
// undefined (reading 'filter')" crash on the Projects page traced back to
// a mixed-version deployment (see prepare-for-work-polling.ts's own header
// for the exact incident). That fix hardens Prepare for Work's own
// response; this hardens the two other responses ProjectsPage/HomePage/
// FleetPage consume directly and unconditionally as arrays
// (portfolio.knownProjects/.activeFleet/.workSet, work.active/.blocked/
// .readyForAdoption/.recentlyCompleted) -- normalized once here, at the
// API boundary, rather than repeating a defensive check at every one of
// the ~10 call sites across those pages. A field that's missing or the
// wrong type degrades to an empty array (an honest "nothing here" render)
// instead of throwing mid-render and blanking the whole page.
import type { Portfolio, WorkSummary } from './types'
import type { MembershipChangeResponse } from './prepare-for-work-types'

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function normalizePortfolio(raw: Partial<Portfolio> | null | undefined): Portfolio {
  return {
    usageMode: typeof raw?.usageMode === 'string' ? raw.usageMode : 'BALANCED',
    workSet: arr(raw?.workSet),
    activeFleet: arr(raw?.activeFleet),
    knownProjects: arr(raw?.knownProjects)
  }
}

export function normalizeWorkSummary(raw: Partial<WorkSummary> | null | undefined): WorkSummary {
  return {
    active: arr(raw?.active),
    queued: arr(raw?.queued),
    verifying: arr(raw?.verifying),
    needsYou: arr(raw?.needsYou),
    stalled: arr(raw?.stalled),
    blocked: arr(raw?.blocked),
    readyForAdoption: arr(raw?.readyForAdoption),
    recentlyCompleted: arr(raw?.recentlyCompleted)
  }
}

export function normalizeMembershipChange(
  raw: Partial<MembershipChangeResponse> | null | undefined
): MembershipChangeResponse {
  return {
    ok: true,
    field: raw?.field === 'workSet' ? 'workSet' : 'activeFleet',
    applied: arr(raw?.applied),
    skipped: arr(raw?.skipped),
    activeFleet: raw?.activeFleet === undefined ? undefined : arr(raw.activeFleet),
    workSet: raw?.workSet === undefined ? undefined : arr(raw.workSet)
  }
}
