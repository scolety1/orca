import { deepClone, isoNow, sha256 } from './canonical.mjs'

const PROJECT_CLASSES = new Set(['FIXTURE', 'REAL', 'SYSTEM', 'INTERNAL'])

export function createPortfolio(clock) {
  return {
    schemaVersion: 'TSF_PORTFOLIO_V1',
    revision: 0,
    projects: {},
    activeFleet: [],
    workSet: [],
    savedWorkSets: {},
    updatedAt: isoNow(clock)
  }
}

export function registerProject(portfolio, project, clock) {
  if (!project?.id || !project?.displayName || !project?.root || !PROJECT_CLASSES.has(project.sourceClass)) {
    throw new Error('project requires id, displayName, root, and a recognized sourceClass')
  }
  if (portfolio.projects[project.id]) throw new Error(`project already registered: ${project.id}`)
  const next = deepClone(portfolio)
  next.projects[project.id] = {
    schemaVersion: 'TSF_PROJECT_V1',
    id: project.id,
    displayName: project.displayName,
    root: project.root,
    sourceClass: project.sourceClass,
    lifecycle: project.lifecycle ?? 'IN_DEVELOPMENT',
    eligible: project.eligible !== false,
    provenance: project.provenance ?? 'LOCAL_EXPLICIT',
    registeredAt: isoNow(clock)
  }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function setActiveFleet(portfolio, projectIds, clock) {
  const unique = [...new Set(projectIds)]
  for (const id of unique) {
    const project = portfolio.projects[id]
    if (!project) throw new Error(`unknown project: ${id}`)
    if (!project.eligible || project.sourceClass === 'INTERNAL') {
      throw new Error(`project is not Active Fleet eligible: ${id}`)
    }
  }
  const next = deepClone(portfolio)
  next.activeFleet = unique
  next.workSet = next.workSet.filter((id) => unique.includes(id))
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function setWorkSet(portfolio, projectIds, clock) {
  const unique = [...new Set(projectIds)]
  for (const id of unique) {
    if (!portfolio.activeFleet.includes(id)) {
      throw new Error(`Work Set must be a subset of Active Fleet: ${id}`)
    }
  }
  const next = deepClone(portfolio)
  next.workSet = unique
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function assertNewDispatchAllowed(portfolio, projectId) {
  const project = portfolio.projects[projectId]
  if (!project) throw new Error(`new dispatch blocked for unknown project: ${projectId}`)
  if (!project.eligible) throw new Error(`new dispatch blocked for ineligible project: ${projectId}`)
  if (!portfolio.activeFleet.includes(projectId)) {
    throw new Error(`new dispatch blocked outside Active Fleet: ${projectId}`)
  }
  if (!portfolio.workSet.includes(projectId)) {
    throw new Error(`new dispatch blocked outside Work Set: ${projectId}`)
  }
  return {
    allowed: true,
    projectId,
    portfolioRevision: portfolio.revision,
    workSetFingerprint: workSetFingerprint(portfolio)
  }
}

export function saveWorkSet(portfolio, name, clock) {
  if (!name?.trim()) throw new Error('saved Work Set name is required')
  const next = deepClone(portfolio)
  next.savedWorkSets[name.trim()] = [...portfolio.workSet]
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function workSetFingerprint(portfolio) {
  return sha256({ revision: portfolio.revision, activeFleet: portfolio.activeFleet, workSet: portfolio.workSet })
}
