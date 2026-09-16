// Gathers every known project (real pilot, the fixture, and onboarded)
// into one id-keyed map, and shapes that map for the HTTP API's two
// summary views (a Projects-page card, a Work-page mission grouping).
// Split out of http-server.mjs to stay under the repo's max-lines lint cap
// -- pure projection, no routing.
import { loadRealPilotProjects } from './portfolio-projection.mjs'
import { createFixtureState } from './fixture-project.mjs'
import { loadState } from './data-store.mjs'
import { projectOnboardedProject } from './onboarded-project-projection.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import { summarizeWorkFromRuns } from '../domain/work-feed-summary.mjs'
import { keepGoingRunWorkItem, legacyProjectPrimaryState } from '../domain/owner-work-model.mjs'
import { compareStateToGoal } from '../domain/keep-going.mjs'

// TSF UI FINDINGS #2-#16, Finding #6: pilot and fixture projects (onboarded
// projects already carry their own primaryState, computed at their own
// projection site) still need the same canonical WORKING/WAITING/NEEDS_YOU/
// DONE collapse for their own detail-page status banner -- reuses a real
// run's own keepGoingRunWorkItem when one exists, otherwise the composed
// legacy-* classification every other run-less project already uses.
function withPrimaryState(project, opState) {
  const hold = opState.projectExecutionHolds?.[project.id] ?? null
  const run = opState.keepGoingRuns?.[project.id] ?? null
  if (run) {
    const gap =
      run.state === 'ACTIVE'
        ? compareStateToGoal(run, { verifiedSatisfied: [] }, () => new Date())
        : null
    const item = keepGoingRunWorkItem(run, { gap, hold })
    return {
      ...project,
      primaryState: item.primaryState,
      primaryReasonLabel: item.primaryReasonLabel
    }
  }
  const primary = legacyProjectPrimaryState(project, hold)
  return { ...project, ...primary }
}

function fixtureCandidateView(fixture) {
  const c = fixture.candidateObject
  const rc = fixture.evidence.resultCapsules[0]
  return {
    id: c.id,
    projectId: c.projectId,
    missionId: c.missionId,
    state: c.state,
    decidable: c.state === 'READY_FOR_ADOPTION',
    branch: fixture.branch,
    head: rc.repository.head,
    tree: rc.repository.tree,
    filesChanged: rc.filesChanged,
    implementationSummary: rc.implementationSummary,
    testsRun: rc.testsRun,
    verifierVerdict: fixture.evidence.verifierRaw.verdict,
    verifierChecks: fixture.evidence.verifierRaw.checks,
    residualRisks: null,
    binding: null
  }
}

export function projectsById() {
  const real = loadRealPilotProjects()
  const fixture = createFixtureState()
  const opState = loadState()
  if (opState.fixtureCandidateDecision) {
    fixture.mission.state =
      opState.fixtureCandidateDecision.decision === 'ADOPT'
        ? 'ADOPTED'
        : opState.fixtureCandidateDecision.decision === 'REJECT'
          ? 'REJECTED'
          : 'REVISION_REQUESTED'
    fixture.release.adoption = fixture.mission.state
    fixture.candidateObject = {
      ...fixture.candidateObject,
      state:
        fixture.mission.state === 'ADOPTED'
          ? 'ADOPTED'
          : fixture.mission.state === 'REJECTED'
            ? 'REJECTED'
            : 'REVISION_REQUESTED'
    }
  }
  fixture.candidate = fixtureCandidateView(fixture)
  const fixtureReceiptChain = opState.fixtureReceipts.map((r) => ({
    ...r,
    chainValid: verifyReceipt(r)
  }))
  fixture.receipts = {
    chain: fixtureReceiptChain,
    chainValid: fixtureReceiptChain.every((r) => r.chainValid),
    tip: fixtureReceiptChain.at(-1)?.receiptHash ?? null
  }
  const onboarded = Object.values(opState.onboardedProjects ?? {})
    .filter((record) => record.acceptedAt) // only committed onboardings appear as real projects; a pure analysis isn't persisted here
    .map((record) =>
      projectOnboardedProject(
        record,
        {
          activeFleet: opState.portfolio.activeFleet.includes(record.lastAnalysis.projectId),
          workSet: opState.portfolio.workSet.includes(record.lastAnalysis.projectId)
        },
        // BUG-16: the same real Keep Going run Work/Flight Recorder/Command
        // already read, so Evidence's resultCapsules can no longer drift
        // from what actually happened.
        opState.keepGoingRuns?.[record.lastAnalysis.projectId] ?? null,
        // TSF UI FINDINGS #2-#16, Finding #6: the same real execution-hold
        // record HQ/Work/Command already read, so Overview's own status
        // banner can never disagree with the rest of the app.
        opState.projectExecutionHolds?.[record.lastAnalysis.projectId] ?? null
      )
    )
  const all = [
    ...real.map((p) => withPrimaryState(p, opState)),
    withPrimaryState(fixture, opState),
    ...onboarded
  ]
  const map = new Map(all.map((p) => [p.id, p]))
  return { map, opState }
}

// Delegates to work-feed-summary.mjs so Work's "active" section reflects
// real Keep Going run state (see that module's header for why the original
// mission.state-only classification was the root cause of a durable,
// ACTIVE run staying invisible to Work). keepGoingRuns/clock are optional so
// existing callers that only care about the legacy fields keep working.
export function summarizeWork(
  projects,
  keepGoingRuns = {},
  clock = () => new Date(),
  researchMissions = {},
  canonicalBases = {},
  projectExecutionHolds = {}
) {
  return summarizeWorkFromRuns(
    projects,
    keepGoingRuns,
    clock,
    researchMissions,
    canonicalBases,
    projectExecutionHolds
  )
}

// Real V1 stabilization finding (Operator UX pass, self-explaining project
// cards): the card view previously carried only a bare health status enum
// (e.g. "DEGRADED"), forcing an operator to open the full project detail
// page to learn WHY, whether it's intentional, or what to do next. Adds
// the same real facts the detail page already renders (mission.
// blockedReason, the real onboarding classification, restrictions, and the
// single most relevant health finding) so a card can answer that on its
// own -- no separate data source, no new health computation.
export function summarizeCard(project) {
  const topFinding = project.health.findings?.[0] ?? null
  return {
    id: project.id,
    displayName: project.displayName,
    sourceClass: project.sourceClass,
    lifecycle: project.lifecycle,
    activeFleet: project.activeFleet,
    workSet: project.workSet,
    missionState: project.mission.state,
    blockedReason: project.mission.blockedReason,
    healthStatus: project.health.status,
    // TSF UI FINDINGS #2-#16 CLOSURE, Gate 3A: the same canonical
    // WORKING/WAITING/NEEDS_YOU/DONE truth HQ/Work/Command/Overview already
    // read -- project already carries these (withPrimaryState/
    // projectOnboardedProject), never re-derived here.
    primaryState: project.primaryState,
    primaryReasonLabel: project.primaryReasonLabel,
    topFinding: topFinding
      ? { code: topFinding.code, summary: topFinding.summary, remediation: topFinding.remediation }
      : null,
    migrationClassification:
      project.evidence?.onboarding?.migrationClassification?.classification ?? null,
    restrictions: project.restrictions ?? [],
    release: project.release,
    candidateState: project.candidate?.state ?? null
  }
}
