// M8 wave 12: closes acceptance item 12 ("Existing project commitments
// can create deadline/capacity conflicts"). Deliberately disclosure-only
// -- this does NOT attempt to schedule around other projects' work (that
// is a genuinely different, harder problem: multi-project scheduling
// belongs to M12's Fleet Optimizer, per wave 8's own disclosed
// deferral of the 6 named scheduling modes). What this DOES do: surface
// the real, already-known facts -- which other Work Set projects
// currently have a live Keep Going run, and whether a shared provider is
// already under real, evidenced pressure -- so a delivery date is never
// presented as if this project had exclusive access to every provider.
const ACTIVE_RUN_STATES = new Set(['ACTIVE', 'NEEDS_YOU', 'STALLED'])

// keepGoingRuns: the real opState.keepGoingRuns map (projectId -> run).
// providerForecast: this project's own real forecastProviderCapacity
// results (wave 11, unchanged) -- reused, not recomputed, so this module
// never talks to a provider CLI itself.
export function detectCompetingCommitments({
  projectId,
  workSet,
  keepGoingRuns,
  providerForecast
}) {
  const otherActiveRuns = (workSet ?? [])
    .filter((id) => id !== projectId)
    .map((id) => ({ id, run: keepGoingRuns?.[id] ?? null }))
    .filter(({ run }) => run && ACTIVE_RUN_STATES.has(run.state))
    .map(({ id, run }) => ({
      projectId: id,
      goal: run.originalGoal.statement,
      state: run.state
    }))

  const anyProviderUnderPressure = Object.values(providerForecast ?? {}).some(
    (forecast) => forecast?.likelyBottleneck === true
  )

  return {
    schemaVersion: 'TSF_COMPETING_COMMITMENTS_V1',
    otherActiveRuns,
    // Only true when BOTH a real competing run exists AND a real,
    // evidenced capacity signal (not a guess) already shows pressure --
    // never flagged from either fact alone.
    capacityContentionLikely: otherActiveRuns.length > 0 && anyProviderUnderPressure,
    note: "Disclosure only -- does not attempt to schedule around other projects' commitments. Multi-project scheduling is the Fleet Optimizer milestone's job."
  }
}
