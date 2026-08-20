#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// keep-going-run-store-cross-process.test.mjs -- performs N sequential
// withKeepGoingRun increments against whatever TSF_UI_STATE_FILE names
// (inherited from the parent's env), racing an identical sibling process
// against the SAME real file. Proves the cross-process file lock, not
// just Node's own single-process event-loop ordering.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , projectId, countArg, startMarkerPath] = process.argv
const count = Number(countArg)

const { withKeepGoingRun } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'keep-going-run-store.mjs'))
    .href
)

// Written BEFORE the loop starts so the test can confirm the two racing
// processes genuinely overlapped (both started within a small window of
// each other), not that one happened to finish before the other began --
// a real review finding against the first version of this test.
if (startMarkerPath) {
  writeFileSync(startMarkerPath, String(Date.now()))
}

for (let i = 0; i < count; i += 1) {
  await withKeepGoingRun(projectId, (current) => ({ counter: (current?.counter ?? 0) + 1 }))
}
