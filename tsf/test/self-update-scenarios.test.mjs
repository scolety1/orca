// Safe Update Manager V1 -- spec Phase 10's required scenarios, proven for
// real wherever this isolated worktree can genuinely exercise them (real
// child-process spawn/kill, real git repos, real HTTP). No live production
// TSF instance is ever touched -- every "live runtime" in these tests is a
// real process THIS test spawns and kills itself, on an ephemeral port,
// mirroring main-plugin.test.mjs's own established real-spawn convention.
//
// Scenario coverage map:
//   A. no active work -> SAFE_NOW                         -- this file
//   B. active project mission -> WAIT_FOR_ACTIVE_WORK      -- this file
//   C. candidate drift -> update refused                   -- git-identity.test.mjs
//                                                              + self-update-adoption.test.mjs
//   D. UI-only candidate -> rebuild/reload, minimal disruption -- artifact-rebuild-contract.test.mjs
//   E. backend candidate -> controlled restart/reconnect   -- this file (real spawn/kill/re-verify)
//   F. stale launcher -> exact owned process replaced      -- this file (real PID liveness)
//   G. post-update health failure -> rollback path         -- this file (real failing verifyLiveRuntime
//                                                              + git-identity.test.mjs's resetHardTo)
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-self-update-scenarios-${process.pid}.json`
)
// Isolates the real spawned child processes below from any real local dev
// state (main-plugin.test.mjs's own real-spawn tests do not do this today
// -- this file deliberately goes further, since these tests genuinely
// touch multiple real processes over several seconds).
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { default: activate, deactivate } = await import('../main.mjs')
const { classifyUpdateSafety } = await import('../domain/update-safety.mjs')
const { verifyLiveRuntime } = await import('../server/post-update-verification.mjs')
const { isProcessAlive, readRuntimeMetadata } =
  await import('../server/runtime-identity-tracker.mjs')

test.after(() => {
  for (const suffix of ['', '.tmp', '.lock', '.runtime.json']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
})

function ephemeralPort() {
  return 40000 + Math.floor(Math.random() * 10000)
}

function fakeOrca() {
  return {
    orca: {
      commands: { register: () => {} },
      events: { on: () => {} },
      host: { call: async () => ({ value: undefined }) },
      log: () => {}
    }
  }
}

async function waitForServer(base, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/meta`)
      if (res.ok) {
        return res
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw lastError ?? new Error('server did not become ready in time')
}

// executing mirrors real fleet-work-status.mjs semantics: WORKING is only
// ever returned when a wave is genuinely in flight (isRunExecuting), so a
// WORKING fixture that didn't set executing:true would be unreal --
// classifyUpdateSafety now keys off that fact, not the state label alone
// (governed-adoption-review finding: a settled-but-unowned run must not
// block an update forever just because its label happens to say
// VERIFYING/REVISION/WAITING).
function fleetStatus(projectId, hasRun, state, executing = state === 'WORKING') {
  return {
    projectId,
    displayName: projectId,
    hasRun,
    feed: hasRun ? { state, reason: state } : null,
    runId: hasRun ? 'run-1' : null,
    executing
  }
}

// SCENARIO A: no active work anywhere -> update applies normally.
test('scenario A: no active work anywhere classifies SAFE_NOW', () => {
  const result = classifyUpdateSafety([
    fleetStatus('a', false, null),
    fleetStatus('b', true, 'PLANNING')
  ])
  assert.equal(result.state, 'SAFE_NOW')
})

// SCENARIO B: an active project mission -> update waits/gates, never
// forces through it.
test('scenario B: a real active project mission classifies WAIT_FOR_ACTIVE_WORK, never SAFE_NOW', () => {
  const result = classifyUpdateSafety([fleetStatus('a', true, 'WORKING')])
  assert.equal(result.state, 'WAIT_FOR_ACTIVE_WORK')
  assert.deepEqual(result.blockingProjectIds, ['a'])
})

// SCENARIO E: a backend candidate -> controlled restart/reconnect, proven
// as a real spawn -> real kill -> real respawn -> real re-verification
// against a genuinely different process (a new pid), not a simulation.
test('scenario E: a controlled backend restart really kills the old process and a new one really answers, independently re-verified', async () => {
  const port = ephemeralPort()
  const { orca } = fakeOrca()
  const serverEntryPath = path.join(import.meta.dirname, '..', 'server', 'http-server.mjs')
  const base = `http://127.0.0.1:${port}`

  activate(orca, { port, serverEntryPath })
  let firstPid
  try {
    await waitForServer(base)
    const first = await verifyLiveRuntime(base, { includeChatCheck: false })
    assert.equal(first.ok, true, JSON.stringify(first.checks))
    const identity = await (await fetch(`${base}/api/runtime-identity`)).json()
    firstPid = identity.pid
    assert.ok(isProcessAlive(firstPid), 'the real spawned process is genuinely alive')
  } finally {
    deactivate()
  }
  // Controlled restart: the old process must genuinely be dead before a
  // new one starts on the same port (never two processes racing one port).
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(
    isProcessAlive(firstPid),
    false,
    'the old process was genuinely killed, not just detached'
  )

  activate(orca, { port, serverEntryPath })
  try {
    await waitForServer(base)
    const second = await verifyLiveRuntime(base, { includeChatCheck: false })
    assert.equal(second.ok, true, JSON.stringify(second.checks))
    const identity = await (await fetch(`${base}/api/runtime-identity`)).json()
    assert.notEqual(identity.pid, firstPid, 'a genuinely new process, not a reused handle')
  } finally {
    deactivate()
  }
})

// SCENARIO F: a stale/orphaned process is detectable and never conflated
// with a genuinely alive one -- the exact liveness check a "replace only a
// positively-identified stale process" gate depends on.
test('scenario F: stale-process detection distinguishes a real dead pid from a real live one, from real recorded metadata', async () => {
  const port = ephemeralPort()
  const { orca } = fakeOrca()
  const serverEntryPath = path.join(import.meta.dirname, '..', 'server', 'http-server.mjs')
  activate(orca, { port, serverEntryPath })
  try {
    await waitForServer(`http://127.0.0.1:${port}`)
    await new Promise((resolve) => setTimeout(resolve, 100)) // let the fire-and-forget metadata write land
    const metadata = readRuntimeMetadata()
    assert.ok(metadata, 'the real spawned process recorded its own runtime metadata')
    assert.equal(
      isProcessAlive(metadata.pid),
      true,
      'the recorded pid is genuinely alive right now'
    )
  } finally {
    deactivate()
  }
  // A pid recorded but never actually alive (or already dead) must never
  // be reported as alive -- the real, ownership-safe distinction "never
  // kill unrelated processes" depends on.
  assert.equal(isProcessAlive(999999), false)
})

// SCENARIO G: post-update health failure -> a real, honest failing
// verification (never silently claimed healthy), pointing at a URL with
// nothing real listening -- exactly what a failed restart looks like from
// the verifier's own perspective. git-identity.test.mjs's resetHardTo test
// proves the actual rollback mechanics this failure would trigger.
test('scenario G: verifyLiveRuntime honestly fails against an unreachable runtime, never claims success', async () => {
  const result = await verifyLiveRuntime('http://127.0.0.1:1', {
    timeoutMs: 500,
    includeChatCheck: false
  })
  assert.equal(result.ok, false)
  assert.ok(result.checks.every((c) => c.ok === false))
  assert.ok(result.checks.every((c) => typeof c.detail === 'string' && c.detail.length > 0))
})
