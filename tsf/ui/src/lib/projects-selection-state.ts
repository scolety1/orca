// Recovered from a stranded uncommitted worktree, narrowed on reconciliation:
// the original module also persisted filter/search/sort/scrollTop, but
// current main already solves that same UX problem more thoroughly --
// filter/search/sort live in the URL (projects-list-filters.ts, BUG-02) and
// survive back/forward for free via React Router, and scroll position is
// handled by scrolling the last-viewed project's own card into view
// (last-viewed-project.ts) rather than restoring a raw pixel offset that
// would drift if the list reflows. Porting those fields here would be a
// second, competing persistence mechanism for state current main already
// owns. Checkbox selection is the one piece neither of those covers --
// still plain useState({}), reset the instant ProjectsPage unmounts.
export type ProjectsSelectionStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'tsf.projects-selection.v1'

function defaultStorage(): ProjectsSelectionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function loadProjectsSelection(
  storage: ProjectsSelectionStorage | null = defaultStorage()
): Record<string, boolean> {
  if (!storage) {
    return {}
  }
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, checked]) => key.length > 0 && typeof checked === 'boolean'
      )
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function saveProjectsSelection(
  selected: Record<string, boolean>,
  storage: ProjectsSelectionStorage | null = defaultStorage()
): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(selected))
  } catch {
    // Selection restoration is best-effort when browser storage is unavailable.
  }
}
