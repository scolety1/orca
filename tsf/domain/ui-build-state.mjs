// Composes a runtime-identity classification (runtime-identity.mjs's pure
// three-commit comparison) with a separate, ongoing/failed *build action*
// axis -- whether a UI rebuild is currently running or last failed. Kept
// out of classifyLiveRuntimeState itself (which must stay a pure fact-
// comparison, no I/O, no notion of "in progress") per the stale-UI-build
// prevention spec; the orchestrator that actually spawns/tracks a build
// (tsf/server/ui-build-orchestrator.mjs) is the only real caller.
export const UI_BUILD_ACTION_STATES = Object.freeze(['UI_BUILDING', 'BUILD_FAILED'])

// buildAction: { status: 'IDLE' | 'BUILDING' | 'FAILED', reason: string|null }
// A build action only ever overrides an identity whose own raw state is
// UI_BUNDLE_STALE -- once the served bundle genuinely catches up (whether
// via this orchestrator's own build or an out-of-band manual one),
// classifyLiveRuntimeState itself reports UP_TO_DATE and this leaves that
// alone, so a stale in-memory BUILD_FAILED self-heals for free rather than
// needing to be explicitly cleared.
export function withBuildActionState(identity, buildAction) {
  if (!buildAction || buildAction.status === 'IDLE' || identity.state !== 'UI_BUNDLE_STALE') {
    return identity
  }
  if (buildAction.status === 'BUILDING') {
    return {
      ...identity,
      state: 'UI_BUILDING',
      reason: 'a UI rebuild is currently in progress to catch the served bundle up to disk'
    }
  }
  // status === 'FAILED'
  return {
    ...identity,
    state: 'BUILD_FAILED',
    reason: buildAction.reason
  }
}
