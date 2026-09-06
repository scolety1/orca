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
        opState.keepGoingRuns?.[record.lastAnalysis.projectId] ?? null
      )
    )
  const all = [...real, fixture, ...onboarded]
  const map = new Map(all.map((p) => [p.id, p]))
  return { map, opState }
}

// Delegates to work-feed-summary.mjs so Work's "active" section reflects
// real Keep Going run state (see that module's header for why the original
// mission.state-only classification was the root cause of a durable,
// ACTIVE run staying invisible to Work). keepGoingRuns/clock are optional so
// existing callers that only care about the legacy fields keep working.
export function summarizeWork(projects, keepGoingRuns = {}, clock = () => new Date(), researchMissions = {}) {
  return summarizeWorkFromRuns(projects, keepGoingRuns, clock, researchMissions)
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
