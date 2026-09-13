// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 10: TSF-SAFE-UI-001. The guard
// fires at data-store.mjs's own MODULE LOAD time (a real, deliberate
// choice -- every server code path transitively imports this module, so
// there is no call site a misconfigured disposable runtime could reach
// around it), which means testing it requires a real child process per
// case (re-importing the same specifier in-process would just hit ESM's
// own module cache, never re-running the top-level check).
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = import.meta.dirname
const DATA_STORE_URL = pathToFileURL(path.join(HERE, '..', 'server', 'data-store.mjs')).href

function importDataStoreInChildProcess(env) {
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `import ${JSON.stringify(DATA_STORE_URL)}`],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, stderr: error.stderr?.toString('utf8') ?? '' }
  }
}

test('TSF-SAFE-UI-001: a disposable runtime whose TSF_UI_STATE_FILE override failed to propagate refuses to start', () => {
  const result = importDataStoreInChildProcess({
    TSF_DISPOSABLE_RUNTIME: '1',
    TSF_UI_STATE_FILE: ''
  })
  assert.equal(result.ok, false, 'the process must fail to import, never silently continue')
  assert.match(result.stderr, /TSF-SAFE-UI-001/)
  assert.match(result.stderr, /refusing to start/)
})

test('TSF-SAFE-UI-001: a disposable runtime with a REAL, correctly-propagated isolated state path starts normally', () => {
  const result = importDataStoreInChildProcess({
    TSF_DISPOSABLE_RUNTIME: '1',
    TSF_UI_STATE_FILE: path.join(
      HERE,
      '.local-state',
      'operator-state.safe-ui-001-isolated-test.json'
    )
  })
  assert.equal(
    result.ok,
    true,
    `a correctly-isolated disposable runtime must start cleanly: ${result.stderr}`
  )
})

test('TSF-SAFE-UI-001: the real owner runtime (no TSF_DISPOSABLE_RUNTIME flag at all) is completely unaffected, even with no override set', () => {
  const result = importDataStoreInChildProcess({
    TSF_DISPOSABLE_RUNTIME: '',
    TSF_UI_STATE_FILE: ''
  })
  assert.equal(
    result.ok,
    true,
    `the real owner's own normal startup must never be blocked by this guard: ${result.stderr}`
  )
})
