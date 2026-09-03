import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLastViewedProject, writeLastViewedProject } from './last-viewed-project.ts'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    }
  }
}

test('writeLastViewedProject then readLastViewedProject round-trips the real project id', () => {
  const storage = fakeStorage()
  writeLastViewedProject('quoteloop', storage)
  assert.equal(readLastViewedProject(storage), 'quoteloop')
})

test('readLastViewedProject with no storage/no prior write returns null, never a fabricated id', () => {
  assert.equal(readLastViewedProject(fakeStorage()), null)
})

test('writeLastViewedProject with a null storage (privacy mode / sandboxed) is a safe no-op', () => {
  assert.doesNotThrow(() => writeLastViewedProject('quoteloop', null))
})

test('writeLastViewedProject with an empty project id is a no-op -- never persists a blank value', () => {
  const storage = fakeStorage()
  writeLastViewedProject('quoteloop', storage)
  writeLastViewedProject('', storage)
  assert.equal(readLastViewedProject(storage), 'quoteloop')
})

test('a later write overwrites the earlier one -- only the single most-recent project is remembered', () => {
  const storage = fakeStorage()
  writeLastViewedProject('quoteloop', storage)
  writeLastViewedProject('route-reader', storage)
  assert.equal(readLastViewedProject(storage), 'route-reader')
})
