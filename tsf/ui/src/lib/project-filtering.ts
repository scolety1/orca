// Pure search/sort logic for the Projects toolbar (LifecycleFilterBar.tsx),
// kept out of that .tsx file so it can be tested directly via Node's
// type-stripping test runner (which strips types, not JSX -- see this
// repo's other *.test.ts files, none of which import a .tsx module).
import { classifyProjectLifecycle, type LifecycleBucket } from './project-lifecycle.ts'
import type { ProjectCard } from './types.ts'

export function matchesSearch(project: ProjectCard, search: string): boolean {
  if (!search.trim()) {
    return true
  }
  const q = search.trim().toLowerCase()
  return (
    project.displayName.toLowerCase().includes(q) ||
    project.id.toLowerCase().includes(q) ||
    (project.migrationClassification ?? '').toLowerCase().includes(q)
  )
}

export type ProjectSort = 'NAME_ASC' | 'NEEDS_ATTENTION_FIRST'

export const SORT_LABEL: Record<ProjectSort, string> = {
  NAME_ASC: 'Name (A–Z)',
  NEEDS_ATTENTION_FIRST: 'Needs attention first'
}

// Mirrors classifyProjectLifecycle's own documented priority reasoning
// (project-lifecycle.ts) -- a decision-needed project outranks a merely-
// degraded one, which outranks routine/ready states.
const ATTENTION_PRIORITY: Record<LifecycleBucket, number> = {
  NEEDS_YOU: 0,
  BLOCKED: 1,
  NEEDS_REPAIR: 2,
  READY_FOR_ADOPTION: 3,
  WORKING: 4,
  READY_FOR_WORK: 5,
  PAUSED: 6,
  UNKNOWN: 7
}

// "Recently updated" is deliberately not offered yet -- no ProjectCard
// field carries a real per-project update timestamp today (a known,
// disclosed gap, not a fabricated sort key).
export function sortProjects<T extends ProjectCard>(projects: T[], sort: ProjectSort): T[] {
  const indexed = projects.map((project) => ({
    project,
    bucket: classifyProjectLifecycle(project)
  }))
  if (sort === 'NAME_ASC') {
    indexed.sort((a, b) => a.project.displayName.localeCompare(b.project.displayName))
  } else {
    indexed.sort((a, b) => {
      const diff = ATTENTION_PRIORITY[a.bucket] - ATTENTION_PRIORITY[b.bucket]
      return diff !== 0 ? diff : a.project.displayName.localeCompare(b.project.displayName)
    })
  }
  return indexed.map((entry) => entry.project)
}
