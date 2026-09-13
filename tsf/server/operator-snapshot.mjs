// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 5: ONE coherent operator
// snapshot, built from a SINGLE real state read -- not `/portfolio` then
// `/work` then `/attention` as three separate HTTP requests (each of which
// today independently calls loadState()-backed readers, so a mutation
// landing between them could make the three legacy endpoints disagree;
// Stage 0's own archaeology named this Claim F). `projectsById()` already
// does exactly one real `loadState()` internally -- every section below
// reads directly off that SAME returned `opState` object's own fields,
// never a second independent `readAllXxx()` call (each of which would be
// its own extra `loadState()` read of the identical underlying file).
//
// Builds on Stage 3's canonical owner Work model (domain/owner-work-model.mjs)
// and the existing, already-correct fleetNeedsYouStatus/
// buildFleetAttentionItems projections -- reuses their real classification,
// never re-derives a second one.
import { statSync } from 'node:fs'
import { projectsById, summarizeCard } from './project-catalog.mjs'
import { getStateFilePath } from './data-store.mjs'
import { buildOwnerWorkItems } from '../domain/owner-work-model.mjs'
import { buildFleetAttentionItems } from '../domain/fleet-attention-status.mjs'
import { fleetNeedsYouStatus } from '../domain/fleet-work-status.mjs'
import { buildResourcePressureState } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'

// The simplest correct revision mechanism this codebase already has for
// free: the state file's own real mtime, bumped by every real saveState()
// write (a tmp-write + atomic rename) -- no new schema, no new persisted
// counter, no event-sourcing rewrite. A monotonic-enough freshness marker
// for "has anything owner-relevant changed since I last asked", not a
// distributed-consensus sequence number. Returns 0 (never throws) before
// any real state has ever been written -- an honest "nothing yet", not a
// fabricated one.
export function currentOperatorRevision(deps = {}) {
  const stat = deps.statSync ?? statSync
  const statePath = deps.getStateFilePath ?? getStateFilePath
  try {
    return stat(statePath()).mtimeMs
  } catch {
    return 0
  }
}

// deps: injectable seams for the two independently-instantiable real
// readers (project catalog, host memory) -- mirrors every other real
// projection in this codebase's own deps-override convention. clock: the
// same convention every other real projection function here already uses.
export function buildOperatorSnapshot(clock = () => new Date(), deps = {}) {
  const readProjects = deps.projectsById ?? projectsById
  const { map, opState } = readProjects()
  const projects = [...map.values()]

  const keepGoingRuns = opState.keepGoingRuns ?? {}
  const researchMissions = opState.researchMissions ?? {}
  const plannerMissionRecords = opState.plannerMissions ?? {}
  const selfImprovementFindings = opState.selfImprovementFindings ?? {}
  const projectExecutionHolds = opState.projectExecutionHolds ?? {}
  const projectCanonicalBases = opState.projectCanonicalBases ?? {}

  const buildWorkItems = deps.buildOwnerWorkItems ?? buildOwnerWorkItems
  const workItems = buildWorkItems(
    projects,
    keepGoingRuns,
    researchMissions,
    projectCanonicalBases,
    clock
  )

  const readHostMemory = deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence
  const buildPressureState = deps.buildResourcePressureState ?? buildResourcePressureState
  const capacity = buildPressureState({ hostMemory: readHostMemory() }, clock)

  const buildAttentionItems = deps.buildFleetAttentionItems ?? buildFleetAttentionItems
  const attentionItems = buildAttentionItems({
    projects,
    keepGoingRuns,
    researchMissions,
    plannerMissionRecords,
    selfImprovementFindings,
    projectExecutionHolds,
    projectCanonicalBases,
    resourcePressureState: capacity,
    clock
  })

  const readNeedsYouStatus = deps.fleetNeedsYouStatus ?? fleetNeedsYouStatus
  const needsYou = readNeedsYouStatus(
    projects,
    keepGoingRuns,
    researchMissions,
    plannerMissionRecords
  )

  return {
    revision: currentOperatorRevision(deps),
    generatedAt: clock().toISOString(),
    projects: projects.map(summarizeCard),
    // Stage 6 (Goal -> Work hierarchy) territory -- no real, stable goal ID
    // exists yet anywhere in this codebase; honestly empty rather than a
    // fabricated placeholder, per this mission's own "a partial projection
    // with honest limitations is better than another storage system."
    goals: [],
    work: workItems,
    // The complete, already-built 3-source resource-wait aggregation
    // (Keep Going / ResearchMission / self-improvement -- Stage 1B/this
    // mission's own prior work), not re-derived from workItems alone
    // (which only covers Keep Going + Research, not self-improvement).
    waiting: attentionItems.filter((item) => item.category === 'WAITING_FOR_RESOURCES'),
    needsYou,
    recentlyDone: workItems.filter((item) => item.state === 'DONE'),
    capacity
  }
}
