import assert from 'node:assert/strict'
import test from 'node:test'
import { loadChatDraft, saveChatDraft, type DraftStorage } from './chat-draft-storage.ts'

function fakeStorage(): DraftStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  }
}

test('round-trips a draft for a project', () => {
  const storage = fakeStorage()
  saveChatDraft('proj-a', 'half-typed note', storage)
  assert.equal(loadChatDraft('proj-a', storage), 'half-typed note')
})

test('scopes drafts by project -- one project never sees another\'s draft', () => {
  const storage = fakeStorage()
  saveChatDraft('proj-a', 'about A', storage)
  saveChatDraft('proj-b', 'about B', storage)
  assert.equal(loadChatDraft('proj-a', storage), 'about A')
  assert.equal(loadChatDraft('proj-b', storage), 'about B')
})

test('saving an empty string clears the persisted draft (submit/discard)', () => {
  const storage = fakeStorage()
  saveChatDraft('proj-a', 'in progress', storage)
  saveChatDraft('proj-a', '', storage)
  assert.equal(loadChatDraft('proj-a', storage), '')
})

test('loading with no storage available (e.g. sandboxed context) returns empty, never throws', () => {
  assert.doesNotThrow(() => loadChatDraft('proj-a', null))
  assert.equal(loadChatDraft('proj-a', null), '')
  assert.doesNotThrow(() => saveChatDraft('proj-a', 'text', null))
})

test('a storage that throws (quota exceeded, disabled) never breaks the caller', () => {
  const throwing: DraftStorage = {
    getItem: () => {
      throw new Error('boom')
    },
    setItem: () => {
      throw new Error('boom')
    },
    removeItem: () => {
      throw new Error('boom')
    }
  }
  assert.doesNotThrow(() => saveChatDraft('proj-a', 'text', throwing))
  assert.equal(loadChatDraft('proj-a', throwing), '')
})
