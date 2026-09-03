// The frozen, deterministic evaluation package for the future live
// Parallel-vs-Exa bake-off (§4 Wave 5). Assembles the ALREADY-DEFINED NFL
// 2001 QB fixture pieces (specification, mission, requests) into one
// frozen package shape -- deliberately does not redefine any NFL-specific
// field/value here; it only re-exports what nfl-2001-qb-research-fixture.mjs
// already owns, so NFL specifics still live in exactly one place.
import { buildNflQb2001Mission, buildNflQb2001Specification, PERIOD_SCOPE } from './nfl-2001-qb-research-fixture.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

// Preferred/primary sources for the bake-off's source-quality dimensions,
// taken directly from the frozen specification's own sourcePolicy.
export function bakeoffPreferredSourceHosts() {
  return buildNflQb2001Specification().sourcePolicy.preferredSources
}

export function bakeoffDisallowedSourceHosts() {
  return buildNflQb2001Specification().sourcePolicy.disallowedSources
}

// expectedEntityIdByNodeId for the identity-correctness dimension --
// derived from the frozen ExpectedUniverse, not hand-duplicated.
export function bakeoffExpectedEntityIdByNodeId(mission) {
  const byEntity = new Map(mission.expectedUniverse.expectedEntities.map((e) => [e.identityHints?.team, e.entityId]))
  const map = {}
  for (const node of mission.nodes) {
    const entityId = node.targetEntity?.entityId
    if (entityId) map[node.id] = entityId
  }
  return map
}

// Builds ONE frozen request per node for the given provider label --
// exactly the same request-construction path production dispatch would
// use (buildBoundedResearchRequest), so the bake-off exercises the real
// seam, not a bake-off-only shortcut.
export function buildBakeoffRequests(mission, provider, clock) {
  return Object.fromEntries(mission.nodes.map((node) => [node.id, buildBoundedResearchRequest(mission, node, provider, clock)]))
}

export function buildBakeoffPackage(clock) {
  const specification = buildNflQb2001Specification()
  const mission = buildNflQb2001Mission(clock)
  return {
    schemaVersion: 'TSF_BAKEOFF_PACKAGE_V1',
    specification,
    mission,
    periodScope: PERIOD_SCOPE,
    preferredSourceHosts: bakeoffPreferredSourceHosts(),
    disallowedSourceHosts: bakeoffDisallowedSourceHosts(),
    expectedEntityIdByNodeId: bakeoffExpectedEntityIdByNodeId(mission)
  }
}
