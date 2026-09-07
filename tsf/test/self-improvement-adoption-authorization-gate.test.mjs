// Mirrors cleanup-owner-authorization-gate.test.mjs's own proof shape:
// closed by default against the REAL env/flag path, open ONLY against a
// fabricated env object/temp flag file, and the real global signal is
// never touched by this test file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ADOPTION_AUTHORIZATION_MARKER,
  assertAdoptionAuthorizationGateOpen,
  defaultAdoptionAuthorizationFlagPath,
  readAdoptionAuthorizationGateState
} from '../server/self-improvement-adoption-authorization-gate.mjs'

test('closed by default against the REAL process.env and REAL default flag path', () => {
  assert.equal(process.env.TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION, undefined, 'this test suite must never set the real env var')
  const realFlagPath = defaultAdoptionAuthorizationFlagPath()
  assert.equal(existsSync(realFlagPath), false, 'this test suite must never create the real flag file')
  const state = readAdoptionAuthorizationGateState()
  assert.equal(state.open, false)
  assert.equal(state.envMarkerPresent, false)
  assert.equal(state.flagFilePresent, false)
})

test('open ONLY when a FABRICATED env object AND a FABRICATED flag file both agree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-gate-test-'))
  const fakeFlagPath = path.join(dir, 'FAKE_ADOPTION_AUTHORIZATION.flag')
  try {
    const closedNoFile = readAdoptionAuthorizationGateState({ TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, fakeFlagPath)
    assert.equal(closedNoFile.open, false, 'env alone is not enough')

    writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
    const closedNoEnv = readAdoptionAuthorizationGateState({}, fakeFlagPath)
    assert.equal(closedNoEnv.open, false, 'flag file alone is not enough')

    const open = readAdoptionAuthorizationGateState({ TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, fakeFlagPath)
    assert.equal(open.open, true)
    assert.doesNotThrow(() => assertAdoptionAuthorizationGateOpen({ TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, fakeFlagPath))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('assertAdoptionAuthorizationGateOpen throws a typed error when closed', () => {
  assert.throws(() => assertAdoptionAuthorizationGateOpen({}, path.join(tmpdir(), 'definitely-does-not-exist.flag')), (error) => error.code === 'TSF_SELF_IMPROVEMENT_ADOPTION_GATE_CLOSED')
})

test('a mismatched flag-file content does not open the gate', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-gate-test-mismatch-'))
  const fakeFlagPath = path.join(dir, 'FAKE.flag')
  try {
    writeFileSync(fakeFlagPath, 'not the real marker', 'utf8')
    const state = readAdoptionAuthorizationGateState({ TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, fakeFlagPath)
    assert.equal(state.open, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
