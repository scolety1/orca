// Every test here uses FABRICATED env objects and temp flag files -- never
// process.env, never the real default flag path -- so this suite can prove
// "gate open -> proceeds" without ever flipping the real, global gate this
// machine's actual owner controls. See cleanup-owner-authorization-gate.mjs's
// own header comment.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  OWNER_AUTHORIZATION_MARKER,
  assertOwnerAuthorizationGateOpen,
  readOwnerAuthorizationGateState
} from '../server/cleanup-owner-authorization-gate.mjs'

const DIR = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-gate-test-'))
test.after(() => rmSync(DIR, { recursive: true, force: true }))

function flagFileAt(name, content) {
  const p = path.join(DIR, name)
  if (content !== undefined) {
    writeFileSync(p, content, 'utf8')
  }
  return p
}

test('default state (no env, no flag file) is CLOSED -- this is the required fail-closed default', () => {
  const missingFlag = path.join(DIR, 'never-written.flag')
  const state = readOwnerAuthorizationGateState({}, missingFlag)
  assert.equal(state.open, false)
  assert.equal(state.envMarkerPresent, false)
  assert.equal(state.flagFilePresent, false)
})

test('env marker alone (no flag file) is CLOSED', () => {
  const missingFlag = path.join(DIR, 'still-never-written.flag')
  const state = readOwnerAuthorizationGateState({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: OWNER_AUTHORIZATION_MARKER }, missingFlag)
  assert.equal(state.open, false)
})

test('flag file alone (no env marker) is CLOSED', () => {
  const flagPath = flagFileAt('flag-only.flag', OWNER_AUTHORIZATION_MARKER)
  const state = readOwnerAuthorizationGateState({}, flagPath)
  assert.equal(state.open, false)
})

test('a wrong-value env marker with a correct flag file is still CLOSED -- no partial credit', () => {
  const flagPath = flagFileAt('correct.flag', OWNER_AUTHORIZATION_MARKER)
  const state = readOwnerAuthorizationGateState({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: 'close-enough' }, flagPath)
  assert.equal(state.open, false)
})

test('a wrong-content flag file with a correct env marker is still CLOSED', () => {
  const flagPath = flagFileAt('wrong-content.flag', 'not the marker')
  const state = readOwnerAuthorizationGateState({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: OWNER_AUTHORIZATION_MARKER }, flagPath)
  assert.equal(state.open, false)
})

test('BOTH conditions genuinely met (against fabricated env+file, never real ones) opens the gate', () => {
  const flagPath = flagFileAt('both-correct.flag', OWNER_AUTHORIZATION_MARKER)
  const state = readOwnerAuthorizationGateState({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: OWNER_AUTHORIZATION_MARKER }, flagPath)
  assert.equal(state.open, true)
})

test('trailing whitespace in the flag file is tolerated (trimmed) but the env var is compared exactly', () => {
  const flagPath = flagFileAt('whitespace.flag', `${OWNER_AUTHORIZATION_MARKER}\n`)
  const state = readOwnerAuthorizationGateState({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: OWNER_AUTHORIZATION_MARKER }, flagPath)
  assert.equal(state.open, true)
})

test('assertOwnerAuthorizationGateOpen throws TSF_CLEANUP_OWNER_GATE_CLOSED when closed, and returns the state when open', () => {
  const missingFlag = path.join(DIR, 'assert-missing.flag')
  assert.throws(() => assertOwnerAuthorizationGateOpen({}, missingFlag), (error) => error.code === 'TSF_CLEANUP_OWNER_GATE_CLOSED')

  const flagPath = flagFileAt('assert-open.flag', OWNER_AUTHORIZATION_MARKER)
  const state = assertOwnerAuthorizationGateOpen({ TSF_CLEANUP_V1_OWNER_AUTHORIZATION: OWNER_AUTHORIZATION_MARKER }, flagPath)
  assert.equal(state.open, true)
})

test('a non-existent flag file path never throws -- reads back as simply absent', () => {
  const state = readOwnerAuthorizationGateState({}, path.join(DIR, 'does', 'not', 'exist', 'at', 'all.flag'))
  assert.equal(state.open, false)
  assert.equal(state.flagFilePresent, false)
})

test('THE REAL GLOBAL GATE (no arguments -- real process.env and real default flag path) is closed in this test environment', () => {
  const state = readOwnerAuthorizationGateState()
  assert.equal(state.open, false, 'the real owner-authorization gate must never be open as a side effect of running this test suite')
})
