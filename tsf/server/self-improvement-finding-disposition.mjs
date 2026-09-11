// Manual Self-Improvement Finding Disposition V1: the real, owner-
// triggered counterpart to the autonomous self-improvement loop. Reuses
// the existing finding lifecycle/store, mission origination, and adoption
// primitives DIRECTLY -- no second findings database, no second adoption
// path, no second attention system, no second receipt format. Every
// safety property (project-scoped lock, candidate revalidation, canonical
// branch revalidation, hold checks, stale-candidate refusal, duplicate-
// adoption refusal, the owner adoption-authorization gate) is inherited
// unchanged from the functions this module calls -- nothing here special-
// cases around them.
import { readFinding, withFinding } from './self-improvement-finding-store.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { originateRepairMission, computeRepairMissionId } from './self-improvement-mission-origination.mjs'
import { attemptRepairAdoption } from './self-improvement-adoption.mjs'
import { runRedogfood } from './self-improvement-redogfood.mjs'
import { readPlannerMissionRecord } from './planner-mission-store.mjs'

const STARTABLE_STATUSES = Object.freeze(['ELIGIBLE_FOR_AUTOFIX', 'NEEDS_OWNER'])

// "Start Fix" -- originates the existing bounded governed repair mission
// (originateRepairMission, reused unchanged) for a finding that either the
// classifier already deemed ELIGIBLE_FOR_AUTOFIX, or that a human owner is
// now explicitly authorizing despite the classifier's own "needs your
// call" verdict (ownerAuthorized:true, only ever set here -- the
// autonomous fleet driver's own call site never sets it, so its behavior
// is byte-identical to before this feature existed). Never itself adopts
// anything -- only originates the mission; the existing repair-cycle
// machinery (worker dispatch, verification) takes it from there exactly
// as it already does for autonomously-classified findings.
export async function startFix(findingId, { canonicalRepoPath = process.cwd(), clock = () => new Date(), deps = {} } = {}) {
  const readFindingFn = deps.readFinding ?? readFinding
  const finding = readFindingFn(findingId)
  if (!finding) {
    return { ok: false, reason: 'FINDING_NOT_FOUND' }
  }
  if (!STARTABLE_STATUSES.includes(finding.status)) {
    return { ok: false, reason: 'NOT_STARTABLE', findingStatus: finding.status }
  }
  try {
    const originate = deps.originateRepairMission ?? originateRepairMission
    const result = await originate(finding, {
      canonicalRepoPath,
      clock,
      deps: deps.originationDeps ?? {},
      ownerAuthorized: finding.status === 'NEEDS_OWNER'
    })
    return {
      ok: true,
      missionId: result.missionId,
      created: result.created,
      findingStatus: result.finding?.status ?? finding.status
    }
  } catch (error) {
    // Test #11 (owner's own list): a failed Start Fix is a truthful
    // failure -- the finding's own status is untouched (originateRepairMission
    // never wrote a transition before throwing), so it stays exactly as
    // actionable as it was before this attempt.
    return { ok: false, reason: error.code ?? 'START_FIX_FAILED', detail: error.message }
  }
}

function latestPassingVerification(checkpoint) {
  return (checkpoint?.verifierResults ?? []).toReversed().find((r) => r.verdict === 'VERIFIED_PASS') ?? null
}

// "Apply verified fix" -- ONLY ever reachable for a finding genuinely
// READY_FOR_ADOPTION (re-checked here from a FRESH read, not whatever the
// UI last rendered). Resolves the real candidate the exact same way
// self-improvement-fleet-driver.mjs's own advanceOneFinding does (the
// latest VERIFIED_PASS verifier result recorded in the real planner
// checkpoint), then reuses attemptRepairAdoption COMPLETELY UNCHANGED --
// the same real lock/gate/hold/revalidation chain the autonomous driver's
// own tick loop calls for a READY_FOR_ADOPTION finding. This is the SAME
// canonical adoption path already used for self-improvement findings --
// there is no other one -- so a manual click and an autonomous tick reach
// identical real protections, including the SAME owner adoption-
// authorization gate (self-improvement-adoption-authorization-gate.mjs):
// closed by default, exactly matching "autonomous self-improvement
// adoption stays disabled."
//
// Deliberate, disclosed divergence from advanceOneFinding's own
// orchestration: that function always runs a post-attempt redogfood
// re-check, even when adoption did NOT happen (gate closed/not ready) --
// against the CANDIDATE worktree in that case, which can legitimately
// move a finding all the way to RESOLVED without a real merge ever
// occurring (intentional for the autonomous driver's own best-effort
// per-tick progress model, confirmed by classifyRedogfoodResult's own
// header comment). For a MANUAL, owner-intentional click that is exactly
// the wrong default: an owner who clicks "Apply verified fix" and sees
// it refused (e.g. GATE_CLOSED) must never have the finding silently
// marked resolved anyway. Redogfood only ever runs here after adoption
// genuinely succeeds, against canonical (the real merged code) -- a
// refused adoption leaves the finding exactly as actionable as before.
export async function applyVerifiedFix(findingId, { canonicalRepoPath = process.cwd(), clock = () => new Date(), deps = {} } = {}) {
  const readFindingFn = deps.readFinding ?? readFinding
  const finding = readFindingFn(findingId)
  if (!finding) {
    return { ok: false, reason: 'FINDING_NOT_FOUND' }
  }
  if (finding.status !== 'READY_FOR_ADOPTION') {
    return { ok: false, reason: 'NOT_READY_FOR_ADOPTION', findingStatus: finding.status }
  }

  const missionId = computeRepairMissionId(finding.findingId)
  const readRecord = deps.readPlannerMissionRecord ?? readPlannerMissionRecord
  const checkpoint = readRecord(missionId)?.checkpoint
  const passing = latestPassingVerification(checkpoint)
  if (!passing?.detail?.worktreePath) {
    return { ok: false, reason: 'NO_VERIFIED_CANDIDATE', detail: 'READY_FOR_ADOPTION but no recorded passing verification worktree evidence found' }
  }

  const attempt = deps.attemptRepairAdoption ?? attemptRepairAdoption
  const adoption = await attempt({
    finding,
    missionId,
    worktreePath: passing.detail.worktreePath,
    branch: passing.detail.branch,
    canonicalRepoPath,
    verifierVerdict: passing.verdict,
    clock,
    deps: deps.adoptionDeps ?? {}
  })

  if (!adoption.adopted) {
    return {
      ok: true,
      action: 'ADOPTION_ATTEMPTED',
      findingId: finding.findingId,
      missionId,
      adopted: false,
      adoptionReason: adoption.reason ?? null,
      adoptionBlockers: adoption.blockers ?? null
    }
  }

  const redogfood_ = deps.runRedogfood ?? runRedogfood
  let redogfood
  try {
    redogfood = await redogfood_({ finding, missionId, targetPath: canonicalRepoPath, adoptedSha: adoption.adoptedHead, clock, deps: deps.redogfoodDeps ?? {} })
  } catch (error) {
    // Test #6 (owner's own list): two genuinely concurrent Apply requests
    // for the SAME finding -- withAdoptionLock (reused inside
    // attemptRepairAdoption) already guarantees only one real merge
    // outcome, but BOTH requests may still observe a successful,
    // idempotent ff-only merge (the loser's own merge is a real, harmless
    // no-op once the winner's merge already landed the same commit) and
    // both then try to record the SAME redogfood transition. The winner
    // records it for real; the loser's attempt is a genuine, expected
    // TSF_INVALID_FINDING_TRANSITION (the finding already moved on) --
    // read the real current state rather than crashing or guessing.
    if (error.code === 'TSF_INVALID_FINDING_TRANSITION') {
      const current = (deps.readFinding ?? readFinding)(finding.findingId)
      return {
        ok: true,
        action: 'ADOPTION_ATTEMPTED',
        findingId: finding.findingId,
        missionId,
        adopted: true,
        adoptedHead: adoption.adoptedHead,
        redogfoodOutcome: 'ALREADY_RECORDED_CONCURRENTLY',
        findingStatus: current?.status ?? finding.status
      }
    }
    throw error
  }

  return {
    ok: true,
    action: 'ADOPTION_ATTEMPTED',
    findingId: finding.findingId,
    missionId,
    adopted: true,
    adoptedHead: adoption.adoptedHead,
    redogfoodOutcome: redogfood.outcome,
    findingStatus: redogfood.finding?.status ?? finding.status
  }
}

const DISMISSIBLE_STATUSES = Object.freeze(['NEEDS_OWNER', 'READY_FOR_ADOPTION'])

// "Dismiss" -- a durable disposition, never deletion. The legality check
// runs INSIDE the same atomic lock withFinding already provides, against
// the FRESHLY-read current record (never the caller's possibly-stale
// view) -- transitionFinding's own real validation is the single source
// of truth for which states this can be reached from, not a second,
// parallel check here. Every original field (evidence, reproduction,
// classification, severity, source, transitions history) is preserved
// verbatim by transitionFinding's own deepClone -- this function only
// ever appends one transition entry, never rewrites or removes anything.
export async function dismissFinding(findingId, { reason = null, clock = () => new Date(), deps = {} } = {}) {
  const writeFinding = deps.withFinding ?? withFinding
  let outcome = null
  await writeFinding(findingId, (current) => {
    if (!current) {
      outcome = { ok: false, reason: 'FINDING_NOT_FOUND' }
      return current
    }
    try {
      const next = transitionFinding(
        current,
        'DISMISSED_BY_OWNER',
        { reason: 'OWNER_DISMISSED', evidence: reason ? [{ ownerNote: reason }] : [] },
        clock
      )
      outcome = { ok: true, finding: next }
      return next
    } catch {
      outcome = { ok: false, reason: 'NOT_DISMISSIBLE', findingStatus: current.status }
      return current
    }
  })
  return outcome
}

export { STARTABLE_STATUSES, DISMISSIBLE_STATUSES }
