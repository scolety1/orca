#!/usr/bin/env node
// Stands in for the real `orca` CLI in tests. Driven by env vars so tests
// never depend on a live Orca runtime being reachable.
const args = process.argv.slice(2)
const mode = process.env.STUB_ORCA_MODE || 'success'
const seededRepos = process.env.STUB_ORCA_REPOS ? JSON.parse(process.env.STUB_ORCA_REPOS) : []
const seededWorkers = process.env.STUB_ORCA_WORKERS ? JSON.parse(process.env.STUB_ORCA_WORKERS) : []
const seededTasks = process.env.STUB_ORCA_TASKS ? JSON.parse(process.env.STUB_ORCA_TASKS) : []

function ok(result) {
  process.stdout.write(JSON.stringify({ id: 'stub', ok: true, result }))
  process.exit(0)
}

if (mode === 'error') {
  process.stdout.write(
    JSON.stringify({ id: 'stub', ok: false, error: { message: 'deliberate stub CLI error' } })
  )
  process.exit(0)
}
if (mode === 'malformed') {
  process.stdout.write('not json')
  process.exit(0)
}

if (args[0] === 'repo' && args[1] === 'list') {
  ok({ repos: seededRepos })
} else if (args[0] === 'repo' && args[1] === 'add') {
  const pathIndex = args.indexOf('--path')
  const addedPath = pathIndex === -1 ? null : args[pathIndex + 1]
  ok({
    repo: {
      id: 'stub-new-repo-id',
      path: addedPath,
      displayName: addedPath?.split(/[\\/]/).pop() ?? 'unknown',
      kind: 'git'
    }
  })
} else if (args[0] === 'orchestration' && args[1] === 'run-create') {
  const objectiveIndex = args.indexOf('--objective')
  ok({
    run: { id: 'stub-run-id', objective: objectiveIndex === -1 ? null : args[objectiveIndex + 1] }
  })
} else if (args[0] === 'orchestration' && args[1] === 'run-use') {
  const idIndex = args.indexOf('--id')
  ok({
    run: { id: idIndex === -1 ? null : args[idIndex + 1] },
    binding: { consumerGeneration: 1 }
  })
} else if (args[0] === 'orchestration' && args[1] === 'task-create') {
  const specIndex = args.indexOf('--spec')
  const runIndex = args.indexOf('--run')
  ok({
    task: {
      id: 'stub-task-id',
      spec: specIndex === -1 ? null : args[specIndex + 1],
      runId: runIndex === -1 ? null : args[runIndex + 1]
    }
  })
} else if (args[0] === 'orchestration' && args[1] === 'dispatch') {
  const taskIndex = args.indexOf('--task')
  const toIndex = args.indexOf('--to')
  ok({
    dispatch: {
      id: 'stub-dispatch-id',
      taskId: taskIndex === -1 ? null : args[taskIndex + 1],
      terminal: toIndex === -1 ? null : args[toIndex + 1]
    }
  })
} else if (args[0] === 'orchestration' && args[1] === 'worker-start') {
  // Shape confirmed against a real live `worker-start` call (2026-08-20
  // proof run) -- dispatchId/state/stage are top-level, not nested under
  // a "worker" key. An earlier version of this stub guessed the shape
  // (result.worker.dispatchId) without checking real output; fixed here.
  const taskIndex = args.indexOf('--task')
  const runIndex = args.indexOf('--run')
  const worktreeIndex = args.indexOf('--worktree')
  const agentIndex = args.indexOf('--agent')
  const terminalIndex = args.indexOf('--terminal')
  const terminalHandle = terminalIndex === -1 ? 'stub-fresh-terminal' : args[terminalIndex + 1]
  ok({
    runId: runIndex === -1 ? null : args[runIndex + 1],
    taskId: taskIndex === -1 ? null : args[taskIndex + 1],
    dispatchId: 'stub-worker-dispatch-id',
    state: 'ready',
    stage: 'input_accepted',
    launch: {
      requested: { agent: agentIndex === -1 ? null : args[agentIndex + 1] },
      effective: { agent: agentIndex === -1 ? null : args[agentIndex + 1] }
    },
    effects: [
      {
        kind: 'worktree',
        action: 'reused',
        id: worktreeIndex === -1 ? null : args[worktreeIndex + 1]
      },
      {
        kind: 'terminal',
        role: 'agent',
        action: terminalIndex === -1 ? 'created' : 'reused',
        id: terminalHandle
      },
      { kind: 'dispatch_input', role: 'agent', id: terminalHandle, state: 'accepted' }
    ],
    residualResources: []
  })
} else if (args[0] === 'orchestration' && args[1] === 'worker-show') {
  const dispatchIndex = args.indexOf('--dispatch')
  const dispatchId = dispatchIndex === -1 ? null : args[dispatchIndex + 1]
  ok({
    dispatch: { id: dispatchId, status: 'completed' },
    worker: { dispatch_id: dispatchId, state: 'succeeded', stage: 'settled' },
    observation: { status: 'idle', exactWorker: true }
  })
} else if (args[0] === 'orchestration' && args[1] === 'worker-list') {
  ok({ workers: seededWorkers })
} else if (args[0] === 'orchestration' && args[1] === 'task-list') {
  ok({ tasks: seededTasks })
} else if (args[0] === 'orchestration' && args[1] === 'gate-create') {
  const taskIndex = args.indexOf('--task')
  const questionIndex = args.indexOf('--question')
  ok({
    gate: {
      id: 'stub-gate-id',
      taskId: taskIndex === -1 ? null : args[taskIndex + 1],
      question: questionIndex === -1 ? null : args[questionIndex + 1]
    }
  })
} else {
  process.stdout.write(
    JSON.stringify({
      id: 'stub',
      ok: false,
      error: { message: `unsupported stub command: ${args.join(' ')}` }
    })
  )
  process.exit(0)
}
