// Real V1 stabilization finding: a real Orca-hosted TSF process can start
// with APPDATA missing from its own environment, breaking Orca CLI calls
// and the live planner's own credential/config resolution alike. See
// adapters/windows-user-env.mjs for the real, reproduced root cause (the
// exact real failure was reproduced directly against the installed
// orca.exe binary with a minimal env, not guessed).
import assert from 'node:assert/strict'
import test from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { ensureWindowsUserEnv } from '../adapters/windows-user-env.mjs'

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

test('ensureWindowsUserEnv: a no-op on a non-Windows platform, even with everything missing', () => {
  withPlatform('linux', () => {
    const env = {}
    const result = ensureWindowsUserEnv(env)
    assert.equal(result.applied, false)
    assert.deepEqual(env, {})
  })
})

test('ensureWindowsUserEnv: a no-op on Windows when everything is already present -- never overwrites a real value', () => {
  withPlatform('win32', () => {
    const env = {
      APPDATA: 'C:\\real\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\real\\AppData\\Local',
      USERPROFILE: 'C:\\real'
    }
    const before = { ...env }
    const result = ensureWindowsUserEnv(env)
    assert.equal(result.applied, false)
    assert.deepEqual(env, before)
  })
})

test('ensureWindowsUserEnv: derives APPDATA/LOCALAPPDATA from USERPROFILE when only APPDATA is missing -- the exact real, reproduced shape', () => {
  withPlatform('win32', () => {
    const env = { USERPROFILE: 'C:\\Users\\real-user' }
    const result = ensureWindowsUserEnv(env)
    assert.equal(result.applied, true)
    assert.equal(env.APPDATA, path.join('C:\\Users\\real-user', 'AppData', 'Roaming'))
    assert.equal(env.LOCALAPPDATA, path.join('C:\\Users\\real-user', 'AppData', 'Local'))
  })
})

test('ensureWindowsUserEnv: derives everything from the real os.homedir() when USERPROFILE is also missing -- the worst-case real shape', () => {
  withPlatform('win32', () => {
    const env = {}
    const result = ensureWindowsUserEnv(env)
    const home = os.homedir()
    assert.equal(result.applied, true)
    assert.equal(env.USERPROFILE, home)
    assert.equal(env.APPDATA, path.join(home, 'AppData', 'Roaming'))
    assert.equal(env.LOCALAPPDATA, path.join(home, 'AppData', 'Local'))
  })
})

test('ensureWindowsUserEnv: idempotent -- calling twice never re-derives over an already-fixed value', () => {
  withPlatform('win32', () => {
    const env = { USERPROFILE: 'C:\\Users\\real-user' }
    ensureWindowsUserEnv(env)
    const afterFirst = { ...env }
    const result = ensureWindowsUserEnv(env)
    assert.equal(result.applied, false)
    assert.deepEqual(env, afterFirst)
  })
})

test('ensureWindowsUserEnv: mutates the real process.env by default -- the actual real usage shape (main.mjs/http-server.mjs/safe-provider-launch.mjs all call it with no argument)', () => {
  withPlatform('win32', () => {
    const priorAppData = process.env.APPDATA
    const priorUserProfile = process.env.USERPROFILE
    try {
      delete process.env.APPDATA
      const result = ensureWindowsUserEnv()
      assert.equal(result.applied, true)
      assert.ok(process.env.APPDATA, 'process.env.APPDATA must be set after the call')
    } finally {
      if (priorAppData === undefined) {
        delete process.env.APPDATA
      } else {
        process.env.APPDATA = priorAppData
      }
      if (priorUserProfile === undefined) {
        delete process.env.USERPROFILE
      } else {
        process.env.USERPROFILE = priorUserProfile
      }
    }
  })
})
