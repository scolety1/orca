import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import {
  createOrchestrationGate,
  createOrchestrationRun,
  createOrchestrationTask,
  dispatchOrchestrationTask,
  listOrchestrationTasks,
  listOrchestrationWorkers,
  showOrchestrationWorker,
  startOrchestrationWorker
} from '../adapters/orca-orchestration-bridge.mjs'

const HERE = import.meta.dirname
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

async function withEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
    }
  }
}

const STUBBED = { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }

// --- createOrchestrationRun ---

test('createOrchestrationRun rejects a missing objective before touching the CLI', async () => {
  const result = await createOrchestrationRun({})
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('createOrchestrationRun passes --objective through and returns the stubbed run', async () => {
  await withEnv(STUBBED, async () => {
    const result = await createOrchestrationRun({ objective: 'M2 wave 2 fixture proof' })
    assert.equal(result.ok, true)
    assert.equal(result.result.run.objective, 'M2 wave 2 fixture proof')
  })
})

test('createOrchestrationRun fails honestly when the forced CLI override does not exist', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await createOrchestrationRun({ objective: 'unreachable' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SPAWN_ERROR')
  })
})

test('createOrchestrationRun surfaces a deliberate CLI error without fabricating success', async () => {
  await withEnv({ ...STUBBED, STUB_ORCA_MODE: 'error' }, async () => {
    const result = await createOrchestrationRun({ objective: 'will fail' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'CLI_ERROR')
  })
})

test('createOrchestrationRun reports malformed CLI output rather than guessing', async () => {
  await withEnv({ ...STUBBED, STUB_ORCA_MODE: 'malformed' }, async () => {
    const result = await createOrchestrationRun({ objective: 'malformed' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'MALFORMED_RESPONSE')
  })
})

// --- createOrchestrationTask ---

test('createOrchestrationTask rejects a missing spec before touching the CLI', async () => {
  const result = await createOrchestrationTask({ run: 'run-1' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('createOrchestrationTask passes --spec and --run through', async () => {
  await withEnv(STUBBED, async () => {
    const result = await createOrchestrationTask({ spec: 'wire the adapter', run: 'run-42' })
    assert.equal(result.ok, true)
    assert.equal(result.result.task.spec, 'wire the adapter')
    assert.equal(result.result.task.runId, 'run-42')
  })
})

// --- dispatchOrchestrationTask ---

test('dispatchOrchestrationTask rejects missing task/to before touching the CLI', async () => {
  const result = await dispatchOrchestrationTask({ task: 'task-1' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('dispatchOrchestrationTask passes --task and --to through', async () => {
  await withEnv(STUBBED, async () => {
    const result = await dispatchOrchestrationTask({ task: 'task-1', to: 'term_abc' })
    assert.equal(result.ok, true)
    assert.equal(result.result.dispatch.taskId, 'task-1')
    assert.equal(result.result.dispatch.terminal, 'term_abc')
  })
})

// --- listOrchestrationWorkers ---

test('listOrchestrationWorkers returns the stubbed worker list unfiltered', async () => {
  const workers = [{ dispatchId: 'ctx_1', workerState: 'succeeded' }]
  await withEnv({ ...STUBBED, STUB_ORCA_WORKERS: JSON.stringify(workers) }, async () => {
    const result = await listOrchestrationWorkers({})
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.workers, workers)
  })
})

test('listOrchestrationWorkers fails honestly when the forced CLI override does not exist', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await listOrchestrationWorkers({ run: 'run-1' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SPAWN_ERROR')
  })
})

// --- listOrchestrationTasks ---

test('listOrchestrationTasks returns the stubbed task list, scoped by --run when given', async () => {
  const tasks = [{ id: 'task-1', status: 'completed' }]
  await withEnv({ ...STUBBED, STUB_ORCA_TASKS: JSON.stringify(tasks) }, async () => {
    const result = await listOrchestrationTasks({ run: 'run-1' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.tasks, tasks)
  })
})

test('listOrchestrationTasks fails honestly when the forced CLI override does not exist', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await listOrchestrationTasks({ run: 'run-1' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'SPAWN_ERROR')
  })
})

// --- startOrchestrationWorker (the preferred, supervised dispatch path) ---

test('startOrchestrationWorker rejects a missing task before touching the CLI', async () => {
  const result = await startOrchestrationWorker({ worktree: 'current', agent: 'codex' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('startOrchestrationWorker rejects neither worktree nor terminal given', async () => {
  const result = await startOrchestrationWorker({ task: 'task-1', agent: 'codex' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('startOrchestrationWorker rejects agent missing when terminal is not given either', async () => {
  const result = await startOrchestrationWorker({ task: 'task-1', worktree: 'current' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('startOrchestrationWorker passes --task/--worktree/--agent through for a fresh agent terminal', async () => {
  await withEnv(STUBBED, async () => {
    const result = await startOrchestrationWorker({
      task: 'task-1',
      worktree: 'current',
      agent: 'codex'
    })
    assert.equal(result.ok, true)
    assert.equal(result.result.status, 'ready')
    assert.equal(result.result.worker.taskId, 'task-1')
    assert.equal(result.result.worker.worktree, 'current')
    assert.equal(result.result.worker.agent, 'codex')
  })
})

test('startOrchestrationWorker allows --terminal instead of --worktree/--agent to reuse an existing terminal', async () => {
  await withEnv(STUBBED, async () => {
    const result = await startOrchestrationWorker({ task: 'task-1', terminal: 'term_abc' })
    assert.equal(result.ok, true)
    assert.equal(result.result.worker.agentTerminalHandle, 'term_abc')
  })
})

test('startOrchestrationWorker surfaces a nonzero-exit failure honestly rather than fabricating readiness', async () => {
  await withEnv({ ...STUBBED, STUB_ORCA_MODE: 'error' }, async () => {
    const result = await startOrchestrationWorker({
      task: 'task-1',
      worktree: 'current',
      agent: 'codex'
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'CLI_ERROR')
  })
})

test('showOrchestrationWorker rejects a missing dispatch before touching the CLI', async () => {
  const result = await showOrchestrationWorker({})
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('showOrchestrationWorker passes --dispatch through', async () => {
  await withEnv(STUBBED, async () => {
    const result = await showOrchestrationWorker({ dispatch: 'ctx-1' })
    assert.equal(result.ok, true)
    assert.equal(result.result.worker.dispatchId, 'ctx-1')
  })
})

// --- createOrchestrationGate ---

test('createOrchestrationGate rejects a missing question before touching the CLI', async () => {
  const result = await createOrchestrationGate({ task: 'task-1' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'INVALID_ARGS')
})

test('createOrchestrationGate passes --task and --question through', async () => {
  await withEnv(STUBBED, async () => {
    const result = await createOrchestrationGate({
      task: 'task-1',
      question: 'Adopt into tsf/main?'
    })
    assert.equal(result.ok, true)
    assert.equal(result.result.gate.taskId, 'task-1')
    assert.equal(result.result.gate.question, 'Adopt into tsf/main?')
  })
})
