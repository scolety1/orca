// Real-project validation finding (BUG-02, final review wave): the
// bug's own title is "Last-viewed project/navigation position is not
// reliably preserved" -- the shipped fix (projects-list-filters.ts) only
// covers ProjectsPage's OWN filter/search/sort surviving a click-in-and-
// back round trip. It does NOT cover the literal original complaint:
// leaving a project for an entirely different section (Health Repair,
// Command, ...) and returning to Projects, which still lands on the
// plain list with no memory of which project you were just looking at --
// reproduced live against a real project during final review. This
// closes that specific remaining gap: the single fact of which project
// was last viewed, so Projects can scroll it into view instead of
// leaving the operator to re-search/re-scroll for it.
//
// Same injectable-storage pattern as chat-draft-storage.ts (no test
// framework exists for tsf/ui with a real DOM -- see that file's own
// comment) -- best-effort, never blocks navigation if storage is
// unavailable (privacy mode, sandboxed iframes).
export type LastViewedProjectStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'tsf.last-viewed-project.v1'

function defaultStorage(): LastViewedProjectStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readLastViewedProject(
  storage: LastViewedProjectStorage | null = defaultStorage()
): string | null {
  if (!storage) {
    return null
  }
  try {
    return storage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function writeLastViewedProject(
  projectId: string,
  storage: LastViewedProjectStorage | null = defaultStorage()
): void {
  if (!storage || !projectId) {
    return
  }
  try {
    storage.setItem(STORAGE_KEY, projectId)
  } catch {
    // Best-effort only -- a full storage quota must never block navigation.
  }
}
