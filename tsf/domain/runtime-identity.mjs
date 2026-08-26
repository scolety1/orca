// Classifies TSF's own live-vs-disk runtime identity into an honest
// operator state (spec Phase 1). Every input must already be a real,
// independently-gathered fact (a git commit captured at process start, a
// fresh git commit read right now, a commit embedded in the served UI
// bundle at its own build time) -- this module only compares, it never
// probes git or the filesystem itself (see adapters/git-identity.mjs for
// that).
export const RUNTIME_IDENTITY_STATES = Object.freeze([
  'UP_TO_DATE',
  'LIVE_RUNTIME_STALE',
  'UI_BUNDLE_STALE',
  'UNKNOWN'
])

export function classifyLiveRuntimeState({ runningCommit, diskCommit, uiBundleCommit }) {
  if (!runningCommit || !diskCommit) {
    // Never guess "up to date" when identity genuinely can't be
    // established -- an honest unknown is safer than a false positive.
    return { state: 'UNKNOWN', reason: 'commit identity could not be determined' }
  }
  if (runningCommit !== diskCommit) {
    return {
      state: 'LIVE_RUNTIME_STALE',
      reason: `the running backend started from ${runningCommit.slice(0, 10)}, but disk is now at ${diskCommit.slice(0, 10)} -- a restart is required to pick it up`
    }
  }
  if (uiBundleCommit !== diskCommit) {
    return {
      state: 'UI_BUNDLE_STALE',
      reason: uiBundleCommit
        ? `the served UI bundle was built from ${uiBundleCommit.slice(0, 10)}, not the current ${diskCommit.slice(0, 10)}`
        : 'no UI bundle identity found -- it may never have been built, or was built before this tracking existed'
    }
  }
  return {
    state: 'UP_TO_DATE',
    reason: 'the running backend and served UI both match the current commit'
  }
}
