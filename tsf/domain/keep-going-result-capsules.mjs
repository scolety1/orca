// BUG-16 (bug-ledger.json): Flight Recorder's timeline (flight-recorder.mjs)
// already projects every recorded wave from the real Run Journal
// (domain/keep-going.mjs's run.waves), but the Evidence tab reads a wholly
// different field -- project.evidence.resultCapsules -- which is a
// hardcoded [] for every onboarded project (server/onboarded-project-
// projection.mjs) with no write path from a settled wave into it at all.
// The result: Flight Recorder shows real waves settling while Evidence
// honestly shows nothing, for every real (non-fixture, non-legacy-pilot)
// project. This is a pure projection over the SAME run.waves data Flight
// Recorder already reads -- never a second, independently-drifting store.
//
// Privacy note (matches flight-recorder.mjs's own discipline): only the
// per-work-item outcome record is used, never a wave's full wavePlan
// (which may carry a raw spec) -- the real dispatch/settle path
// (keep-going-dispatch-loop.mjs, domain/keep-going.mjs's abandon path)
// records outcomes shaped { workItemId, scope, taskId, dispatchId,
// outcome, rawStatus? } with no implementationSummary/filesChanged/
// testsRun/workerIdentity today (that richer shape exists only for the
// fixture/legacy-pilot result-capsule sources) -- fields not honestly
// derivable from a real run are left null/empty here, never fabricated.
export function resultCapsulesFromRun(run) {
  if (!run) {
    return []
  }
  const capsules = []
  // Independent-verification hardening suggestion: run.waves/.outcomes are
  // always real arrays on every write path this codebase has today (both
  // confirmed by the domain/server code and by tests), so this is
  // defense-in-depth against genuinely corrupted persisted state, never
  // expected to trigger in practice -- matches this codebase's own "never
  // crash on malformed persisted state" discipline elsewhere.
  for (const wave of run.waves ?? []) {
    const outcomes = wave.waveResult?.outcomes
    for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
      capsules.push({
        id: outcome.workItemId ?? outcome.taskId ?? null,
        status: outcome.outcome ?? 'UNKNOWN',
        filesChanged: [],
        testsRun: [],
        implementationSummary: outcome.note ?? null,
        workerIdentity: outcome.taskId ? { orcaSessionId: outcome.taskId, worktreeId: null } : null
      })
    }
  }
  return capsules
}
