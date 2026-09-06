import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadProjectsSelection,
  saveProjectsSelection,
  type ProjectsSelectionStorage
} from './projects-selection-state.ts'

function fakeStorage(): ProjectsSelectionStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value)
  }
}

test('Projects selection survives an unmount/remount round trip', () => {
  const storage = fakeStorage()
  saveProjectsSelection({ alpha: true, beta: false }, storage)
  assert.deepEqual(loadProjectsSelection(storage), { alpha: true, beta: false })
})

test('invalid persisted selection fails closed to empty, never throws', () => {
  const storage: ProjectsSelectionStorage = {
    getItem: () => '{"alpha":"not-a-boolean","":true,"beta":true}',
    setItem: () => undefined
  }
  assert.deepEqual(loadProjectsSelection(storage), { beta: true })
  assert.deepEqual(loadProjectsSelection({ getItem: () => 'not json', setItem: () => undefined }), {})
})
