#!/usr/bin/env node
// Stands in for the real `orca` CLI in tests. Driven by env vars so tests
// never depend on a live Orca runtime being reachable.
const args = process.argv.slice(2)
const mode = process.env.STUB_ORCA_MODE || 'success'
const seededRepos = process.env.STUB_ORCA_REPOS ? JSON.parse(process.env.STUB_ORCA_REPOS) : []

function ok(result) {
  process.stdout.write(JSON.stringify({ id: 'stub', ok: true, result }))
  process.exit(0)
}

if (mode === 'error') {
  process.stdout.write(JSON.stringify({ id: 'stub', ok: false, error: { message: 'deliberate stub CLI error' } }))
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
  ok({ repo: { id: 'stub-new-repo-id', path: addedPath, displayName: addedPath?.split(/[\\/]/).pop() ?? 'unknown', kind: 'git' } })
} else {
  process.stdout.write(JSON.stringify({ id: 'stub', ok: false, error: { message: `unsupported stub command: ${args.join(' ')}` } }))
  process.exit(0)
}
