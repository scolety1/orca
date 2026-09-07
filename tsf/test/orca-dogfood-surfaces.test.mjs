// Finding F7: proves openSettingsPane/MAIN_SHELL_SURFACE.open wait on the
// real store condition (activeView), not a fixed sleep. A fake Playwright
// Page implements waitForFunction by really polling window.__store --
// exercising the same production code path (buildOrcaSurfaceStrategy()'s
// surfaces) a real Electron run drives.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrcaSurfaceStrategy } from '../adapters/orca-dogfood-surfaces.mjs'

// Minimal real-enough fake of Playwright's Page: evaluate() runs a function
// against the fake `window` global synchronously; waitForFunction() polls it
// on a real interval and rejects on real timeout, exactly like the
// production Playwright API this replaces in tests.
function fakePage() {
  return {
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: (fn, arg, { timeout } = {}) =>
      new Promise((resolve, reject) => {
        const start = Date.now()
        const poll = () => {
          if (fn(arg)) {
            resolve(true)
            return
          }
          if (Date.now() - start >= timeout) {
            reject(new Error(`waitForFunction: timeout ${timeout}ms exceeded`))
            return
          }
          setTimeout(poll, 5)
        }
        poll()
      })
  }
}

function installFakeStore(initialState) {
  const state = { ...initialState }
  globalThis.window = {
    __store: {
      getState: () => state,
      setState: (patch) => Object.assign(state, patch)
    }
  }
  return state
}

test.afterEach(() => {
  delete globalThis.window
})

test('settings-pane surface.open() waits for the real activeView condition, not a fixed sleep', async () => {
  const state = installFakeStore({
    activeView: 'terminal',
    settingsNavigationTarget: null,
    openSettingsTarget(target) {
      state.settingsNavigationTarget = target
    },
    openSettingsPage() {
      // Real app latency modeled as > the OLD 200ms fixed sleep this
      // finding removed -- proves the wait is condition-based: a fixed
      // 200ms `waitForTimeout` would have returned to the caller BEFORE
      // this state transition ever happened, letting a slow-render defect
      // go undetected.
      setTimeout(() => Object.assign(state, { activeView: 'settings' }), 260)
    }
  })

  const page = fakePage()
  const surface = buildOrcaSurfaceStrategy({ paneIds: ['general'] })().find(
    (s) => s.id === 'settings-general'
  )
  const openedAt = Date.now()
  await surface.open(page)
  const elapsed = Date.now() - openedAt

  // Resolved only once the real condition became true -- proves it waited
  // past the old 200ms sleep threshold instead of racing ahead of it.
  assert.ok(elapsed >= 250, `expected open() to wait for the real state transition, got ${elapsed}ms`)
  assert.equal(state.activeView, 'settings')
})

test('settings-pane surface.open() survives settingsNavigationTarget being cleared before the next poll tick (real app race)', async () => {
  // Reproduces the real Settings.tsx behavior this finding's first draft
  // fix got wrong: openSettingsTarget()/openSettingsPage() land, then a
  // React effect elsewhere reacts to settingsNavigationTarget and clears it
  // right back to null (clearSettingsTarget()) well before activeView
  // itself changes -- a naive wait on "settingsNavigationTarget still
  // matches the pane" would time out even on a real, successful navigation.
  const state = installFakeStore({
    activeView: 'terminal',
    settingsNavigationTarget: null,
    openSettingsTarget(target) {
      state.settingsNavigationTarget = target
      // Cleared on the very next tick, well before activeView flips --
      // models Settings.tsx's own consume-and-clear effect.
      setTimeout(() => Object.assign(state, { settingsNavigationTarget: null }), 5)
    },
    openSettingsPage() {
      setTimeout(() => Object.assign(state, { activeView: 'settings' }), 100)
    }
  })
  const page = fakePage()
  const surface = buildOrcaSurfaceStrategy({ paneIds: ['general'] })().find(
    (s) => s.id === 'settings-general'
  )
  await surface.open(page)
  assert.equal(state.activeView, 'settings')
  assert.equal(state.settingsNavigationTarget, null)
})

test('settings-pane surface.open() fails loudly (never silently proceeds) when the app never actually navigates', async () => {
  installFakeStore({
    activeView: 'terminal',
    settingsNavigationTarget: null,
    // Simulates a genuinely broken navigation call: state never updates.
    openSettingsTarget() {},
    openSettingsPage() {}
  })
  const page = fakePage()
  const surface = buildOrcaSurfaceStrategy({ paneIds: ['general'] })().find(
    (s) => s.id === 'settings-general'
  )
  await assert.rejects(() => surface.open(page), /timeout/i)
})

test('main-shell surface.open() waits for the real activeView-left-settings condition, not a fixed sleep', async () => {
  const state = installFakeStore({
    activeView: 'settings',
    closeSettingsPage() {
      // Real app latency modeled as > the OLD 100ms fixed sleep this
      // finding removed.
      setTimeout(() => Object.assign(state, { activeView: 'terminal' }), 160)
    }
  })
  const page = fakePage()
  const surface = buildOrcaSurfaceStrategy({ paneIds: [] })().find((s) => s.id === 'main-shell')
  const openedAt = Date.now()
  await surface.open(page)
  const elapsed = Date.now() - openedAt

  assert.ok(elapsed >= 150, `expected open() to wait for the real state transition, got ${elapsed}ms`)
  assert.equal(state.activeView, 'terminal')
})
