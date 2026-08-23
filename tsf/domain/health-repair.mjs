// TSF Health Repair Center V1 — Health Cause Model and repair classification.
// Pure domain logic: given real evidence already gathered elsewhere (analysis
// records, baseline verification results), diagnose WHY a project reads
// less than fully HEALTHY and classify what, if anything, TSF may safely do
// about it. Never runs a command or touches a repo itself — see
// server/health-repair.mjs for the I/O layer that gathers the facts this
// module reasons over.
//
// Product rule this module exists to enforce: a repair pipeline that just
// "turns everything green" is worse than no repair pipeline — it launders
// real defects into false confidence. Every cause here traces to a fact
// evidence actually observed; every repair class is a real authority
// boundary, not a cosmetic label.

// The full Health Cause taxonomy. Each cause names ONE specific, evidence-
// backed reason a project's Health reads less than fully HEALTHY. `UNKNOWN`
// is deliberately last-resort: a cause TSF cannot yet explain from the
// evidence it has, not a bucket to reach for first.
export const HEALTH_CAUSES = Object.freeze({
  INCOMPLETE_ANALYSIS: 'INCOMPLETE_ANALYSIS',
  HANDOFF_RECONCILIATION_REQUIRED: 'HANDOFF_RECONCILIATION_REQUIRED',
  REPOSITORY_IDENTITY_AMBIGUOUS: 'REPOSITORY_IDENTITY_AMBIGUOUS',
  ORCA_NOT_REGISTERED: 'ORCA_NOT_REGISTERED',
  ORCA_TEMPORARILY_UNAVAILABLE: 'ORCA_TEMPORARILY_UNAVAILABLE',
  PLANNER_UNAVAILABLE: 'PLANNER_UNAVAILABLE',
  BASELINE_UNKNOWN: 'BASELINE_UNKNOWN',
  BASELINE_FAILING: 'BASELINE_FAILING',
  BUILD_FAILING: 'BUILD_FAILING',
  TESTS_FAILING: 'TESTS_FAILING',
  TYPECHECK_FAILING: 'TYPECHECK_FAILING',
  LINT_FAILING: 'LINT_FAILING',
  DEPENDENCY_HEALTH: 'DEPENDENCY_HEALTH',
  SECURITY_FINDINGS: 'SECURITY_FINDINGS',
  DIRTY_PRESERVE: 'DIRTY_PRESERVE',
  UNADOPTED_CANDIDATE: 'UNADOPTED_CANDIDATE',
  STALE_PROJECT_STATE: 'STALE_PROJECT_STATE',
  BLOCKED_PRODUCT_DECISION: 'BLOCKED_PRODUCT_DECISION',
  BLOCKED_ARCHITECTURAL_CONFLICT: 'BLOCKED_ARCHITECTURAL_CONFLICT',
  SENSITIVE_RESTRICTION: 'SENSITIVE_RESTRICTION',
  PAUSED_BY_DESIGN: 'PAUSED_BY_DESIGN',
  UNKNOWN: 'UNKNOWN'
})

// What TSF may actually do about a cause, in increasing order of
// consequence. AUTO_REPAIR_SAFE and GOVERNED_REPAIR_MISSION are the only
// classes TSF may act on without Tim; TIM_REQUIRED and NOT_A_DEFECT are
// both "TSF does nothing further" outcomes — the difference is that
// NOT_A_DEFECT means the project is fine as-is (paused/read-only/dirty-
// preserve by design), while TIM_REQUIRED means real evidence of a genuine
// problem or decision only Tim can resolve.
export const REPAIR_CLASSES = Object.freeze({
  AUTO_REPAIR_SAFE: 'AUTO_REPAIR_SAFE',
  GOVERNED_REPAIR_MISSION: 'GOVERNED_REPAIR_MISSION',
  TIM_REQUIRED: 'TIM_REQUIRED',
  NOT_A_DEFECT: 'NOT_A_DEFECT'
})

// Default repair class per cause. A per-project diagnosis (below) may still
// override this for a specific project when real evidence warrants it
// (e.g. a SENSITIVE project's SENSITIVE_RESTRICTION always stays
// TIM_REQUIRED — sensitive projects retain stronger authority regardless of
// anything else observed about them).
export const DEFAULT_REPAIR_CLASS = Object.freeze({
  [HEALTH_CAUSES.INCOMPLETE_ANALYSIS]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.REPOSITORY_IDENTITY_AMBIGUOUS]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.ORCA_NOT_REGISTERED]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.ORCA_TEMPORARILY_UNAVAILABLE]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.PLANNER_UNAVAILABLE]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.BASELINE_UNKNOWN]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.BASELINE_FAILING]: REPAIR_CLASSES.GOVERNED_REPAIR_MISSION,
  [HEALTH_CAUSES.BUILD_FAILING]: REPAIR_CLASSES.GOVERNED_REPAIR_MISSION,
  [HEALTH_CAUSES.TESTS_FAILING]: REPAIR_CLASSES.GOVERNED_REPAIR_MISSION,
  [HEALTH_CAUSES.TYPECHECK_FAILING]: REPAIR_CLASSES.GOVERNED_REPAIR_MISSION,
  [HEALTH_CAUSES.LINT_FAILING]: REPAIR_CLASSES.GOVERNED_REPAIR_MISSION,
  [HEALTH_CAUSES.DEPENDENCY_HEALTH]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.SECURITY_FINDINGS]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.DIRTY_PRESERVE]: REPAIR_CLASSES.NOT_A_DEFECT,
  [HEALTH_CAUSES.UNADOPTED_CANDIDATE]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.STALE_PROJECT_STATE]: REPAIR_CLASSES.AUTO_REPAIR_SAFE,
  [HEALTH_CAUSES.BLOCKED_PRODUCT_DECISION]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.BLOCKED_ARCHITECTURAL_CONFLICT]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.SENSITIVE_RESTRICTION]: REPAIR_CLASSES.TIM_REQUIRED,
  [HEALTH_CAUSES.PAUSED_BY_DESIGN]: REPAIR_CLASSES.NOT_A_DEFECT,
  [HEALTH_CAUSES.UNKNOWN]: REPAIR_CLASSES.NOT_A_DEFECT
})

// repairClass always comes from DEFAULT_REPAIR_CLASS[code] so a cause's
// authority can never silently drift from the taxonomy's own default —
// there is deliberately no per-call-site override.
function cause(code, summary, evidence = {}) {
  return { cause: code, repairClass: DEFAULT_REPAIR_CLASS[code], summary, evidence }
}

// One project's real BASELINE_STATUS_V1-shaped verification result (see
// server/health-repair.mjs's runBaselineVerification) — kept as its own
// small shape so diagnoseProjectHealth stays a pure function over plain
// data, never over a live process.
// { typecheck: 'PASS'|'FAIL'|'UNKNOWN'|'NOT_APPLICABLE', test: ..., build: ..., lint: ... }

// Diagnoses ONE onboarded project's real analysis record (the same shape
// stored as record.lastAnalysis / returned by analyzeRepository) plus an
// optional baseline verification result, into an ordered list of real
// causes. Never returns more than one cause per underlying fact — a
// project can genuinely have several causes at once (e.g. ORCA_NOT_
// REGISTERED and TESTS_FAILING together), each independently repairable.
export function diagnoseProjectHealth({ analysis, membership, baseline } = {}) {
  const causes = []
  if (!analysis?.ok) {
    return [
      cause(HEALTH_CAUSES.UNKNOWN, 'No successful analysis is on record for this project.', {
        analysisOk: analysis?.ok ?? null
      })
    ]
  }

  const classification = analysis.migrationClassification?.classification

  // Sensitive projects retain stronger authority regardless of anything
  // else observed — this is checked first and short-circuits nothing else,
  // since a sensitive project can still genuinely have other real causes
  // (a failing test is still a failing test even in a sensitive project).
  if (classification === 'SENSITIVE') {
    causes.push(
      cause(
        HEALTH_CAUSES.SENSITIVE_RESTRICTION,
        'Project is classified SENSITIVE — no autonomous work without Tim, regardless of any other finding.',
        { reasons: analysis.migrationClassification.reasons ?? [] }
      )
    )
  }

  if (classification === 'UNRESOLVED_HANDOFF_DISCREPANCY') {
    causes.push(
      cause(
        HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED,
        'An ordinary handoff/live-repo discrepancy (branch/HEAD/dirty state) has not been resolved.',
        { discrepancies: analysis.handoffReconciliation?.discrepancies ?? [] }
      )
    )
  } else if (
    classification === 'TIM_REQUIRED' &&
    analysis.handoffReconciliation?.identityAmbiguous
  ) {
    causes.push(
      cause(
        HEALTH_CAUSES.REPOSITORY_IDENTITY_AMBIGUOUS,
        'Neither the claimed branch, commit, nor repository path can be located here — this may be the wrong repository.',
        { handoffConflictSummary: analysis.handoffReconciliation ?? null }
      )
    )
  }

  if (classification === 'DIRTY_PRESERVE') {
    causes.push(
      cause(
        HEALTH_CAUSES.DIRTY_PRESERVE,
        'Repository has real uncommitted work that must be preserved — this is a legitimate state, not a defect.',
        { dirty: analysis.currentState?.dirty ?? null }
      )
    )
  }

  if (classification === 'READ_ONLY_ONBOARDING_ONLY') {
    causes.push(
      cause(
        HEALTH_CAUSES.PAUSED_BY_DESIGN,
        'Project is read-only by design at this time — not automatically a defect.',
        {}
      )
    )
  }

  if (analysis.direction && analysis.direction.live === false) {
    causes.push(
      cause(
        HEALTH_CAUSES.PLANNER_UNAVAILABLE,
        'The last direction analysis fell back — no live planner narrative is on record.',
        {}
      )
    )
  }

  // Two real, different-shaped orcaRegistration records exist in this
  // codebase: analyzeRepository's own pre-commit check and
  // refreshOrcaRegistrationStatus both carry a `status` string
  // (NOT_REGISTERED/REGISTERED/ORCA_TEMPORARILY_UNAVAILABLE/ORCA_UNKNOWN),
  // but commitOnboarding's post-commit settledAnalysis (server/onboarding-
  // http-routes.mjs) only ever carries `checked`/`registered`/`reason`/
  // `detail` -- no `status` at all. `registered === false` is checked
  // first so a real registration failure is never invisible just because
  // it came from the commit-time shape rather than the read-only one.
  const orca = analysis.orcaRegistration
  if (orca?.checked && orca.registered === false) {
    if (orca.status === 'ORCA_TEMPORARILY_UNAVAILABLE' || orca.status === 'ORCA_UNKNOWN') {
      causes.push(
        cause(
          HEALTH_CAUSES.ORCA_TEMPORARILY_UNAVAILABLE,
          `Orca registration status could not be confirmed (${orca.status}).`,
          {}
        )
      )
    } else {
      causes.push(
        cause(HEALTH_CAUSES.ORCA_NOT_REGISTERED, 'Project is not yet registered with Orca.', {
          reason: orca.reason ?? null
        })
      )
    }
  }

  if (analysis.discovery?.commandGuidance?.hasKnownTestCommand === false) {
    causes.push(
      cause(
        HEALTH_CAUSES.BASELINE_UNKNOWN,
        'No test command could be discovered — worth one rediscovery attempt before treating as permanently unknown.',
        {}
      )
    )
  }

  if (
    analysis.discovery?.commandGuidance?.packageManager &&
    analysis.discovery.commandGuidance.dependenciesInstalled === false
  ) {
    causes.push(
      cause(
        HEALTH_CAUSES.DEPENDENCY_HEALTH,
        'A package manifest exists but dependencies are not installed.',
        { packageManager: analysis.discovery.commandGuidance.packageManager }
      )
    )
  }

  const securityFinding = analysis.health?.findings?.find(
    (f) => f.code === 'SECURITY_FINDINGS_PRESENT'
  )
  if (securityFinding) {
    causes.push(
      cause(
        HEALTH_CAUSES.SECURITY_FINDINGS,
        securityFinding.summary,
        securityFinding.evidence ?? {}
      )
    )
  }

  if (baseline) {
    const failing = (command, causeCode) =>
      baseline[command] === 'FAIL' &&
      causes.push(cause(causeCode, `\`npm run ${command}\` fails.`, { command }))
    failing('typecheck', HEALTH_CAUSES.TYPECHECK_FAILING)
    failing('test', HEALTH_CAUSES.TESTS_FAILING)
    failing('build', HEALTH_CAUSES.BUILD_FAILING)
    failing('lint', HEALTH_CAUSES.LINT_FAILING)
  }

  if (membership && analysis.direction?.recommendedNextMission && !membership.workSet) {
    // A real, live-recommended next mission sitting unactioned is a mild,
    // non-blocking staleness signal, not something to force -- surfaced
    // only when nothing more specific has already been found for this
    // project, so it never crowds out a real defect.
    if (causes.length === 0) {
      causes.push(
        cause(
          HEALTH_CAUSES.STALE_PROJECT_STATE,
          'A recommended next mission is on record but the project has not been refreshed recently.',
          {}
        )
      )
    }
  }

  return causes
}

// Rolls a project's causes up into one worst-repair-class summary — the
// same "worst finding wins" pattern health.mjs already uses for status,
// applied to repair authority instead. TIM_REQUIRED outranks
// GOVERNED_REPAIR_MISSION outranks AUTO_REPAIR_SAFE outranks NOT_A_DEFECT,
// so a project is never reported as safely auto-repairable while it also
// has a cause that genuinely needs Tim.
const REPAIR_CLASS_RANK = Object.freeze({
  NOT_A_DEFECT: 0,
  AUTO_REPAIR_SAFE: 1,
  GOVERNED_REPAIR_MISSION: 2,
  TIM_REQUIRED: 3
})

export function overallRepairClass(causes) {
  if (!causes.length) {
    return REPAIR_CLASSES.NOT_A_DEFECT
  }
  return causes.reduce(
    (worst, c) =>
      REPAIR_CLASS_RANK[c.repairClass] > REPAIR_CLASS_RANK[worst] ? c.repairClass : worst,
    REPAIR_CLASSES.NOT_A_DEFECT
  )
}

// A project is genuinely ready for governed work only once every cause
// found is NOT_A_DEFECT — any AUTO_REPAIR_SAFE cause still means something
// was left unrepaired, any GOVERNED_REPAIR_MISSION/TIM_REQUIRED cause means
// a real blocker remains. This is the same bar Health recomputation checks
// after a repair action runs.
export function isReadyForWork(causes) {
  return causes.every((c) => c.repairClass === REPAIR_CLASSES.NOT_A_DEFECT)
}
