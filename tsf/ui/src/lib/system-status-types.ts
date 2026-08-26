// Mirrors tsf/domain/runtime-identity.mjs and tsf/domain/update-safety.mjs
// -- every field here traces back to a real git commit, a real running
// process fact, or the real fleet aggregator, never a client-side guess.
export type RuntimeIdentityState =
  | 'UP_TO_DATE'
  | 'LIVE_RUNTIME_STALE'
  | 'UI_BUNDLE_STALE'
  | 'UNKNOWN'

export type RuntimeIdentity = {
  runningCommit: string | null
  diskCommit: string | null
  uiBundleCommit: string | null
  startedAt: string
  pid: number
  state: RuntimeIdentityState
  reason: string
}

export type UpdateSafetyState = 'SAFE_NOW' | 'WAIT_FOR_ACTIVE_WORK' | 'TIM_REQUIRED'

export type UpdateSafety = {
  state: UpdateSafetyState
  reason: string
  blockingProjectIds: string[]
}
