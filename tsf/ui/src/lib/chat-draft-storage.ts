// Real V1 gap: TSF backend recovery reloads/re-navigates the page, which can
// throw away Planner Chat text Tim was halfway through typing. Persisting
// the unsent draft to localStorage (keyed per project) survives that --
// scoped narrowly to this one field, not a general offline-sync system.
//
// `storage` is injectable so this stays testable without a DOM/jsdom (no
// test framework exists for tsf/ui -- see prepare-for-work-polling.test.ts).
export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): DraftStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Some contexts (privacy mode, sandboxed iframes) throw on access.
    return null
  }
}

function draftKey(projectId: string): string {
  return `tsf.chat-draft.v1.${projectId}`
}

export function loadChatDraft(projectId: string, storage: DraftStorage | null = defaultStorage()): string {
  if (!storage) {
    return ''
  }
  try {
    return storage.getItem(draftKey(projectId)) ?? ''
  } catch {
    return ''
  }
}

export function saveChatDraft(
  projectId: string,
  text: string,
  storage: DraftStorage | null = defaultStorage()
): void {
  if (!storage) {
    return
  }
  try {
    if (text) {
      storage.setItem(draftKey(projectId), text)
    } else {
      // Never leave an empty draft on disk -- also how a successful
      // submission or explicit discard clears the persisted draft.
      storage.removeItem(draftKey(projectId))
    }
  } catch {
    // Best-effort only; a full storage quota must never block chat.
  }
}
