// Global Command Dock V1: a message naming no project at all, sent while
// the dock was opened from a project's own page, MAY mean that project --
// but only when the SAME authoritative scope classifier respondCommand
// itself already uses (command-scope-classifier.mjs, real live-planner
// classification, never duplicated) says this message genuinely needs a
// project (PROJECT_REQUIRED). A fleet-wide question (GLOBAL_STATUS/
// GLOBAL_ADVISORY/NEEDS_YOU_QUERY/RESEARCH_REQUEST) or a genuinely unclear
// one (UNCLEAR) is never redirected into project scope just because a
// route hint was present -- "what's running right now" stays global
// regardless of which page the dock was opened from.
import { classifyGlobalScope } from './command-scope-classifier.mjs'

export async function resolveRouteContextFallback({ message, contextProjectId, map }) {
  if (!contextProjectId) {
    return null
  }
  const project = map.get(contextProjectId)
  if (!project) {
    return null
  }
  const classification = await classifyGlobalScope({ message })
  return classification.scope === 'PROJECT_REQUIRED' ? project : null
}
