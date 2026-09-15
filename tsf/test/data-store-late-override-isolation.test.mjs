// TSF_FIXTURE_POLLUTION_RECONCILIATION_V1: proves the actual root cause of
// the tsf-command-operator-integration-nytheria-* fixture pollution --
// data-store.mjs used to resolve TSF_UI_STATE_FILE into a module-level
// const ONCE, at first import. A process where something imports
// data-store.mjs (directly or transitively) BEFORE a test sets its own
// TSF_UI_STATE_FILE override got permanently stuck writing to the real
// default owner state file, even though the test's own env-var assignment
// looked correct in its own source. Reproduced here as a real child process
// (module state must not leak from THIS test's own already-imported
// data-store.mjs), not asserted from theory.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = import.meta.dirname
const DATA_STORE_URL = pathToFileURL(path.join(HERE, '..', 'server', 'data-store.mjs')).href
const ISOLATED_PATH = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  'operator-state.late-override-isolation-test.json'
)

// Simulates a process that (for whatever reason -- an eager import, a
// batched/aggregated multi-file run) already loaded data-store.mjs BEFORE
// the override was set, then sets TSF_UI_STATE_FILE afterward, exactly as
// command-operator-integration-adversarial.test.mjs's own top-level
// `process.env.TSF_UI_STATE_FILE = STATE_FILE` line would look to any
// caller that imported this module even a tick earlier.
const script = `
import * as store from ${JSON.stringify(DATA_STORE_URL)}
process.env.TSF_UI_STATE_FILE = ${JSON.stringify(ISOLATED_PATH)}
process.stdout.write(store.getStateFilePath())
`

function run() {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TSF_UI_STATE_FILE: '' },
    encoding: 'utf8'
  })
}

test('a TSF_UI_STATE_FILE override set AFTER data-store.mjs is first imported is still honored, never silently ignored', () => {
  const resolvedPath = run()
  assert.equal(
    resolvedPath,
    ISOLATED_PATH,
    'a late override must still isolate state -- this is the exact mechanism that let fixture data reach the real owner state file'
  )
})
