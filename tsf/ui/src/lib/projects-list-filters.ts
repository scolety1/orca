import type { LifecycleBucket } from './project-lifecycle'
import type { ProjectSort } from './project-filtering'

// BUG-02 (bug-ledger.json): ProjectsPage.tsx's filter/search/sort were
// plain useState, reset to defaults the instant the page unmounted (e.g.
// clicking into a project and back) -- lost exactly the "last-viewed
// project/navigation position" context the bug names. Same URL-search-
// params pattern BUG-12's fix already established for ProjectDetailPage's
// tab (project-work-deep-link.ts) -- reused here rather than a third
// mechanism, so the state survives back/forward navigation for free via
// React Router and is honestly shareable/bookmarkable.
const KNOWN_LIFECYCLE_FILTERS = new Set<LifecycleBucket | 'ALL'>([
  'ALL',
  'NEEDS_YOU',
  'NEEDS_REPAIR',
  'READY_FOR_WORK',
  'WORKING',
  'READY_FOR_ADOPTION',
  'PAUSED',
  'BLOCKED',
  'UNKNOWN'
])
const KNOWN_SORTS = new Set<ProjectSort>(['NAME_ASC', 'NEEDS_ATTENTION_FIRST'])

export const DEFAULT_LIFECYCLE_FILTER: LifecycleBucket | 'ALL' = 'ALL'
export const DEFAULT_SORT: ProjectSort = 'NEEDS_ATTENTION_FIRST'

export type ProjectsListFilters = {
  filter: LifecycleBucket | 'ALL'
  search: string
  sort: ProjectSort
}

// Resolves an untrusted `URLSearchParams` (a bookmark, a hand-edited URL,
// a stale link) to a real filter state, never crashing on garbage --
// same discipline as project-work-deep-link.ts's resolveProjectDetailTab.
export function readProjectsListFilters(params: URLSearchParams): ProjectsListFilters {
  const rawFilter = params.get('filter')
  const rawSort = params.get('sort')
  return {
    filter:
      rawFilter && KNOWN_LIFECYCLE_FILTERS.has(rawFilter as LifecycleBucket | 'ALL')
        ? (rawFilter as LifecycleBucket | 'ALL')
        : DEFAULT_LIFECYCLE_FILTER,
    search: params.get('q') ?? '',
    sort: rawSort && KNOWN_SORTS.has(rawSort as ProjectSort) ? (rawSort as ProjectSort) : DEFAULT_SORT
  }
}

// Builds the next URLSearchParams for a filter change -- omits any value
// still at its default so a plain, untouched /projects visit keeps a
// clean URL rather than always carrying every param.
export function writeProjectsListFilters(filters: ProjectsListFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.filter !== DEFAULT_LIFECYCLE_FILTER) {
    params.set('filter', filters.filter)
  }
  if (filters.search) {
    params.set('q', filters.search)
  }
  if (filters.sort !== DEFAULT_SORT) {
    params.set('sort', filters.sort)
  }
  return params
}
