#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// keep-going-run-store-cross-process.test.mjs -- performs N sequential
// withKeepGoingRun increments against whatever TSF_UI_STATE_FILE names
// (inherited from the parent's env), racing an identical sibling process
// against the SAME real file. Proves the cross-process file lock, not
// just Node's own single-process event-loop ordering.
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , projectId, countArg] = process.argv
const count = Number(countArg)

const { withKeepGoingRun } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'keep-going-run-store.mjs'))
    .href
)

for (let i = 0; i < count; i += 1) {
  withKeepGoingRun(projectId, (current) => ({ counter: (current?.counter ?? 0) + 1 }))
}
