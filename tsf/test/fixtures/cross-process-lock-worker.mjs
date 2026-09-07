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

// schemaVersion stamped on every write (Finding F4's new read-boundary
// guard rejects a run missing/mismatching it) -- this fixture's counter
// shape otherwise has nothing to do with a real TSF_OVERNIGHT_RUN_V1 record.
for (let i = 0; i < count; i += 1) {
  await withKeepGoingRun(projectId, (current) => ({ schemaVersion: 'TSF_OVERNIGHT_RUN_V1', counter: (current?.counter ?? 0) + 1 }))
}
